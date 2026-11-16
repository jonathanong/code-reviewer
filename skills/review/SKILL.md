---
name: review
description: Run one multi-pillar final review (first or follow-up) of a pull request and post it to GitHub.
---

# Final review

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/final-review/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Reviews one pull request with independent pillar reviewers, verifies their findings, and posts one
self-review to GitHub. Local sessions only, never CI. A review is not a merge decision: merging
stays with the human or the triage loop.

Arguments: `owner/name#number` (or a pull request URL) and an optional effort: `low`, `medium`, or
`high`. Without one, the CLI picks the mode: light (`low`) for a follow-up and for small, docs-only, test-only or Dependabot pull requests, full (`high`) otherwise. To run as
the standing reviewer that other sessions ask, use the [final-reviewer](../review-loop/SKILL.md)
skill, which calls this one per pull request.

The CLI is `code-reviewer` (`pnpm exec code-reviewer` in the code-reviewer
checkout; `help` lists the flags). Every subcommand prints a short JSON result. It authenticates as
the GitHub App when `FINAL_REVIEWER_APP_ID` and a key are set, otherwise with the local `gh` login
(`code-reviewer auth` says which).

## Token budget

The session that runs this skill only orchestrates. It never reads the diff, the pillar outputs,
or the conversation itself: the CLI writes them to the run directory and subagents read them
there. Each subagent replies with one line, and its full output stays in a file.

## Step 1 - Claim and prepare

1. `code-reviewer claim --repo <repo> --pr <n>` (add `--force` when the request came by
   message rather than label). It adds `final-review:in-progress`, then removes
   `final-review:requested`, `final-review:complete`, and a stale `final approval`. `claimed:
   false` means another run owns it or the request was withdrawn: stop.
2. Create a private run directory: `run=$(mktemp -d "${TMPDIR:-/tmp}/final-review-<name>-<n>-XXXXXX")`.
3. Check out the head as a detached worktree at `"$run/tree"` from a local clone when one exists
   (`git -C <clone> fetch origin <head> && git -C <clone> worktree add --detach "$run/tree" <head>`),
   otherwise from a blobless clone under `"$run"`.
4. `code-reviewer prepare --repo <repo> --pr <n> --out "$run" --tree "$run/tree" --clones <clone root> [--effort <e>]`
   (`--clones` defaults to `FINAL_REVIEWER_CLONE_ROOT`). It writes, without any model calls:
   - `diff.patch` and `diff/INDEX.md` with one numbered patch per file (base and head line numbers
     on every line);
   - `context.md`: the last final review (SHA, verdict, effort), commits since, unresolved
     final-review findings with their thread ids, and other reviewers' notes (Codex, CodeRabbit,
     Copilot, humans), squashed and truncated;
   - `rules/INDEX.md` and the files it lists: this repository's `AGENTS.md` files and skills at
     the base ref, and the instructions and skills of each repository under the clone root that this
     reviewer's `repos/<owner>/<name>.json` configs link to the change (as consumed, or as a
     consumer of what it touches, listed as Consumers), or whose package the diff imports. Its
     `Missing` section names any source that could not be staged: fix the
     clone root rather than reviewing without it;
   - `since.patch` and `since/INDEX.md` for a follow-up whose last reviewed SHA is an ancestor;
   - `plan.json`: effort, pillars with their model tier, the verifier tier, and skipped pillars
     with reasons ([dispatch](references/dispatch.md) documents the rules).
5. `claim` already declines a head the newest final review covers once posting finished, meaning
   the `final-review:complete` label is set (`reason: "head already reviewed"`, with that
   review's status); a partial post left by a failed run is claimed again. It swaps the request label for `complete` without
   touching `final approval`: reply with that verdict and stop. Use `--force` to review the same
   head again (for example at a higher effort).
6. Clean up when the review is posted or fails: `git -C <clone> worktree remove --force
   "$run/tree"`, then `rm -rf "$run"`. On failure also run `code-reviewer abort` (add
   `--requeue` only once, for a transient error).

## Step 2 - Dispatch pillars

For each entry in `plan.pillars`, start one background subagent on that entry's `model`. Give it
only paths, never file contents:

- its pillar file and [the contract](references/pillars/_contract.md);
- `"$run/tree"`, `"$run/diff/INDEX.md"`, `"$run/context.md"`, `"$run/rules/INDEX.md"`, and, when `plan.sinceSha` is set (a follow-up),
  `"$run/since/INDEX.md"` (review the new commits; read the full diff only for surrounding code);
- the base and head SHAs, and the repositories to search for blast radius;
- the instruction to write its JSON to `"$run/pillars/<pillar>.json"` and reply with one line:
  `<pillar>: <n> findings` or `<pillar>: failed: <reason>`.

Large pull requests: pillars read `INDEX.md` first and open per-file patches as needed, never the
whole `diff.patch`. A pillar that fails or writes invalid JSON is retried once, then listed in
`skipped` with the error.

| Pillar       | File                                               | Covers                                                                                 |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| rules        | [rules](references/pillars/rules.md)               | AGENTS.md and skills from the base ref, hygiene, semver, dependency policy             |
| correctness  | [correctness](references/pillars/correctness.md)   | Bugs, tests, data and performance, built-in code review at low effort                  |
| design       | [design](references/pillars/design.md)             | Intent, approach, elegance, DRY, return on investment                                  |
| blast-radius | [blast-radius](references/pillars/blast-radius.md) | Consumers across repositories, native and web clients, rollout, observability, privacy |
| security     | [security](references/pillars/security.md)         | Only on a security trigger; built-in security review                                   |
| history      | [history](references/pillars/history.md)           | Only on a history trigger; earlier reverts and fixes                                   |
| congruence   | [congruence](references/pillars/congruence.md)     | Performed by the verifier                                                              |

## Step 3 - Verify and post

When every pillar has replied, start one subagent on `plan.verifierModel` with
[the verifier](references/verifier.md), the run directory, the repository, the pull request
number, and the head SHA. It merges `"$run/pillars/*.json"` and `plan.skipped`, writes
`"$run/review.json"`, previews it with `post --dry-run`, posts it, resolves the threads of fixed
findings, and replies with one line: the verdict and the review URLs.

`code-reviewer post` renders and posts the review:

- The top line is `[Approve]`, `[Request Changes]`, or `[Comment]`. The review is always a COMMENT,
  because GitHub does not let an author approve their own pull request.
- Findings are tagged `[blocking]`, `[high]`, `[medium]`, or `[low]`: inline where the diff allows,
  collapsible body sections otherwise. Large reviews are split into numbered parts.
- A hidden marker records the reviewed SHA, the verdict, and the effort.
- On Approve the `final approval` label is added; otherwise it is removed. Then
  `final-review:complete` replaces `final-review:in-progress`. `complete` means posted, not
  approved.
- It refuses when the head moved since `prepare`: re-run from Step 1 with `--force`.

## Step 4 - Report

Reply to the requester with the verdict and the review link. Merging agents check
`code-reviewer status`, which exits 0 only when the newest final review approved the
current head and the `final approval` label is present.

## Benchmarks

Pillar prompts are benchmarked against labeled reverts and clean pull requests with
`code-reviewer bench`; the verifier with `bench-verifier`. The cases and how to run them
are in `benchmarks/review/`. Change a pillar or verifier prompt only together with a
benchmark run.

Consumer wrapper owns: the clone root (where local clones of the organization's repositories,
including `no-mistakes` and `skills`, live), the repositories searched for blast
radius, extra rule sources, and model tier overrides.

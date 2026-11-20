---
name: review
description: Run one multi-pillar review (first or follow-up) of a pull request and post it to GitHub.
---

# Code review

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/final-review/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Reviews one pull request with independent pillar reviewers, verifies their findings, and posts one
self-review to GitHub. Local sessions only, never CI. A review is not a merge decision: merging
stays with the human or the triage loop.

Arguments: `owner/name#number` (or a pull request URL) and an optional effort: `low`, `medium`, or
`high`. Without one, the CLI picks the mode: light (`low`) for a follow-up and for small,
docs-only, test-only or Dependabot pull requests, full (`high`) otherwise, and skip for a
Dependabot change to lockfiles only ([dispatch](references/dispatch.md) has the rules). To run as
the standing reviewer that other sessions ask, use the [review-loop](../review-loop/SKILL.md)
skill, which calls this one per pull request.

The CLI is `code-reviewer`, which the plugin puts on `PATH` (`pnpm exec code-reviewer` when
developing in a checkout; `help` lists the flags). Every subcommand prints a short JSON result. It authenticates as the GitHub App when
`CODE_REVIEWER_APP_ID` and a key are set, otherwise with the local `gh` login (`code-reviewer auth`
says which).

## Token budget

The session that runs this skill only orchestrates. One headless command does the review and
writes every file; the session reads the one JSON line it prints and, to present the review,
`report.md`. Never read the diff or the pillar outputs into the session.

## Step 1 - Check out the head

1. Create a private run directory: `run=$(mktemp -d "${TMPDIR:-/tmp}/review-<name>-<n>-XXXXXX")`.
2. Check out the head as a detached worktree at `"$run/tree"` from a local clone when one exists
   (`git -C <clone> fetch origin <head> && git -C <clone> worktree add --detach "$run/tree" <head>`),
   otherwise from a blobless clone under `"$run"`.

## Step 2 - Run the review

Run this in the background, so the session stays free:

```bash
code-reviewer review --repo <repo> --pr <n> --out "$run" --tree "$run/tree" \
  --clones <clone root> [--effort <e>] [--force]
```

`--clones` defaults to `CODE_REVIEWER_CLONE_ROOT`. Add `--force` when the request came by message
rather than label, or to review a head that is already reviewed. The command:

1. Claims the pull request: the processing label replaces the requested one, and a stale
   `final approval` is removed. `claimed: false` means another run owns it, the request was
   withdrawn, or the newest review already covers this head: go to Step 5 to remove the worktree
   and the run directory, and never run `abort`, because the claim is not this run's.
2. Prepares the run directory with no model calls: the numbered diff and one patch per file,
   `context.md` (the last review, unresolved findings, other reviewers' notes), `rules/INDEX.md`
   (this repository's `AGENTS.md` and skills at the base ref, and those of the repositories that
   the reviewer's configs or the diff's imports link to the change), and `plan.json`.
3. On a skip plan, posts a short skip review on the head with the reason (so `status` passes),
   closes the request, and writes a short report; go to Step 5.
4. Picks the rule skills for the change with one Haiku call, runs the planned pillars as headless
   runs that load only the `no-mistakes-rules` and `jong-skills` plugins, then runs the verifier.
5. Writes `review.json` (what `post` takes), `preview.md` (the review as it would be posted), and
   `report.md` with the pull request summary, the verdict, every pillar's findings including the
   ones the verifier dropped and why, the skills each pillar loaded, and the cost by model.

It prints one line:
`{claimed, mode, verdict, findings, costUsd, report, review, headSha, fixedThreadIds}`. It
never posts. If it fails after the claim it drops the processing label itself and exits 1; when
every pillar fails it fails the review, not approves it.

| Pillar       | File                                               | Covers                                                                                 |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| rules        | [rules](references/pillars/rules.md)               | AGENTS.md and skills from the base ref, hygiene, semver, dependency policy             |
| correctness  | [correctness](references/pillars/correctness.md)   | Bugs, tests, data and performance                                                      |
| design       | [design](references/pillars/design.md)             | Intent, approach, elegance, DRY, return on investment                                  |
| blast-radius | [blast-radius](references/pillars/blast-radius.md) | Consumers across repositories, native and web clients, rollout, observability, privacy |
| security     | [security](references/pillars/security.md)         | Only on a security trigger                                                             |
| history      | [history](references/pillars/history.md)           | Only on a history trigger; earlier reverts and fixes                                   |
| congruence   | [congruence](references/pillars/congruence.md)     | Performed by the [verifier](references/verifier.md)                                    |

## Step 3 - Get permission to post

Show the human the verdict, the findings by severity, and the path of `report.md`, and ask
whether to post. Post without asking only when the human has said this kind of review may be
posted unattended. A human who wants a finding changed edits `review.json`; preview the result
with `post --dry-run`.

## Step 4 - Post or drop

- Post: `code-reviewer post --repo <repo> --pr <n> --head-sha <headSha> --input "$run/review.json"`.
- Drop: `code-reviewer abort --repo <repo> --pr <n>` (add `--requeue` to ask again later).

`post` renders and posts the review:

- The top line is `[Approve]`, `[Request Changes]`, or `[Comment]`. The review is always a COMMENT,
  because GitHub does not let an author approve their own pull request.
- Findings are tagged `[blocking]`, `[high]`, `[medium]`, or `[low]`: inline where the diff allows,
  collapsible body sections otherwise. Large reviews are split into numbered parts.
- A hidden marker records the reviewed SHA, the verdict, and the effort.
- On Approve the `final approval` label is added; otherwise it is removed. Then the completed
  label replaces the processing one. Completed means posted, not approved.
- It refuses when the head moved since the review ran. Check out the new head in the worktree
  (`git -C <clone> fetch origin <head> && git -C "$run/tree" checkout --detach <head>`), then run
  Step 2 again with `--force`: the review refuses a worktree that is not at the current head.

After posting a follow-up, resolve the threads the review found fixed: the `fixedThreadIds` it
printed, which `report.md` repeats as a ready `code-reviewer resolve` command.

## Step 5 - Clean up and report

`git -C <clone> worktree remove --force "$run/tree"`, then `rm -rf "$run"` once the report has
been recorded. Reply to the requester with the verdict and the review link. Merging agents check
`code-reviewer status`, which exits 0 only when the newest review approved the current head with
the `final approval` label present, or skipped it.

## Benchmarks

Pillar prompts are benchmarked against labeled reverts and clean pull requests with
`code-reviewer bench`; the verifier with `bench-verifier`. The cases and how to run them
are in `benchmarks/review/`. Change a pillar or verifier prompt only together with a
benchmark run.

Consumer wrapper owns: the clone root (where local clones of the organization's repositories,
including `no-mistakes` and `harness-plugins`, live), the repositories searched for blast
radius, extra rule sources, and model tier overrides.

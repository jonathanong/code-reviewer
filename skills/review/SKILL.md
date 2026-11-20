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
developing in a checkout; `help` lists the flags). Every subcommand prints a short JSON result, and `review` and `post` also append a row to a
machine-local tracker (`code-reviewer tracker` lists it). It authenticates as the GitHub App when
`CODE_REVIEWER_APP_ID` and a key are set, otherwise with the local `gh` login (`code-reviewer auth`
says which).

## Stacks

A pull request whose base is another open pull request's head is one member of a stack.
`prepare` finds the stack (same repository; the open pull requests are listed once, and a failure
to list them is a recorded problem, not a failed review) and writes `stack.json`, plus
`stack/<number>/INDEX.md` for each later member, with one numbered patch per file beside it, as for
the main diff. Pillars and the verifier then judge findings against
the top of the stack: a defect a later member fixes is kept as a `low` finding that starts with
`Fixed in #N:`, not a blocker. A stack whose root base is not the default branch is off-base, and
a base that no open pull request has as head is stale; `report.md` says so and the review still
runs. Members are reviewed and posted one at a time, bottom-up.

## Pushes that only merge the base

For a pull request that was already reviewed, `prepare` classifies what was pushed since (git in
the `--tree` checkout) and writes `push.json`. When every new commit merges the base, or history
was rewritten with the pull request's own change unchanged, the re-review is light: it judges the
merge resolutions (or the range-diff) and whether what came in from the base breaks the change,
using `merges/INDEX.md`, `incoming/INDEX.md` and `range-diff.txt`. A substantive push keeps its
usual mode, and its pillars and verifier still read the resolutions. `report.md` names the push
kind and the merges checked; a `problems` entry means git could not answer and the push was
treated as substantive.

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
   When the machine config lists `evidence` sources, one more run follows the verifier
   ([evidence](references/evidence.md)): it checks findings against those sources, appends an
   `Evidence` line to a supported or contradicted finding, adds an Evidence section to
   `report.md` and writes `evidence.json`. It never changes a severity or the verdict. A source
   reported `blocked` in `report.md` (denied command, missing credentials, unreadable guide)
   was not checked: say so when you relay the review.
   When the machine config lists `references`, the correctness and security pillars and the
   verifier also get `WebFetch`, allowed only for the listed domains, to check a specific claim
   against the documentation ([web-references](references/web-references.md)).

It prints one line:
`{claimed, mode, verdict, findings, questions, costUsd, report, review, headSha, fixedThreadIds}`. It
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

Show the human the verdict, the findings by severity, and `code-reviewer explain --run "$run"`
(a plain-language Markdown explainer built from the run's files, with no model call). With a
document connector (a first-party Claude Docs capability), put it in the session's document as a
section for this pull request marked "draft", and give the human the link instead; otherwise show
it inline. `report.md` holds the raw findings, the skills loaded and the cost by model. Ask
whether to post. Post without asking only when the human has said this kind of review may be
posted unattended. A human who wants a finding or question changed edits `review.json`; preview the result
with `post --dry-run`. The verdict is derived from the findings and questions (a blocking finding
requests changes; otherwise a high finding or any open question comments; otherwise approve), and
`post` fails a `review.json` whose `verdict` field disagrees, so remove that field when editing.

## Step 4 - Post or drop

- Post: `code-reviewer post --repo <repo> --pr <n> --head-sha <headSha> --input "$run/review.json"`,
  then mark the document section "posted" with the review link.
- Drop: `code-reviewer abort --repo <repo> --pr <n>` (add `--requeue` to ask again later).

`post` renders and posts the review:

- The top line is `[Approve]`, `[Request Changes]`, or `[Comment]`. The review is posted
  as `APPROVE`, `REQUEST_CHANGES`, or `COMMENT` to match the verdict. GitHub refuses approve and
  request-changes on the reviewer's own pull request, so there (the author is the `gh` login or
  the App bot), when the reviewer's identity cannot be determined, or when GitHub rejects the event
  with 422, it is posted once as `COMMENT`. `post` prints the `event` and, when it changed,
  `downgraded` (`self-review`, `identity-unknown`, or `rejected`). The tag, marker, labels and
  check run stay the source of truth for `status`; GitHub's review state is never read. A new
  review needs no dismissal of the reviewer's earlier request for changes: the newer approval or
  comment is enough.
- Open questions follow the finding index under a "Questions" heading.
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

`git -C <clone> worktree remove --force "$run/tree"`, then `rm -rf "$run"` once the explainer has
been recorded (`explain` reads the run directory, so it cannot run after this). Reply to the requester with the verdict and the review link. Merging agents check
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

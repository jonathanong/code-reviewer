# Replies to findings

`code-reviewer replies --repo owner/name --pr N [--post auto|hold] [--model replies=HARNESS:MODEL]`
re-assesses this reviewer's newest review of a pull request from what the author has answered since,
without a new review of the code. It is a command of its own, not a `run` mode: `run` claims the pull
request, checks the head out and runs pillars, and none of that is wanted here. It prints one JSON line
and exits like `run`: 0 applied, 10 held, 11 nothing to do, 12 precondition or config failure, 13 failure.

## What it reads

Only GitHub, no checkout. It acts when the newest review by this reviewer's identity covers the current
head. If the head moved, it does nothing and says so (`reason: the head moved since the last review`): a
follow-up review reads the replies itself. It also does nothing while the pull request carries a request,
in-progress or held label, when the author is the reviewer's own identity, or when no unresolved finding
thread has a reply by the pull request author after this reviewer last spoke in it.

Only the pull request author's replies count. Review text from anyone else is not read, a hidden marker
counts only from the reviewer's identity, and every reply is untrusted data.

## The call

One call on the `replies` model step (default tier `medium`, never a free model; set it under
[`models`](configuration.md#models) or with `--model replies=...`), with no tools and no checkout, so a
reply's claim about the code cannot be checked here. The prompt quotes the breaking-change rule of
[`verifier.md`](../skills/review/references/verifier.md) verbatim and puts every finding and reply in one
delimited data block. Each finding comes back as:

- `settled`: a reply shows it is not a defect, or gives what the finding itself asked for.
- `downgraded`: a valid acknowledgement lowers the severity (a breaking change, blocking to medium).
- `open`: anything else, including a reply that argues without evidence, promises a later fix, or
  claims something about the code the finding does not confirm.

Code checks the answer: an unknown or repeated thread, a missing reason, or a downgrade that does not lower
the severity leaves the finding open, and a failed call leaves every finding open and writes nothing. At
most ten threads are judged per call, and a thread longer than what the context reads is left out and listed
under `unjudged`.

## What it applies

The verdict is derived again with the verifier's rules (`deriveVerdict`) from the findings still open, at
their current severities: the review's findings with the settled ones removed and the lowered ones at their
new severity. It never raises a verdict, and it changes one only when the findings, as they stood, give the
posted verdict (otherwise something outside them shaped it and a full review should decide).

1. When the verdict changes, a new body-only review of the same head is posted through the same path as
   `post` (same identity, labels, check run and tracker row). Its id comes from the head and the judgments,
   so repeating the run cannot post it twice. Findings that still have a thread are counted but not posted
   again; a finding in the review body and the open questions are written again so the next review reads them.
   An Approve replaces an earlier Request Changes on GitHub by itself; a Comment dismisses this reviewer's
   stale Request Changes, as for any review ([Posting](posting.md#review-event-and-dismissals)).
2. In each judged thread it replies in one line with the outcome and why, carrying a hidden marker.
3. It resolves the threads of settled findings.

The review goes first: a failed post writes nothing in the threads and the command can be run again. A failed
reply or resolve is listed in `attention`, not an error. The markers are how the next run knows what was
judged and at what severity a finding stands: a thread whose last comment is the reviewer's has no new reply.

`--post hold`, and the `not-app-identity` hold rule under the `gh` login, write nothing: the line says `held`
and `applyCommand` is the command that applies it (the model call is made again). A configured App that
fails is a configuration problem, never a fall back to the login.

## Cost and trace

One small call per pull request with a new reply, no pillars, no evidence. Its cost is added to the head's
`report.json` as a `replies` record and a `replies` row in `usageByModel` and `ran`, and `report.md` lists it.
The JSON line carries `costUsd`.

## Trigger

[review-loop](../skills/review-loop/SKILL.md) wakes it on a `pull_request_review_comment` `created` event,
ignoring this reviewer's own login.

## Benchmark

`code-reviewer bench-replies --cases benchmarks/review/replies.json --out DIR [--attempts N]` runs the real
step on synthetic findings and replies and grades the outcome: a valid acknowledgement settles or lowers the
finding, and pushback without evidence, a promise to fix, a claim about code, and an instruction hidden in a
reply leave it open. See [the benchmark](../benchmarks/review/README.md).

# Posting a review

`code-reviewer post` sends the review `review` or `run` produced. This page covers what it sends,
how it survives GitHub failures, and how it confirms the result.

## Verdict and questions

The verdict is derived, never chosen, top-down: a verified `blocking` finding gives Request Changes;
otherwise a `high` finding or an open question gives Comment; otherwise Approve. A failed pillar is
listed as skipped and changes none of this (a failed [`approvalCheck`](configuration.md#approvalcheck) does: it makes
an Approve a Comment), and a review where every pillar failed fails instead.
The verifier may return `questions` (`question`, `askOf` `author` or `product`, and a required
`why`: what the answer changes). A question is for something the code and context cannot settle,
not a softened finding and not a request to explain code. Questions appear in `report.md` and under
a "Questions" heading in the posted review body, and the next review of the pull request reads them
as context so an answered one is not asked again. `post` recomputes the verdict from the findings
and questions; a `verdict` field in `review.json` that disagrees fails the review.

## Review event and dismissals

`post` submits the verdict as its own review event: Approve as `APPROVE`, Request Changes as
`REQUEST_CHANGES`, Comment as `COMMENT` (on the first part of a split review; later parts are
comments). GitHub refuses approve and request-changes on your own pull request, so when the
author is the reviewer's identity (the `gh` login, or the App bot; the same identity that decides
whose markers count) the review goes out as `COMMENT`. So it does when that identity cannot be
determined, or when GitHub rejects the event with 422: it falls back to `COMMENT` once, and the
`post` output says `event` and `downgraded` (`self-review`, `identity-unknown`, or `rejected`; the
tracker's `posted` row and `explain` carry both), so a review is never lost. The author comes from
the run's `context.json` when it is for the same head, and from the host otherwise. The first-line tag, hidden marker, labels and check run are unchanged and
still decide `status`; GitHub's own review state is not trusted. An `APPROVE` clears the reviewer's earlier
request for changes by itself, but a later `COMMENT` does not on GitHub, so the pull request would
stay blocked after the blocking findings were fixed. When the review goes out as a `COMMENT` and the
verdict no longer requests changes, `post` dismisses the reviewer's own earlier reviews that are
still in the changes-requested state, with a one-line message that links the new review. "Own"
means written by the trusted identity and carrying the hidden marker; nobody else's review is ever
touched. This is the only dismissal the tool performs. If the identity is unknown, the lookup
fails, or GitHub refuses a dismissal, the post still succeeds and `warnings` names each review left
standing. `dismissed` in the output lists the dismissed review ids; a dry run lists what it would
dismiss as `wouldDismiss` and dismisses nothing.

## Retries

GitHub calls survive transient failures. Every `gh` call goes through one retry policy
(`src/gh-cli/retry.mts`): 3 tries per call, so 2 retries, waiting about 1s then 2s (each wait is
jittered to between half and all of its step, and no backoff exceeds 8s). A 502, 503 or 504, a
reset, timed-out or dropped connection, and a secondary rate limit or 429 are transient; a wait
GitHub names with `retry-after` is honoured up to 60s, and a longer one fails the call. Every
other failure (401, 403, 404, 422, other 5xx, a missing `gh`, bad App config) fails at once.
Reads are retried, and so are the writes that are safe to repeat: adding or removing a label and
setting a commit status, and dismissing one named review (a repeat that is answered with "already
dismissed" counts as done). A review POST is never repeated blindly, because a request that timed out
may have landed; and the check-run POST is not repeated either, since a repeat would make a second
check run. A command that retried anything prints one stderr line, `warning: N GitHub calls were
retried after transient failures`.

## Read-back

`post` confirms what it posted. Before submitting, it records which reviews already exist; after,
it reads the pull request's reviews back and looks for the reviews that are new, written by the
reviewer's own identity (the same one that decides whose markers count), and carry this head's
hidden marker: the verdict marker for the first part, the part marker for each later part. Exactly
one per part is a confirmation, and the `post` output lists the ids as `reviewIds` (the tracker's
`posted` row keeps the first as `reviewId` beside `reviewUrl`, taken from the confirmed review).
A review POST that fails transiently is retried only after the read-back shows that part is not
there (so a post that timed out but landed is not repeated once the read-back sees it), up to the same 3 tries and
backoff; if it landed, `post` carries on with the review it found. If the reviewer's identity or
the review list cannot be read, the post is not retried at all and says the review may have posted.
GitHub's review list can lag behind a review it just accepted, so a read-back that misses a part
is repeated twice more, 1s apart, before the part is called absent; the same re-reads precede
deciding that a timed-out post did not land. A part still missing after that fails the command, and
the approval label is not set. More than one new review with the same marker is a warning in `warnings` naming every link;
nothing is deleted or dismissed. Dismissing the reviewer's own earlier request for changes happens
only after the new review is confirmed, so a failed or unconfirmed post never leaves the old block
cleared with no new review (the output then warns that it was not dismissed). A read-back that fails after its own retries is also a warning (the
review was submitted but could not be confirmed, `confirmed` is false), not a failure. A dry run
reads and confirms nothing.

## Replies to other reviewers

When `review.json` has `answers` and the `answers` setting is on ([configuration](configuration.md#answers)),
`post` replies in each thread once the review is confirmed as posted (otherwise every answer is
reported as skipped), with the same identity as the review.
The reply is the body, then either the location or `Rule: <plugin>:<skill>: "<quote>"` (the skill
name is not linked). It re-reads the threads first and skips one that is gone, resolved, longer
than what was read, already answered by this reviewer, or whose final text mentions someone. It
never resolves a thread. A failed reply does not fail the post. The `post` output has
`answers: { replied, skipped, failed }`, or `{ off: true }` when the setting is off. A dry run
replies to nothing.

## Posted text length

Posted text should be short. A review body targets 1,200 characters (the hidden marker and collapsed
details do not count) and an inline comment 800 (its collapsed `For the fix` section does not count). Above a target, `post` and the `review` preview
list a warning (`warnings` in the `post` output, "Posted text" in `report.md`); above three times a
target, a real `post` refuses unless `--allow-long` is given (`tooLong` lists those on a dry run).
`--body-target` and `--inline-target` change the targets. A fixed, conservative pattern list also
warns when authored text narrates the review (the verifier, a pillar, tool names, first-person
process, praise); it never refuses.

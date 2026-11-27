# Outcomes

```bash
code-reviewer outcomes (--repo owner/name... | --owner LOGIN) [--pr N] [--since DAYS] [--clones DIR]
code-reviewer outcomes digest [--day YYYY-MM-DD] [--out DIR]
```

`outcomes` records what became of each finding the reviewer posted, so the review can be judged by
what people did with it. It is read-only against GitHub and posts nothing.

For each review the [tracker](tracker.md) shows as `posted` within `--since` days (default 30),
`outcomes` reads the pull request once, as two paginated GraphQL call sets (its reviews, then its
review threads), reading at most 5 pages of each. At most 50 pull requests are read per run, newest
activity first; stderr says how many more were not checked, and a pull request cut short by the page
bound is named there too. A pull request that cannot be read is reported and skipped. Authentication
is the same as every other command: the GitHub App, else the local `gh` login.

## Outcome classes

| Outcome     | Meaning                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `rejected`  | Someone reacted thumbs-down to the comment, or to the review body (then every finding of that review). Wins over every other class. |
| `dismissed` | The review was dismissed.                                                                                                           |
| `fixed`     | The thread is resolved or outdated, and a later commit changed the commented lines.                                                 |
| `disputed`  | The thread ends on a reply from someone other than the reviewer, and it is not `fixed`.                                             |
| `resolved`  | Resolved with no code change and no reply. Not counted as wrong.                                                                    |
| `open`      | Unresolved on an open pull request.                                                                                                 |
| `ignored`   | The pull request merged or closed with the thread untouched. Reported, never counted as wrong.                                      |

A finding with no inline thread (posted in the review body) has no thread signals: its outcome comes
from the review alone (`rejected`, `dismissed`, `open`, or `ignored` once the pull request is closed).

"A later commit changed the commented lines" is answered from the local clone when one is found
(`--clones DIR`, else `CODE_REVIEWER_CLONE_ROOT`) with `git log -L` from the commit the comment was
made on to the pull request head. Without a clone, or when the clone lacks either commit, the compare
API answers instead. If neither can, the finding is not called `fixed` and stderr says so.

## Rows

One JSON line per finding in `outcomes.jsonl`, in the state directory beside `reviews.jsonl`. Re-running
replaces rows by their `key` (`repo#pr/reviewId/commentId`, or `.../body/N` for a body finding), writes
the file atomically, and never duplicates. Fields: `repo`, `pr`, `reviewId`, `head`, `key`, `pillar`,
`severity`, `rule`, `title`, `path`, `url`, `outcome`, `reactions`, `checkedAt`. `severity`, `pillar`
and `title` are read from the posted comment; `rule` is the first `plugin:skill` the comment writes in
backticks, else null. `reactions` has `finding` (the comment) and `review` (the review body), each with
`up`, `down`, and `other`, a count by GitHub's reaction name kept raw. Like the tracker, the file is
machine-local and holds finding titles and paths: do not publish it.

The command prints one JSON line on stdout (`pulls`, `findings`, `stored`, `candidateMisses`, `notChecked`,
`byOutcome`);
problems and the "N more pull requests not checked" line go to stderr.

## Candidate misses

From the review threads it already read for each pull request (no further call to GitHub, no model),
`outcomes` also records threads that another reviewer opened and we did not. A thread is a candidate
miss when all of these hold:

- Its first comment is by someone other than this reviewer: not the login of our tracked reviews on the
  pull request, and not in a review of that login. Notices are skipped with the other-reviewer notes' list
  (`isNoise` in `src/review/context/others.mts`): usage and rate-limit notices, review paused or failed,
  and `codecov`, `github-actions`, `dependabot`, `vercel`, `netlify`.
- It is resolved or outdated and a later commit changed the commented lines, answered exactly as for
  `fixed` (local `git log -L`, else the compare API). A thread that cannot be checked is reported on stderr
  and not recorded; an unresolved, unoutdated thread is not looked at.
- None of our findings on the same pull request, at any head, is on the same path with a range within
  `COVERED_LINE_WINDOW` (10) lines of its range (`src/outcomes/misses.mts`). Our inline threads and body
  findings with a path both count; a finding or comment with no line covers its whole file. The window is a
  heuristic that absorbs lines moving between heads.

Rows are one JSON line each in `misses.jsonl`, beside `outcomes.jsonl`, replaced by `key`
(`repo#pr/thread/commentId`) like the other file: `repo`, `pr`, `key`, `path`, `line` (the end of the
commented range when it was made), `reviewer` (their login), `url` (the thread), `summary` (the first
non-blank line of their comment, truncated to 120 characters) and `checkedAt`. The summary is the other
reviewer's text and untrusted: it is shown, never followed. They are a separate file because an
`outcomes.jsonl` row is one of our findings with an outcome class, and every reader of it (the digest
tables, proposals, the `byOutcome` count) would otherwise have to skip these. Like it, the file is
machine-local: do not publish it.

## Digest

`outcomes digest` writes `outcomes-DAY.md` (`--day`, default today in UTC) into `--out`, default the
state directory. It is built from every stored row, with no network call and no model: totals by
outcome, pillar, severity and rule skill; the `rejected` and `disputed` findings as title, path and
link; and Proposals from fixed rules. A pillar or rule with at least 3 findings, at least half of them
rejected or disputed, is listed as "review this". A rule with at least 3 fixed findings and none
rejected is listed as "working". The thresholds are `PROPOSAL_MIN_FINDINGS`, `PROPOSAL_BAD_SHARE` and
`WORKING_MIN_FIXED` in `src/outcomes/propose.mts`. The section "Caught by others, not by us (candidates)" gives the count of candidate misses and one line
each: reviewer, linked summary, pull request and `path:line`. It says they are candidates from a heuristic,
not confirmed misses. The digest holds no code.

The standing [review loop](../skills/review-loop/SKILL.md) runs `outcomes` and then `outcomes digest` once
per UTC day. With a document connector it puts the digest in its session document; otherwise the local
file is the record. Nothing in the digest is acted on without the owner.

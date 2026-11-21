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

The command prints one JSON line on stdout (`pulls`, `findings`, `stored`, `notChecked`, `byOutcome`);
problems and the "N more pull requests not checked" line go to stderr.

## Digest

`outcomes digest` writes `outcomes-DAY.md` (`--day`, default today in UTC) into `--out`, default the
state directory. It is built from every stored row, with no network call and no model: totals by
outcome, pillar, severity and rule skill; the `rejected` and `disputed` findings as title, path and
link; and Proposals from fixed rules. A pillar or rule with at least 3 findings, at least half of them
rejected or disputed, is listed as "review this". A rule with at least 3 fixed findings and none
rejected is listed as "working". The thresholds are `PROPOSAL_MIN_FINDINGS`, `PROPOSAL_BAD_SHARE` and
`WORKING_MIN_FIXED` in `src/outcomes/digest.mts`. The digest holds no code.

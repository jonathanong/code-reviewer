# Tracker and explainer

```bash
code-reviewer tracker [--repo owner/name]... [--since ISO_DATE] [--state reviewed|posted|skipped|failed] [--format json|csv|markdown]
code-reviewer explain (--run DIR | --repo owner/name --pr N)
```

Every `review` appends one row to a tracker, and `post` appends a `posted` row to it. A row is
one review run of one pull request head: repository, number, title, author, head SHA, mode (`full`,
`light`, `follow-up` or `skip`), verdict, finding counts by severity, the number of open questions
when `review.json` has a `questions` list, cost, start and finish times, the run directory, and a state:
`reviewed` (produced, not posted), `posted` (with the review link and id, the event actually posted, and `downgraded`, the reason it was a COMMENT instead of the verdict's own event), `skipped` or `failed`
(with the reason). A later row for the same repository, pull request and head replaces an earlier
one, except that `posted` adds to the `reviewed` row it follows. `tracker` prints that folded state;
`post` also saves `posted.json` in the run directory: for each finding of `review.json`, by its
`F<n>` id, whether it became an inline comment or went in the review body, so a later review can
tell which findings reached the pull request. It changes nothing that is posted, a save failure is
reported as `trackerProblem`, and a run directory without it simply has no per-finding status.
CSV cells that begin with a spreadsheet formula character are prefixed with an apostrophe.

The tracker is `reviews.jsonl` in the state directory: `CODE_REVIEWER_STATE_DIR`, else
`code-reviewer` under `$XDG_STATE_HOME` (default `~/.local/state`). It is JSON Lines so concurrent
runs append whole lines without a lock. A line that cannot be read is reported and skipped. The
tracker is machine-local, the tool never syncs it, and it holds private pull request titles and author logins:
do not publish it. A tracker failure is reported as `trackerProblem` in the command's output and
never fails a review or a post.

When a step fails because of its harness (see [Filing issues](issues.md#what-is-proposed)), the
tracker also appends one line per step to `harness-failures.jsonl` beside it:
`{at, harness, step, kind, run}`, `run` being `repo#pr@head`, which keeps a review that is
recorded twice from counting twice. It holds no error text. The kind comes from `report.json`'s
`ran` list; a review that fails before its report (the verifier, skill selection, or every pillar
failing) leaves the failed steps in `failed-steps.json` in the run directory, which is read the
same way. The harness version is not recorded: only a stream-json run prints it, and a step that
timed out or printed nothing has none.

`explain` prints a Markdown explainer for someone who has not read the code: what the pull request
does, the verdict and why it is that verdict in plain words (a blocking finding: Request Changes; a
high finding or an open question: Comment; otherwise Approve), the event it was posted as when that
differs from the verdict (read from the tracker's `posted` row), each open question with who is asked
and why it matters, each finding (claim, where, why it matters and what
would fix it, most severe first), what was and was not checked, and the cost. It
is built from `review.json`, `report.json`, `evidence.json` and `stack.json` in the run directory,
any of which may be missing, and makes no model call and no network request. With `--repo` and
`--pr` it uses the run directory of the latest tracked run, which must still exist. The skills put
this text in a Claude Doc when the session has a document connector; the CLI never talks to one.

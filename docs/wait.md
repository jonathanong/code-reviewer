# Waiting for work

```
code-reviewer wait --owner LOGIN[,LOGIN...] [--timeout 2h] [--cursor-name NAME]
                   [--ignore-sender LOGIN]... [--label NAME]...
```

The review loop's wait. It runs [hook-harness](https://www.npmjs.com/package/hook-harness)
(`npx -y hook-harness@<pin> wait`, the pin lives in `src/wait/harness.mts`), looks at each event in
code, and exits only with work that needs the session. Most review-comment events are agents
replying in a CodeRabbit thread under the login authors use, and need nothing from this reviewer;
`wait` drops those without waking the session.

It prints one JSON line and exits:

| Exit | `outcome` | Meaning                                                                                  |
| ---- | --------- | ---------------------------------------------------------------------------------------- |
| 0    | `work`    | `requests` to review, or `attention` from a replies run                                  |
| 0    | `gap`     | hook-harness lost history: run `queue` to sweep, skipping `held` entries                 |
| 11   | `timeout` | `--timeout` passed with nothing to do (default `2h`)                                     |
| 12   | `error`   | a configuration problem (a bad flag, an unknown identity, the App, a hook-harness login) |
| 13   | `error`   | hook-harness failed; a rate limit is retried twice first                                 |

The line is `{outcome, exitCode, requests, attention, handled, dropped, problems, gap, timedOut,
cursor, error}`.

## Request labels

A `labeled` event with a request label (each owner's `labels.requested`, plus any `--label`) is
dropped when this reviewer sent it, when it is for an issue, when the pull request is closed, when
the request label is no longer on it (events replay for a day, so the label is the truth), or when
`run`'s own first check would decline the head: already reviewed, in progress, held, or stopped at
the cost ceiling (`preflight`, see [Unattended runs](run.md)). Like `run`, that check puts back the
completed label of a head that was already reviewed. What is left is `requests: [{repo, pr,
headSha}]`, one per pull request at its current head. Start `run` for each.

## Replies in this reviewer's threads

A `pull_request_review_comment` `created` event is dropped, in this order, when:

1. the sender is this reviewer or in `--ignore-sender` (default `coderabbitai[bot]`);
2. the comment starts a thread (the payload has no `in_reply_to_id`), or the thread's first comment
   is not this reviewer's (one read per thread: `GET pulls/comments/<in_reply_to_id>`);
3. the pull request is closed;
4. this reviewer has no review of it;
5. it carries a request, in-progress or held label (a review reads the replies itself).

Otherwise `wait` runs [`replies --post auto`](replies.md) in this process. A held (10) or failed
(12, 13) result goes to `attention` with its `reason`, `attention` lines and `applyCommand`; an
applied or no-op result is only counted in `handled` and does not wake the session.

## State and failures

The cursor is kept in `wait-<cursor-name>.cursor` in the state directory (see
[the tracker](tracker.md)), and moves only after a batch is handled, so a crash replays it. A
failed read of one pull request is listed in `problems`: its request is still returned (`run`
checks it again), and a failed replies run goes to `attention`.

Only one `wait` should run per cursor name and set of owners. A `--ignore-sender` replaces the
default list; this reviewer's own login is always ignored.

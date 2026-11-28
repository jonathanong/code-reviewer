# Waiting for work

```
code-reviewer wait --owner LOGIN[,LOGIN...] [--timeout 2h] [--cursor-name NAME]
                   [--ignore-sender LOGIN]... [--label NAME]...
```

The review loop's wait. It polls [hook-harness](https://www.npmjs.com/package/hook-harness) in this
process with its client API (`hook-harness/client`, bundled into `vendor/hook-harness-client.mjs`
by `pnpm run vendor`, so a plugin install needs no `node_modules`), looks at each event in code, and
exits only with work that needs the session. One poll covers every `--owner`. It needs the login
`hook-harness login` saves, or `HOOK_HARNESS_URL` and `HOOK_HARNESS_TOKEN` in the environment. Most review-comment events are agents
replying in a CodeRabbit thread under the login authors use, and need nothing from this reviewer;
`wait` drops those without waking the session.

It prints one JSON line and exits:

| Exit | `outcome` | Meaning                                                                                                                |
| ---- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0    | `work`    | `requests` to review, or `attention` from a replies run                                                                |
| 0    | `gap`     | hook-harness lost history: run `queue` to sweep, skipping `held` entries                                               |
| 11   | `timeout` | `--timeout` passed with nothing to do (default `2h`)                                                                   |
| 12   | `error`   | a configuration problem (a bad flag, an unknown identity, the App, the hook-harness login or token, a rejected cursor) |
| 13   | `error`   | hook-harness outage: five failed polls in a row for one owner                                                          |

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
[the tracker](tracker.md)), and moves only after a batch is handled, so a crash replays it. It is
the cursor hook-harness prints, covering every owner, in the format `hook-harness wait` saves, so
either can resume the other: the review loop's cursor from the CLI keeps working. A cursor
hook-harness rejects is a configuration problem (exit 12) naming the file; delete it to start from
now.

`--timeout` is an abort signal on the poll; the wait ends with exit 11 and the last cursor.

hook-harness retries a failed poll itself, with a growing pause (10s, 20s, 40s, 80s). `wait` counts
the failed polls in a row for each owner (a good poll for that owner resets its count) and returns
the outage with exit 13 at five, about two and a half minutes: long enough to ride out a rate limit
or a relay restart, short enough that the loop hears of a real outage within minutes. A poll that
cannot succeed is a configuration problem instead (exit 12), without a retry: no login, a token the
relay refuses (401) or whose scope lacks an owner (403), a request the relay rejects (400), or a
relay URL that is not `https` (or `http` on localhost).

A failed read of one pull request is listed in `problems`: its request is still returned (`run`
checks it again), and a failed replies run goes to `attention`.

Only one `wait` should run per cursor name and set of owners. A `--ignore-sender` replaces the
default list; this reviewer's own login is always ignored.

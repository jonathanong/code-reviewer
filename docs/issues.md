# Filing improvement issues

```bash
code-reviewer issues [--dry-run] [--since DAYS]
```

`issues` files an issue in the repository that owns a rule, a plugin, this reviewer or a harness when the
[outcomes](outcomes.md) data says a rule or pillar is being rejected or disputed, or the
[tracker](tracker.md) says a harness keeps failing steps. It is off unless the machine
config sets [`issues`](configuration.md#issues). Nothing runs it automatically: `run` and `outcomes`
never call it, so the owner, or a loop of theirs, runs it. A configured target is the opt-in, so
the code files without judging the content.

## What is proposed

From the stored outcome rows checked in the last `--since` days (default 30), one proposal for each
rule or pillar with at least `PROPOSAL_MIN_FINDINGS` findings, at least `PROPOSAL_BAD_SHARE` of
them rejected or disputed (the digest's "review this" rule, shared in `src/outcomes/propose.mts`).
A group that is working proposes nothing.

| Proposal                         | Key                            | Target          |
| -------------------------------- | ------------------------------ | --------------- |
| a rule `plugin:skill`            | `rule:<plugin>:<skill>:review` | the plugin name |
| a pillar (the reviewer's prompt) | `pillar:<name>:review`         | `code-reviewer` |
| a harness failure kind           | `harness:<harness>:<kind>`     | `harness`       |

A harness is the headless CLI a step ran through (`claude`, `grok`, `opencode`). A step that fails
for a reason that is the harness's is recorded in the tracker's `harness-failures.jsonl` with a
kind: `timeout`, `rate_limited` or `overloaded` (the wait budget ran out), `unsupported_flag` (the
CLI rejected an argument), `crash` (a non-zero exit with no result) or `unparseable` (no JSON
result). A step the model answered (such as a turn limit), a credentials failure and an adapter
refusing a step are not harness failures. A step that failed and then succeeded on a retry or
another candidate is not counted. Per harness and kind, at least `HARNESS_MIN_FAILURES` (3) such
steps in the last `--since` days give one proposal. Its body holds the harness name, the kind, the
count, step names (built-in only; a configured pillar is "configured pillar") and the first and
last date. It holds no error text, repository, path or code, and no harness version, which is not
recorded. Its title and last line are as for the other proposals.

The body of a rule or pillar proposal holds the counts by outcome, the finding titles of up to 10 rejected or disputed findings
each linked to its pull request comment, and what is proposed. It never holds code, paths or
comment text. Its last line is the hidden marker `<!-- code-reviewer:issue <key> -->`. The
evidence links of a rule or pillar proposal point at the reviewed repositories, so use targets only
where whoever reads the issue may follow them.

## Which issues are filed

A proposal whose target name matches no `issues.targets[].name` is skipped. For the rest, in key
order:

1. Filed by this machine within the last 24 hours (`issues.jsonl` in the state directory, beside
   `reviews.jsonl`, rows `{key, repo, url, filedAt}`): skipped without a search.
2. An open issue in the target repository whose body carries the marker
   (`gh issue list --state open --search`): skipped, and its URL is reported.
3. `maxPerDay` issues already filed in the last 24 hours across all targets: skipped.
4. Otherwise `gh issue create` with the title, a body file and the target's labels, and a row is
   appended to `issues.jsonl`.

`--dry-run` does everything except the create and the record: the searches run, and each issue it
would file is listed with a `null` url and counts toward `maxPerDay`. A failing `gh` call (the
search or the create, each with a 30 second timeout) skips that proposal with the reason, and the
rest go on. Calls use the same authentication as every command; under App auth the App must be
installed on the target repository.

## Output

One JSON line on stdout, `{filed: [{key, repo, url}], skipped: [{key, reason}], dryRun}`; one
human line per proposal on stderr. The exit code is 0, except 2 when the `issues` config is
invalid or `--since` is not a positive integer.

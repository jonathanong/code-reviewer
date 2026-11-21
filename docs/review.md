# Running a review

```bash
code-reviewer review --repo owner/name --pr N --out DIR --tree CHECKOUT [--jobs N] [--clones DIR] [--effort low|medium|high] [--model STEP=HARNESS:MODEL]... [--max-cost USD] [--quiet] [--force]
code-reviewer report --out DIR
```

Every model call is one headless step run through a harness adapter in `src/harness/`. A step
asks for capabilities (read-only file tools, skills, an explorer subagent, shell limited to command
prefixes, web fetch limited to hosts, or no tools), and the adapter turns them into the CLI's flags
and reads its output. Each step's harness and model come from [`models`](configuration.md#models)
and `--model`, which may name `claude`, `grok` or `opencode`. Selecting Grok or OpenCode sends the
pull request's diff and files to that provider, so name them only where that is acceptable.

Grok (`src/harness/grok.mts`) is a second adapter, run as `grok -p`. It runs read-only steps: file
reads and searches, or no tools, with Grok's subagents, web search and MCP gateway off and the
user's Claude and Cursor skills, rules, hooks and MCP servers not loaded. It refuses a step that
needs shell prefixes or web hosts, because it cannot confine them, before starting anything.

OpenCode (`src/harness/opencode.mts`) is a third, run as `opencode run --format json --pure`. It
runs read-only steps: file reads and searches, or no tools. It confines the step with a deny-all
permission config in `OPENCODE_CONFIG_CONTENT` that allows only the read tools (plus reads in
`addDirs`, through an `external_directory` rule), so the user's shell and MCP tools are gone, and it refuses shell prefixes and web hosts before starting anything. It
has no schema flag, so the prompt asks for one JSON object and the reply is checked for the
schema's required keys. It ignores `explorer`, `skills`, `settings`, `transcript` and
`maxTurns`, so the turn limit is not enforced. At its free usage limit OpenCode prints nothing and hangs, so
the step ends at its timeout; the adapter reads the limit from the error log and reports the
failure as a rate limit too long to wait out, and the step moves to its next candidate.

Config rejects what it can know from the step's key: the `pillar.history` and `evidence` steps need
shell, so a list in which every candidate is Grok or OpenCode is a problem, and no free model
(`isFreeModel`, a naming heuristic) may run `verifier`, `verifier.light` or `approvalCheck`. The web
hosts the correctness and security pillars and the verifier get depend on `references`, so those are
checked at run time: when an adapter refuses a step, the runner moves to the next candidate, and
the step fails only if none is left.

[`run`](run.md) is the unattended path. `review` runs one pull request end to end with headless `claude -p` calls and stops before
posting, so you can read the result first. `--tree` is a checkout at the pull request head and
`--out` receives the run files; both become absolute paths. It claims the pull request (a head the
newest review already covers is declined unless `--force`), runs `prepare`, asks Haiku to pick
rule skills for the changed files (the review stops there, with nothing posted, when that call fails
twice or no rule skill is installed), builds the [pillar context](context.md#in-a-review) when it can, runs the pillars the plan chose (`--jobs` at a time, default 3,
each retried once), runs the verifier, and writes:

- `review.json`: the input `post` accepts. Post it after reading `preview.md`:
  `code-reviewer post --repo owner/name --pr N --head-sha SHA --input DIR/review.json`.
- `preview.md`: the reviews `post --dry-run` would send.
- `report.md` and `report.json`: the pull request, mode and effort, what it does, the verdict, the
  verified findings, and, per pillar, the model, skills loaded, cost, turns, and every raw finding
  with whether the verifier kept or dropped it and why, the total cost, and a "Tokens by model"
  table for selection, pillars (failed attempts included), and verifier, and a "Models" table with the harness and model each step ran on and how long it waited on rate limits. `report.md` is rendered from
  `report.json`; `code-reviewer report --out DIR` renders it again, for a running document.
- `skills.json`, `pillars/<pillar>.json`, `verifier.json`: the intermediate results.
- `review-context.md`: the context the pillars read; absent when it was not built.

The run prints one JSON line with the mode, verdict, finding counts, total cost, and file paths.
Labels stay at processing. A `skip` plan closes the pull request through `skip` (a short skip
review on the head, then the labels) and writes a short report. If anything fails after the claim, the claim is dropped without a requeue and the
command exits 1. A pillar that fails twice is posted as skipped with a short reason. If every
pillar fails, the review fails closed instead of approving unchecked code.

## Author rules

The plan picks `skip`, `light` or `full`. A pull request whose author has a rule
([`plan.authors`](configuration.md#plan); Dependabot has a built-in `light` one) is skipped or
reviewed lightly, and manifest, lockfile and workflow edits do not trigger the security pillar
under `light`. The rule holds only while every commit of the pull request is the author's.
`prepare` lists the pull request's commits from GitHub (REST `pulls/N/commits`, at most 200 read)
and counts a commit as the author's only when GitHub attributes it to that account, has verified it,
and records the committer as that account or GitHub itself (`web-flow`). A commit by anyone else,
an unverified commit, one made by the "Update branch" button, or a list that cannot be read, is
too long, or does not end at the head, ends the rule: the normal plan applies and the plan's
reasons say why. An explicit `--effort` keeps its usual precedence over a rule.

## Configured pillars

[`pillars`](configuration.md#pillars) adds pillars and switches built-in ones off. The plan runs an
extra in the modes it names, and also when a follow-up has an open finding of its own; a push that
only merges the base or rewrites history re-runs only an extra with an open finding. An extra is a
step like any pillar: it has the same read-only capabilities (no shell, no web), output contract,
retry and failure handling, a `pillar.<name>` model step, and its own row in progress lines,
`pillars/<name>.json` and the report. A `prompt` pillar is built from its text under the pillar
contract; a `when` trigger sits at its top, and a pillar it does not fit returns no findings
instead of costing a separate call. A `run` pillar sends its command as the whole prompt followed by
the contract, so it needs a harness that understands the command. The verifier and the approval
check accept the extra's name on findings.

## Findings: premise and prevention

A reviewer may challenge whether a change should exist in this form (it solves the wrong problem,
duplicates something already in the tree, or a much smaller change reaches the stated goal), but
only with evidence from the tree or the context, as a `medium` or `low` finding that the verifier
may turn into a question; never as `blocking` or `high` on that ground alone. These are prompt
rules in the pillar contract, with no code check.

A finding's `body` is for the human reading the review: what is wrong and why it matters. Two
optional fields hold what only whoever fixes it needs. `fix` is exact steps, file lists, commands
and reproduction. `prevent` is one line naming a lint rule, type, test or CI guard that would stop
the class of mistake; over 160 characters it warns like any over-long posted text. Both are kept in
`review.json` and posted together in one collapsed `For the fix` section under the finding (inline
comment or body finding); `report.md` shows them as plain lines. With neither, no section is
rendered. Another reviewer's credit stays visible, after the section.

## Other reviewers' open items

Normally a finding that repeats another reviewer's open thread is dropped as already raised. `prepare`
records in `context.json` (`restatable`, at most 10) the unresolved, not outdated threads started by
anyone but this reviewer whose first comment states a blocking or high severity through a marker in
`SEVERITY_MARKERS` ([Shared context](context.md#other-reviewers)): author, link, location and the
visible start of the comment. It reads the conversation `prepare` already fetched.

When the list is not empty, the verifier prompt gets one more block, separate from the thread ids,
and its output schema allows `raisedBy` on a finding. The verifier checks each item against the head
like a pillar finding. A valid, still present item it would rate blocking or high itself becomes a
finding in its own words that carries `raisedBy: { login, url }`; if one of its findings already
covers it, that finding gets the credit instead. An invalid or fixed item is left out, and an item of
a lower or unstated severity behaves as before. The credit counts only when `url` is a listed item,
and the login is the listed one. The posted finding ends with `Also raised by [login](link)` (link
text without `@`, so nobody is notified). The verdict follows the finding's severity like any other,
so a restated blocking item gives Request Changes. With no items the prompt and schema are unchanged.

## Changes that fix a regression

The linked-regressions section of the pillars' context ([Shared context](context.md)) reads the
pull request's own commit messages for reverts, `Fixes <sha>` and regression mentions, and keeps the
commits it finds in local history. `review` reuses that one result, with each commit's sha, subject,
files, and `how` it was linked (`revert`, `fixes` or `mentioned`), so git runs once. The references
are claims made by untrusted text; a commit not in local history is not passed on.

When at least one commit was found, the verifier prompt gets one more block and its output schema an
optional top-level `regressionPrevent` string. The verifier checks that the diff addresses what those
commits broke, as far as the diff, their subjects and their files show, and raises a normal finding
if it plainly does not. It also gives at most one line of up to 160 characters: a MUST NOT or
SHOULD NOT sentence, or a test or eval case, that would have caught the regression, or `Covered by
<skill>: <rule>` when a loaded rule already does, or nothing. It is the same idea as a finding's
`prevent`, one level up, and is only kept when the block was given. It is saved as
`regressionPrevent` in `review.json` and shown in the review body and in `report.md` under a
collapsed `Preventing this regression` section; `report.md` also lists the commits. Nothing files an
issue from it. With no commit found the prompt, schema and command line are unchanged.

## Large changes that mix mechanical and other edits

The change-shape section ([Shared context](context.md)) measures a large change from git alone:
hunks that make the same normalised edit, whitespace-only lines, renames, and the config keys that
changed. `review` builds it in the same context run as the pillars' sections but writes none of it
to `review-context.md`; it keeps one structured summary of it, so git runs once. The summary
exists only when a split is worth proposing: the change has at least `SPLIT_MIN_LINES` reviewable
lines, a mechanical part of at least `SPLIT_MIN_MECHANICAL_LINES` lines, `SPLIT_MIN_MECHANICAL_SHARE`
of the change and `SPLIT_MIN_MECHANICAL_FILES` files, and a remainder of at least
`SPLIT_MIN_REMAINDER_LINES` lines and `SPLIT_MIN_REMAINDER_SHARE` of the change (all in
`src/review/context/change-shape/analyze.mts`). A change that is almost all mechanical, or has no
mechanical part, or is only big, gets none: a purely mechanical pull request is fine as it is. Every
number errs toward no proposal: the mechanical lines and files are the larger of the repeated-edit and
whitespace-only measures (so "at least"), the remainder subtracts their sum ("at most"), and a change
whose patch or hunk analysis hit a cap gets none.

With a summary, the verifier prompt gets one more block, the summary as measurement of this diff
(not instructions), and its output schema an optional top-level `splitProposal` string. The
verifier gives one or two sentences (under 240 characters) naming what to move into its own pull
request and what stays, or omits it when a split would not help, for example because the parts
depend on each other. It is advice: it never changes a finding, a severity or the verdict. It is
kept only when the block was given, saved as `splitProposal` in `review.json` and `report.json`,
and shown as one line near the top of the review body (not collapsed) and under `Proposed split` in
`report.md`. A longer one makes `concise` warn. With no summary the prompt, schema and command
line are unchanged.

## Follow-ups build on this machine's last review

On a follow-up (a light review of the diff since the last reviewed commit, `plan.sinceSha` set),
`review` also reads the most recent review of this pull request in the [tracker](tracker.md)
whose reviewed commit is a strict ancestor of the head, from the same context run as the other
sections (the past-reviews section, which is never written to `review-context.md`). It keeps
a structured form of it: the commit, date, mode, verdict, whether that review was posted (the
saved data says nothing per finding), and its verified findings with severity, pillar, title and
place, read from that run's `report.json`. A first review, a full review, a missing state
directory, and a force-push that orphaned every earlier head get nothing, and the prompt is
unchanged. If the newest such review's run directory or `report.json` is gone or unreadable,
`report.md` says `Earlier review: not given to the verifier (...)` and the review goes on; no
older review stands in.

With one, the verifier prompt gets one more block (not instructions: earlier claims at an older
commit). The re-review is additional: it reports only what is new since that commit or what the
diff since it made wrong, does not repeat a finding that is still open in an unresolved thread of
ours (the re-review step of the verifier already covers it), and reports a fixed one through
`fixedThreadIds`, as before. No output field or schema changes.

Saved evidence is offered only for a source that declares `paths` (see
[evidence](configuration.md#evidence)). `review` reads the earlier run's `evidence.json`, lists with
local `git diff` the paths changed between the commit each source ran against and the head, and
keeps the `checked` sources none of whose `paths` changed. A missing sha, an `evidence.json` saved
without a scope, an unknown scope or a git failure keeps nothing. When any are kept, the verifier
prompt gets a second block after the earlier-review block, naming each source, the commit it ran
against, its status and its saved queries and results (capped at the evidence result limit), and
saying that this earlier evidence still applies because none of the paths it depends on changed
and that it was gathered at that commit and has not been re-run, so where the current code
contradicts it the code is right; the saved text is untrusted data. With no such source the block is absent and the earlier-review block says to
establish again any evidence the review relies on. The evidence step still runs on every
follow-up. `report.json` records the offered sources as `earlierEvidence`, and `report.md` lists
them.

## Progress and the cost ceiling

`review` writes one line to stderr when each step starts and when it ends, and one when a step
waits on a rate limit:

```text
code-reviewer: pillar.design claude:sonnet started
code-reviewer: pillar.design claude:sonnet waiting 5.0s on a rate limit
code-reviewer: pillar.design claude:sonnet done in 41.2s, $0.31
code-reviewer: verifier claude:opus failed in 9.8s: claude exited with 1
code-reviewer: pillar.security claude:sonnet skipped: cost ceiling reached ($1.02 of $1.00)
```

The harness and model are those that ran the step; the cost is left out when the harness reported
none. Stdout still carries only the JSON summary, and the lines never reach a prompt or a command
line. `--quiet` turns them off.

`--max-cost USD`, or [`limits.maxCostUsd`](configuration.md#limits), stops steps from starting once
the cost reported so far reaches the ceiling. Steps that report no cost count as zero. A review
that skipped a step this way is never an approval.

## Headless runs

Every headless run passes `--strict-mcp-config --setting-sources user` and
`--settings '{"enabledPlugins":{...}}'` listing each enabled plugin, true only for the configured rule
plugins (`rulePlugins`; by default `no-mistakes-rules` and `jong-skills`, and none for `[]`). That keeps fixed context near 17k tokens instead of
about 139k. Pillar runs also get a read-only Haiku `explorer` subagent. The same flags apply to
`bench`, where `--no-rules` sets every plugin false.

A run that has a shell (the history pillar and the evidence run) or a web tool (see `references`) passes `--setting-sources ''`
instead, so no settings file is loaded. User settings can allow commands of their own, or allow
every sandboxed command, and either would widen the run's allow-list. Such a run can execute its
listed prefixes and the read-only commands Claude Code always permits (`echo`, `ls`, `git log` and
the like); a chained or substituted command is denied whole.

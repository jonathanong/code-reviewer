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
permission config in `OPENCODE_CONFIG_CONTENT` that allows only the read tools, so the user's shell
and MCP tools are gone, and it refuses shell prefixes and web hosts before starting anything. It
has no schema flag, so the prompt asks for one JSON object and the reply is checked for the
schema's required keys. It ignores `explorer`, `skills`, `settings`, `addDirs`, `transcript` and
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

A finding may carry `prevent`, one optional line naming a lint rule, type, test or CI guard that
would stop the class of mistake. It is kept in `review.json`, shown as a `**Prevent:**` line under
the finding in the posted comment and in `report.md`, and absent means nothing is rendered. A
`prevent` over 160 characters warns like any over-long posted text.

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

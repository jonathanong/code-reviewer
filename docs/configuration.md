# Configuration

No repository needs a config; every key has a default. Settings come from three layers, and for
each top-level key (`labels`, `checkRun`, `consumes`, `evidence`, `analysis`, `references`, `approvalCheck`, `rulePlugins`, `trustRepoConfig`, `pillars`, `targets`, `plan`, `models`, `limits`, `issues`, `answers`, and `run`) the highest layer that sets it wins. `labels`
merge by label name.

1. Machine config: files in `$CODE_REVIEWER_CONFIG_DIR`, else
   `${XDG_CONFIG_HOME:-$HOME/.config}/code-reviewer/repos`. `<owner>/<name>.yaml` holds one
   repository's settings and `<owner>.yaml` (beside the `<owner>/` directory) the settings its
   repositories share; the repository file beats the owner file.
2. `.code-reviewer.yaml` at the root of the reviewed repository, in the format of a repository
   file. It is read from the repository's default branch, never from the pull request, so a pull
   request cannot change its own settings. `prepare` reads it from the clone's `origin/HEAD`, or
   through the GitHub API without a clone; the other commands read it through the API once per
   repository they act on. A missing file is no config; any other read failure is a problem.
3. Built-in defaults.

A problem in any of these files, in any key, for the repository or its owner stops `run`,
`review`, `claim`, `abort`, `skip`, `prepare`, `post` and `context` before any work, with
`settings invalid:` and a message naming the file and key; nothing is claimed, posted or sent to
a model. The reviewed repository's own file counts, as it stands on its default branch. `settings`
and `doctor` print the problems and do not fail.

Every config file is YAML or JSON, chosen by the name's ending: `.yaml` and `.yml` are YAML;
`.json` and `.jsonc` are JSON with comments and trailing commas allowed (JSONC). The same names
apply to every config file: `<owner>.yaml`, `<owner>/<name>.yml`, `.code-reviewer.jsonc`, and the
App's `app.yaml` (see [authentication](authentication.md)). The examples below are YAML; each
setting reads the same in JSON.

A config kept in two files, in any two of the endings (`acme.json` and `acme.yaml`, or `acme.yml`
and `acme.yaml`), is a problem that names both; neither is used. Through the GitHub API the root
is listed once and only the file found is fetched, so a repository without one costs a single
request and a duplicate is still seen. A file that does not parse, or whose top level is not an
object (a mapping, in YAML), is a problem naming that file, with the line for YAML. An empty file
does not parse as JSON and is not a mapping in YAML, so it is a problem too; `{}` is the explicit
empty config. Problems fail `run` before it claims anything, and `settings` prints them.

YAML is read as plain data only: the YAML 1.2 core schema, so unquoted `yes`, `no` and dates
are strings, and a value of the wrong type is rejected as in JSON (quote a label or repository
name that could read as a number). A file may hold one document. Duplicate keys, tags (`!!str`,
`!custom`), aliases and anchors (`&a`, `*a`) are errors, and `<<` is an ordinary key, not a merge.

```yaml
# <owner>.yaml
labels:
  requested: review-me
```

`code-reviewer settings --repo owner/name` prints the resolved values and the layer each came
from. An owner-wide `queue` or `settings --owner` reads machine configs only, since a repository's
own file is read when the repository is named.

## `consumes`

```yaml
consumes:
  - repo: acme/api
    via: HTTP API
    paths: [src/routes/**]
```

- `consumes`: repositories this one depends on without a package import. `repo` is `owner/name`.
  `via` (optional) says how in a few words. `paths` (optional) are globs in the consumed
  repository that this one depends on; without it, any change there counts.

Only the consumer's config declares the link. `prepare` uses it in both directions, for
repositories cloned under the clone root (matched by their `origin` URL, or by directory name
without one):

- A pull request in the consumer stages the consumed repository's instructions, skills, and code
  location as a dependency, ahead of dependencies found by import.
- A pull request in the consumed repository that touches `paths` stages the consumer under
  "Consumers" in `rules/INDEX.md`, for the blast-radius pillar. Only machine configs are
  searched for consumers, because a consumer's own file is read when its pull request is reviewed.

A malformed file, an unknown key, or a configured repository with no clone is listed under
"Missing" in `rules/INDEX.md` and in `prepare`'s output; none of them stops the review.

## `evidence`

Evidence sources let a review check findings against real data, such as production logs, instead
of guessing. They are machine-only unless [`trustRepoConfig`](#trustrepoconfig) is on: `evidence`
in a repository's own `.code-reviewer` file is otherwise ignored with a problem, because that file
is controlled by whoever can push to the default branch and a source grants command access and
credentials. A repository file's list replaces its
owner file's list whole; `[]` switches evidence off for that repository.

```yaml
evidence:
  - name: aws
    description: Production logs and metrics.
    guide: { repo: acme/infra, path: docs/production-data.md }
    commands: [aws logs filter-log-events, aws logs start-query]
    env: { AWS_PROFILE: readonly }
```

- `name`: a simple identifier, unique in the list.
- `description`: one line on what the source can answer; the run uses it to skip sources that
  cannot bear on a change.
- `guide`: how to query the source. `{ "repo", "path" }` is read from that repository's clone under
  the clone root at its remote default branch (never the working tree, never a pull request);
  `{ "file" }` is a path on this machine, `~/` allowed.
- `commands`: command prefixes of at least two words, each allowed as `Bash(<prefix>:*)`; beyond
  them the run has only the read-only commands Claude Code always permits. Grant read-only prefixes: a prefix is only as safe as the CLI's subcommand.
- `paths` (optional): repository paths the source's results are a function of, each a file or a
  directory with a trailing `/`, relative to the repository root and without `.` or `..`. A bad
  value is a problem and drops the source, like the other fields. Declare it only when the result
  depends on those files and on nothing else: a source that reads production data or logs changes
  regardless of the diff, so it must leave `paths` out. Undeclared is the safe default.
- `env` (optional): variables set for the run. Values are never printed, logged, or put in a
  prompt, report, or `settings` output; only names are.

After the verifier, one extra headless Sonnet run gets the verified findings, the sources, their
guides, and `Read`, `Grep`, `Glob` and the allowed commands. It writes `evidence.json` and an
Evidence section in `report.md`, and appends one `Evidence (...)` line to a supported or
contradicted finding in `review.json`. It never drops a finding or changes a severity or the
verdict, its cost is in the cost tables, and a failed run or blocked source is reported while the
review goes on. A source is `checked` only with the commands it ran. An empty result is evidence
of absence only if a control query (the same query loosened so it must return something, such as
a known-present value or a wider window) returns something; when the control is empty too, the
run reports the evidence as inconclusive (effect `none`: `report.md` keeps the note, and no
Evidence line is added to the finding). Evidence is not part of `bench`.

Each source in `evidence.json` also records the head it was checked against and a `scope`: what
it covers, so a later review can tell whether new commits touched it. The commands are the model's
choice, so the scope of a source is `unknown` unless its `paths` are declared, in which case it is
those paths; unknown never counts as still valid. The pure `evidenceHolds`
(`src/review/run/evidence-scope.mts`) answers `holds`, `stale` or `unknown` from a saved item and
the paths changed since its head (`pathsChangedBetween` reads them with local `git diff`); a
follow-up uses it to [offer earlier evidence](review.md#follow-ups-build-on-this-machines-last-review).
An `evidence.json` saved before these fields existed has neither and is treated as unknown.

## `analysis`

Read-only code-analysis commands the pillars and the verifier may run in the checkout. Machine-only,
like `evidence`; a repository file's list replaces its owner file's list whole. See
[Code analysis tools](analysis.md) for the shape, the prompt section and a `no-mistakes` example.

## `references`

References let a review check the code against external documentation, such as AWS API
parameter names, limits, IAM actions, CLI flags and config keys. They are machine-only unless
`trustRepoConfig` is on, like `evidence`: `references` in a repository's own `.code-reviewer` file
is otherwise ignored with a problem, because it grants network access while the run holds private
code. A repository file's list
replaces its owner file's list whole; `[]` switches references off for that repository.

```json
{
  "references": [
    {
      "name": "aws",
      "description": "AWS service documentation",
      "domains": ["docs.aws.amazon.com"]
    }
  ]
}
```

- `name`: a simple identifier, unique in the list.
- `description`: one line on what the site documents.
- `domains`: at least one lowercase hostname, no scheme, port, path, wildcard or bare top-level
  domain. A host matches exactly; its subdomains are not included. Claude Code also lets the
  fetch tool reach a built-in set of public documentation hosts (for example `docs.python.org`
  and `developer.mozilla.org`) without a rule, so the list bounds every other host, not those.

When references are configured, the correctness pillar, the security pillar and the verifier get
the `WebFetch` tool with one `WebFetch(domain:<host>)` allow rule per domain under `dontAsk`, no
`WebSearch`, and a References block in their prompt with the rules in
[`skills/review/references/web-references.md`](../skills/review/references/web-references.md). The
other pillars are unchanged. These runs, like runs with a shell, pass `--setting-sources ''` so
no user setting can widen the allow-list. With no references every prompt and flag is unchanged.
`bench` does not use references. `code-reviewer settings` lists the configured names and domains.

## `answers`

Lets the verifier reply, in the thread, to another reviewer's open note it finds invalid, linking the
rule skill it relies on ([Answering other reviewers](review.md#answering-other-reviewers)).

```yaml
answers:
  enabled: true
```

It is off until configured and machine-only: a repository's own file cannot turn it on. A value that
is not an object with a boolean `enabled` is a configuration problem and stops the command, naming
the file and key. `code-reviewer settings` prints the resolved value and its layer.

## `approvalCheck`

A full review whose verdict would be Approve gets one more independent run first, on the verifier's
model, whose only job is to refute the approval: it looks for an unreviewed changed file, a risky
area no pillar covered, a claim in the description nothing checked, or a finding the verifier
dropped that is real. What it confirms is added to the findings and questions, and the verdict is
derived again in code. When it adds any, it also rewrites the review's summary so the summary is
true with them, and that text is posted in place of the verifier's; a check that adds something
but returns no rewritten summary leaves the verifier's. The verdict can turn from Approve into a Comment or Request Changes, never the
reverse. It costs one more verifier-class run, only on reviews that would approve. It is skipped
for light reviews and for any verdict other than Approve. If the run fails or returns something
unreadable it is not retried: the review completes, `approval-check` is listed under `skipped`
with the reason, and the verdict is Comment, because nothing double-checked the approval.
`report.md` has a "Second check on the approval" section (whether it ran, what it added, the
verdict change) and its cost.

```yaml
approvalCheck: false
```

It is on by default and, like `evidence`, machine-only: a repository's own file cannot switch it
off. `code-reviewer settings` prints the resolved value and its layer.

## `trustRepoConfig`

```yaml
trustRepoConfig: true
```

Machine-only, default `false`: set in a machine repository file or a machine owner file (the
repository file beats the owner file, so `false` there overrides a `true` in the owner file). A
repository's own `.code-reviewer` file that sets it gets `trustRepoConfig is machine-only; ignored`.

With it off, nothing changes: a repository's own file setting `evidence`, `references` or
`rulePlugins` is ignored with a problem. With it on for a repository, its own file may set those
three keys, validated exactly as in a machine file. It also unlocks `plan.generatedPaths` and
`plan.smallChangeLines` (see [`plan`](#plan)). Nothing else: `run`,
`models`, `limits`, `issues`, `answers` and `approvalCheck` stay machine-only.

**Turning it on means anyone who can push to that repository's default branch chooses the
commands the evidence step runs on this machine, with the credentials in the source's `env`, and
the domains the reviewers fetch while holding private code.** The file is still read from the
default branch, never from the pull request, so a pull request cannot change it before it merges.

Precedence follows the other layered keys: per key, the machine repository file, then the machine
owner file, then the repository's own file, and the highest layer that sets the key replaces the
lower lists whole. A machine file therefore overrides a trusted repository file, and `[]` in a
machine file switches that key off. `code-reviewer settings --repo` shows `repository file` as the
layer when a value came from there. `doctor` checks rule plugins from the machine files only.

## `rulePlugins`

```yaml
rulePlugins: [no-mistakes-rules, jong-skills]
```

The Claude Code plugins whose skills a review may use as shared rules, by plugin name (no
`@marketplace`). Unset, the list is `no-mistakes-rules` and `jong-skills`. A list replaces the
default whole and is never appended to it, and the repository file's list replaces the owner
file's. `[]` is valid: rules then come only from the reviewed repository's `AGENTS.md` and
skills, skill selection is skipped, and every headless run enables no plugin. Names are letters,
digits, `.`, `_` and `-`, each listed once.

It is machine-only unless `trustRepoConfig` is on, like `evidence`: otherwise a repository's own
file cannot set it, and says `rulePlugins is machine-only; ignored`. An enabled plugin brings its hooks, agents and commands
into a headless run, and every skill description from it sits in each run's context, so the list
decides what a pull request's review is allowed to load.

Rule plugins are never installed or fetched by a review: a name, whichever file lists it, must
already be installed and enabled on the machine, and a trusted repository's file can only pick
among those.

Every listed plugin must be enabled at user scope: `run` refuses, and `review` fails, naming a
plugin that is not. `review` also fails naming a listed plugin that holds no skills. `code-reviewer settings` prints the names and the layer they came from. `bench`
ignores this key and always uses the default list, so scores stay comparable across machines.

## `plan`

Values the dispatcher plans with. Each is optional and the built-in behaviour is the default.

```yaml
plan:
  securityPaths: ['infra/**', 'deploy/*.yml']
  generatedPaths: ['**/*.pb.ts']
  authors:
    - { login: renovate, review: light }
    - { login: dependabot, review: skip }
  smallChangeLines: 200
```

| Key                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A repository's own file               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `securityPaths`    | Globs of paths that also run the security pillar, in addition to the built-in ones. A docs path never triggers it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | May set it.                           |
| `generatedPaths`   | Globs of paths that also count as generated: their lines do not count toward the size of a change and they are not hand-written for the small-change rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Only when `trustRepoConfig` is on.    |
| `smallChangeLines` | A first review of at most this many reviewable lines (default 100), with no security trigger path, is light. A non-negative integer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Only when `trustRepoConfig` is on.    |
| `authors`          | A list of `{ login, review }` rules. `light`: lockfile-only changes are skipped, anything else gets a light review, and manifest and workflow edits do not trigger security (Dependabot has this rule built in). `skip`: never reviewed. `app/` and `[bot]` are ignored and case does not matter. A rule for `dependabot` replaces the built-in one. A rule holds only while every commit of the pull request is the login's, as GitHub attributes and verifies it; any other commit gives the normal plan (see [Author rules](review.md#author-rules)). An unsigned commit counts as someone else's, so a rule suits accounts that sign. | Machine-only; ignored with a problem. |

Globs match repository-relative paths (`**` crosses directories), as in `run.riskyPaths`. The
lists add to the built-in ones and never replace them. They also add across layers: the machine
repository file, the machine owner file and the repository's own file all contribute.
`smallChangeLines` comes from the highest layer that sets it. A repository's own file can only
make a review stricter on its own; the settings that reduce review need `trustRepoConfig` or a
machine file. A refused or invalid value is a problem naming the file and key. `code-reviewer settings` prints the resolved values, with the built-in Dependabot rule listed under `authors`. The change-shape context section
keeps the built-in thresholds.

## `pillars`

```yaml
pillars:
  disabled: [history]
  extra:
    - name: accessibility
      when: the change touches UI components
      modes: [full]
      prompt: |
        Look for controls without an accessible name, missing keyboard handling, and focus traps.
    - name: native-review
      modes: [light, full]
      run: /code-review low
```

`disabled` names built-in pillars to skip in every mode: `rules`, `correctness`, `design`,
`blast-radius`, `security` and `history`. `extra` adds pillars that run like the built-in ones. An
extra has a `name` (`[a-z][a-z0-9-]*`, not a built-in name, each used once) and exactly one of:

- `prompt`: the pillar's instructions, what to look for. `when` is an optional plain-language
  trigger. It costs no model call: the pillar's own run reads it at the top of its prompt and, when
  it does not apply to the change, returns no findings.
- `run`: a command the harness runs as the whole prompt, such as `/code-review low`, followed by
  the pillar output contract. It works only on a harness that understands the command, and the
  result must still match the contract; a pillar that does not is reported failed. `when` cannot be
  combined with `run`.

`modes` is a non-empty subset of `light` and `full`, default `[full]`. An extra gets the same
read-only tools as a built-in pillar except history: no shell, no web, and it cannot ask for more.

Unlike the keys above, this one may also be set in the reviewed repository's own file. `disabled`
and `extra` each come whole from the highest layer that sets them (machine repository file, then
machine owner file, then the repository's file) and a list never appends to another layer's; a
repository's file cannot extend a machine file's list. A bad shape, an unknown built-in name, a
duplicate or built-in extra name, a missing or doubled `prompt`/`run`, or an unknown mode is a
problem naming the file and key, and the whole `pillars` key in that file is ignored.

Disabling every built-in pillar is an error unless an extra runs in each of `light` and `full`:
`review` and `prepare` refuse to start, and `settings` lists the problem. A review whose change
plans no pillar at all (for example `rules` disabled on a docs-only change) fails instead of
approving. `code-reviewer settings` prints the extras, the layer of each list, and the pillars
that may run per mode.

An extra's model is `pillar.<name>`, else `pillars`, else the `medium` tier, so `models.steps` and
`--model` accept `pillar.accessibility`. Its findings appear under its name and go through the
verifier like any other pillar's. `bench` ignores this key.

## `targets`

```yaml
targets:
  disabled: [unneeded-concurrency-guard]
```

Built-in targeted checks (see [Targeted checks](review.md#targeted-checks)) are all enabled by
default. `disabled` lists built-in target names to skip, or `"all"` to switch every built-in target
off:

```yaml
targets:
  disabled: all
```

Like `pillars`, this key may be set in a machine repository file, a machine owner file, or the
reviewed repository's own `.code-reviewer` file, and the highest layer that sets `disabled` wins
whole (a repository's file cannot extend a machine file's list; `disabled: []` in a higher layer
re-enables all targets). An unknown target name, duplicate name, or wrong shape is a configuration
problem naming the file and key and stops commands before any work. `code-reviewer settings` prints
the disabled list, enabled targets, and layer.

## `models`

```yaml
models:
  tiers:
    small: [{ harness: claude, model: haiku }]
    large:
      - { harness: claude, model: opus }
      - { harness: claude, model: sonnet }
  steps:
    select: small
    pillar.design: large
    verifier: [{ harness: claude, model: opus }]
  retry:
    maxWaitSeconds: 600
```

Which harness and model each step runs on. `tiers` name `small`, `medium` and `large`, each an
ordered list of `{harness, model}` candidates (a Codex or agy candidate also needs `readsOutsideCheckout: true`, accepting that it may read files outside the checkout, or it refuses every step); unset, they are Claude's `haiku`, `sonnet` and
`opus`. `steps` maps a step to a tier name or to its own ordered list. The steps are `select`,
`pillars`, `focus` (the [requester focus](review.md#requester-focus) step), `pillar.<name>` (for a built-in or a configured pillar), `verifier`, `verifier.light`, `evidence` and `approvalCheck`. A
pillar uses `pillar.<name>`, else `pillars`, else the model the plan chose for it; `focus` uses itself, else `pillars`, else the `medium` tier; light reviews
use only `verifier.light`. A step that is not set runs exactly as it would without this key, and
a set key replaces only that key. The pillars' `explorer` subagent runs on the `small` tier: the model of its first `claude` candidate, else Haiku. It has no step of its own. The harnesses
are `claude`, `grok`, `opencode`, `codex` and `agy`; a name that is not registered is a problem. Selecting
`grok`, `opencode`, `codex` or `agy` sends the pull request's diff and files to that provider. OpenCode at its free usage
limit hangs until the step timeout and is then treated as rate limited, so the step moves on.
A free OpenCode model (an id ending `-free`, or a known free id) may not run `verifier`,
`verifier.light` or `approvalCheck`, in any candidate. `pillar.history` and `evidence` need shell,
which Grok, OpenCode, Codex and agy refuse, so a list with no Claude candidate for them is a problem (a
`pillars` list reaches `pillar.history` unless that step is set). Refused web hosts are not known
from the step name, so they are refused at run time and the step moves to its next candidate.

A step tries its candidates in order. A rate limit or an overloaded API waits (the delay the
harness reports, else exponential backoff with a cap) and retries the same candidate until
`retry.maxWaitSeconds` (default 600) of waiting is spent in that step, then moves to the next
candidate. An authentication failure moves on at once, and so does a failure of the harness
itself: a timeout, a crash with no result, a rejected flag, or output that is not a result. A
broken non-Claude harness therefore gives way to the next candidate. A failure that carries a
model answer (a turn limit, say) is the step's failure, and so is running out of candidates. `report.md` lists the harness and model
each step ran on and how long it waited, and under the table a line for every configured candidate
the step moved past (`skipped agy gemini-4-neon: refused (...)`) with why: refused, auth, a spent
wait budget, or the kind of harness failure. `report.json` carries the same as `skipped`.

`--model step=harness:model` on `review` and `run` sets one step for that run and beats the
config. Repeat it for a step to give that step ordered fallbacks. A bad step, harness or value, or
a free verifier or shell-less history or evidence list, is a usage error.

An unknown tier, step or harness, an empty list, a candidate a step cannot use as above, or a value of the wrong type is a problem naming
the file and key, and the whole `models` key is ignored. It is machine-only, like `evidence`: a
repository's own file cannot set it, and says `models is machine-only; ignored`. The highest
machine layer that sets it is used whole. `code-reviewer settings` prints the resolved table.
`bench` ignores this key and always runs the defaults, so scores stay comparable across machines.

## `limits`

```yaml
limits:
  maxCostUsd: 5
  runTimeoutSeconds: 1800
  pillarJobs: 3
```

| Key                      | Meaning                                                             | Default | Range / type     |
| ------------------------ | ------------------------------------------------------------------- | ------- | ---------------- |
| `maxCostUsd`             | Cost ceiling per review, in US dollars; see below.                  | 25      | number above 0   |
| `runTimeoutSeconds`      | Time one pillar, verifier, evidence or approval-check run may take. | 1800    | integer 60-14400 |
| `selectTimeoutSeconds`   | Time the skill-selection call may take.                             | 120     | integer 10-1800  |
| `contextDeadlineSeconds` | Time the whole context build may take; see [context](context.md).   | 60      | integer 5-600    |
| `pillarJobs`             | Pillars that run at once; `--jobs` beats it.                        | 3       | integer 1-16     |

Every key is machine-only, because a longer timeout or more parallel pillars can raise what a
review costs and a repository must not set its own: the reviewed repository's own file, with or
without `trustRepoConfig`, says `limits is machine-only; ignored`. Unlike the other layered keys,
each `limits` key resolves on its own: the highest machine layer that sets that key wins, a key no
layer sets takes the default, so a repository file that sets only `pillarJobs` keeps the owner
file's `maxCostUsd`. A bad value, an out-of-range number or an unknown key is a problem naming the
file and key, and the commands above stop with it before claiming anything, so a ceiling is
never dropped silently. `code-reviewer settings` prints every resolved value, and `maxCostFrom` says which
machine layer set `maxCostUsd` (`null` means the built-in default of 25). `bench` ignores this key. The posted-text length targets (1,200 and 800 characters),
the caps in the context sections and the other fixed numbers stay fixed; `post` takes
`--body-target` and `--inline-target` for one run.

The ceiling is a circuit breaker against a runaway run, not a budget to tune a review to. A
normal review costs a few dollars, so the default of 25 is reached only by a run that has gone
wrong; raise it for very large pull requests. Before it
starts each step, a review compares the cost its steps have reported so far with `maxCostUsd`. At
or above it the step does not start and the review stops whole: it fails with
`cost ceiling reached ($X of $Y)` and the name of the step that did not start, writes no
`review.json` or report, and derives no verdict, so there is nothing to post. It never produces a
partial review. The run directory keeps what the finished steps wrote.

The cost is the sum of what the harnesses reported for finished and failed steps, so a step that
reports no cost counts as zero, and a step already running is never stopped. Steps that run at
once (the pillars at `--jobs` above 1) are checked as each starts, so the total can pass the
ceiling by what those steps cost; a review whose last step crosses the ceiling, with nothing left
to start, finishes normally. A review stopped by the ceiling is not a harness failure and adds
nothing to `harness-failures.jsonl`; its tracker row is `failed` with that reason and keeps the cost
spent. `run` holds it for a human (see [Unattended runs](run.md#when-the-cost-ceiling-stops-a-review)).

`--max-cost USD` on `review` and `run` sets the ceiling for that run and beats the config. A
value that is not a number above 0 is a usage error.

A run that passes `runTimeoutSeconds` or `selectTimeoutSeconds` fails as a step does today: it is
reported, the review goes on, and a review missing a step never approves.

## `issues`

```yaml
issues:
  maxPerDay: 3 # optional, an integer of at least 1; default 3
  targets:
    - name: example-rules # a rule plugin name, `code-reviewer` for the reviewer itself, or `harness`
      repo: owner/name # where issues for it go
      labels: [from-code-reviewer] # optional
```

Absent means `code-reviewer issues` files nothing, and so does a proposal whose plugin has no
target. Failures of a harness (`claude`, `grok`, `opencode`, `codex`, `agy`) are filed only to a target named
`harness`; without one they are never filed. `maxPerDay` caps issues filed in any 24 hours across all targets. A target name may be
listed once. Any wrong shape is a problem naming the file and key, the whole `issues` key is
ignored, and `code-reviewer issues` exits 2. It is machine-only: a repository's own file cannot
set it, and says `issues is machine-only; ignored`. Unlike the per-repository keys it is not scoped
to a repository: the first file that sets it is used, owner files before repository files, each in
name order. See [Filing issues](issues.md).

## `labels` and `checkRun`

Label names and an optional GitHub check run are set in the same files; an owner file cannot set
`consumes`. This example is in JSON, the
format of `<owner>.json`; the same keys work in YAML.

```json
{
  "labels": {
    "requested": "final-review:requested",
    "processing": "final-review:in-progress",
    "completed": "final-review:complete",
    "held": "final-review:held",
    "approval": "final approval"
  },
  "checkRun": { "name": "Code review" }
}
```

- `labels`: each key is optional and defaults to the value shown. `requested` asks for a review,
  `processing` marks one running, `completed` marks it posted or skipped, `held` marks a finished
  review waiting for a person to post it, `approval` marks an approved head. `held` is what keeps
  another machine, which sees only labels, from claiming a pull request whose review is waiting:
  `claim` declines it (`held for a person`) even when a person adds the request label again, and
  `claim --force` clears it. `post`, `skip` and `abort` clear it too. `abort --requeue` is the only
  path that puts `requested` back, for a failure worth one retry.
- `checkRun`: absent means no check run. When set, and calls use the GitHub App, `claim` opens a
  check run at the head, `post` completes it from the verdict, and `abort` and `skip` cancel or
  skip it. Under the local `gh` login the same states are written as a commit status whose
  context is the configured name (`via` in the result says which).
- `consumes` is valid only in a repository file.

`code-reviewer settings --repo owner/name` (or `--owner LOGIN`) prints the resolved settings, including the names of the evidence sources and analysis tools and the layer they came from.
`code-reviewer skip` closes out a pull request the plan will not review: it posts one COMMENT
review on the head with a `verdict=Skipped` marker, then swaps the labels. `status` exits 0 for
a skipped head while its completed label stands (it never counts as approval and the approval label is not added), `claim`
declines it like any reviewed head unless `--force`, and a later review treats it as a first
review.

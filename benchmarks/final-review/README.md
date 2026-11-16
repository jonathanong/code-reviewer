# Final review benchmarks

## Current results

Mined cases, 2026-11-15, commit 2486bc6, reviewer Sonnet 5.5, judge Opus, 3 attempts with the
installed rule skills and 3 without (`--no-rules`). See [HISTORY.md](HISTORY.md) for every run.

| Pillar      | Cases run | Expected findings caught, with skills | Without | Runs that loaded the expected skill |
| ----------- | --------- | ------------------------------------- | ------- | ----------------------------------- |
| design      | 6 of 9    | 8 of 18                               | 7 of 18 | 0 of 18                             |
| rules       | 1 of 4    | 0 of 3                                | 0 of 3  | 0 of 3                              |
| correctness | 3 of 3    | 3 of 12                               | 1 of 8  | 0 of 9                              |

- The installed skills made no measurable difference on real repositories, because the reviewer
  almost never loaded one: 1 run of 30 loaded any skill.
- Six case and pillar pairs (`vouchington-1077`, `1081`, `1092`, `1143`) failed in both arms: the
  reviewer read the whole combined diff and ran out of context, at about $3 a run. Bench now points
  the reviewer at per-file patches; these cases are not re-measured.
- The correctness control has two attempts for each case; the third was not run.
- At 3 attempts a difference of one catch is noise.

Fixture cases (`synthetic.json`), 2026-11-15, commit 2d9a96f, reviewer and judge both Sonnet 5.5,
3 attempts with skills and 1 without, so not comparable with the table above: rules pillar, 10
positive and 4 negative cases, recall 100%, false alarms 0 of 4, expected skill loaded in 90% of
runs, control recall 22%. The two cases the control caught were replaced; the
replacements (Opus judge, 3 attempts per arm) are caught 3 of 3 with skills and 0 of 3 without.

Rules for changing or running this suite are in [AGENTS.md](AGENTS.md).

Labeled pull requests for benchmarking the `final-review` pillar prompts in
`skills/final-review/references/pillars/`.

## Cases

`cases.json` is an array of cases:

- **Positive** cases are pull requests that were reverted or needed a regression fix. Each has one
  or more `expected` findings: the pillar that should have caught it, a severity, the file, the
  head-side line range (or `null`), and the claim a good reviewer would have made before the
  revert.
- **Negative** cases are merged pull requests that stayed unreverted, with no fix to the same lines
  within 30 days. They have no expected findings and measure false alarms.

Use a line range only when the defect lives on specific lines. Approach-level claims (most design,
congruence, and history findings) use `"lines": null`, so any finding on the file counts: a
reviewer may rightly raise the same concern far from where a labeler guessed.

This repository is private. `cases.json` holds cases mined from real pull requests, most of them in
private repositories: a run clones each repository with the `gh` login and exports the head tree.

### Fixture cases

A case can instead use `"fixture": "<dir>"` (relative to the cases file) in place of `repo`, `pr`,
`baseSha`, and `headSha`; set exactly one shape. A fixture is a synthetic, minimal pull request
that needs no clone or `gh`:

- `base/` and `head/`: the smallest trees that express the pattern. `head/` becomes the reviewer's
  working tree, and the diff is `git diff --no-index base head` with paths shown as `a/<path>` and
  `b/<path>`.
- `pr.md`: the title on the first line (`# ...`), then the description.
- `context.md` (optional): copied to `.final-review/context.md`, written like the "Other reviewers
  and comments" section of the live run. The pillar prompt mentions that file only when present.

- `repos/<name>/` (optional): dependency repositories, each with a `package.json` name, its own
  `AGENTS.md` or skills, and code. A repository whose package the diff imports is staged as a
  dependency, code included, as `prepare` stages a dependency clone. So is one that the
  fixture's configs list as consumed by the case's `repoId` (matched by directory name), and one
  configured as consuming that `repoId` is staged as a consumer.
- `configs/<owner>/<name>.json` (optional): reviewer configs for the fixture, in the format of
  this repository's `repos/` directory.
- `"repoId": "owner/name"` (optional, on the case): the fixture repository's name, which the
  configs refer to.

Fixture cases are cached by a content hash of the fixture directory instead of a head SHA.
`synthetic.json` holds the fixture cases: the `lock-scope-*` cases for the correctness pillar and
the `rules-*` cases, one per shared rule skill. It is separate from `cases.json`; run it with `--cases
benchmarks/final-review/synthetic.json`. A fixture must be synthetic: never copy private code.

Labels are written by people or agents from the revert and fix history. Add cases by mining new
reverts and regression fixes, and keep negatives at roughly a third of the set.

### Rule sources

Every run stages rule sources into `.final-review/rules/` with the same code `prepare` uses: the
fixture's `base/` instructions and skills (a mined case's head, since its base is not exported),
and fixture dependencies and consumers from `repos/`. Shared rules are never staged. The pillar
prompt points at `rules/INDEX.md`. `--no-rules` stages nothing, for control runs that check a case
needs its rule source to be caught. The rules digest is part of the cache key.

Pillar runs also get the `Skill` tool, so they can load installed plugin rule skills as a review
session can; `--no-rules` withholds it. Installed plugin skills are the only source of shared
rules, found by description. Each raw result records the enabled plugins and their versions (`plugins`) beside the rules
digest, so a score change can be traced to a rule change. Every staged skill's markdown files under
`references/`, at any depth, are staged with it.

### Skill loads

Pillar runs use `--output-format stream-json --verbose`. The runner reads findings from the
result event and records the distinct skills loaded through the `Skill` tool (a request counts only when its
tool result came back without an error), in first-use order,
as `skills` in each raw result (`skillTool` records whether the tool was available; `--no-rules`
runs have none, so `skills` is empty). A case may declare
`"expectedSkills": ["no-mistakes-rules:testing-rules"]`. A name must be the full `plugin:skill`
name (a bare name is rejected when the cases load), and only a loaded skill with exactly that name
satisfies it, so a same-named skill from a stale plugin does not. An entry may instead be a
non-empty array of full names, meaning any one of them satisfies it:
`[["skills:bounded-iteration", "no-mistakes-rules:queue-rules"]]`; a missing group is listed as
`a | b`. The expectation applies to the pillars of the case's
`expected` findings, and to every pillar run for a negative case. The summary adds:

- **Skills loaded**: the share of expected skills that were loaded, over cases that declare them
  (`n/a` when none do). Cases missing a skill are listed under the table.
- **Grounded recall**: positives with `expectedSkills` whose expected finding was matched AND
  whose expected skills were all loaded, over all such positives. A catch without the skill is
  ungrounded: the null-hypothesis outcome, where the model would have found it anyway, and it is
  listed as `caught without <skill>`. `summary.json` holds the four counts (`grounded`,
  `ungrounded`, `loadedMissed`, `missed`) and `skillsAvailable`. Recall is unchanged.

### Run flags

Pillar runs pass `--strict-mcp-config`, `--setting-sources user`, `--effort medium` and
`--settings` with `enabledPlugins` set true only for the rule plugins (`no-mistakes-rules`,
`skills`), so the run's fixed context holds the rule skills and built-ins only. `--no-rules` sets
every plugin false. Pillars may use the `Agent` tool to dispatch an `explorer` subagent (Haiku,
read-only tools). Verifier runs get the same isolation flags and settings.

### Cost and turns

The pillar prompt points the reviewer at `.final-review/files.md` (an index of per-file patches in
`.final-review/diff/`) and tells it never to read the combined `diff.patch` whole, so a large pull
request does not exhaust the context in one read. Each raw result records `usage` from the final
`result` event: `costUsd`, `turns`, `durationMs`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
`cacheCreationTokens` (null for a field the event lacks). A run that exits non-zero but printed a
result event keeps its usage, and its error names the result subtype, for example
`claude exited with 1 (error_max_turns)`. Under the score table, a Cost table lists per pillar the
runs with usage, total cost, cost per run, turns per run, and input tokens per run (input + cache
read + cache creation); `summary.json` holds the same as `usage` on each pillar summary. Raw
results saved before this change have no `usage`: `--score-only` leaves them out (`n/a`), not as
zero.

`usage.byModel` holds the result event's `modelUsage` per model id (`inputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheCreationTokens`, `costUsd`), so a run that used subagents shows the main
model and the `explorer`'s Haiku separately; it is `{}` when the event has none. Under the Cost
table, a "Tokens by model" table lists per pillar and model the runs that used the model, total
input (input + cache read + cache creation), total output, and total cost, then one `all` row per
model summed over the pillars; `summary.json` holds the per-pillar rows as `usage.models`, and the
`all` rows are their sum. The judge's calls are not counted.

`bench-verifier` records `usage` for each verifier run, and `checkUsage` on the grade for the
checker run (null when nothing was checked), and prints the same table with `verifier` and
`checker` rows and an `all` row; `summary.json` holds them as `models`. Its judge calls are not
counted either.

### Paired control

`--baseline DIR` (with or without `--score-only`) points at the `--out` directory of an earlier
`--no-rules` run of the same cases. The summary table gains **Control recall** and **Lift**
columns per pillar, over the positives with `expectedSkills` that both runs scored: control
recall is the share of them the control caught, and lift is grounded recall minus control recall
over the same positives. A case the control caught is listed as `control caught <id>: does not
discriminate`: a reviewer with no rules finds it too, so it does not measure the rules. With
`--judge`, the control's saved judge grades are read, not re-made; judge the control directory
first (`bench --score-only --judge MODEL --out DIR`), and its unjudged cases are left out of the
comparison. `summary.json` holds the numbers as `baseline` (`cases`, `groundedRecall`,
`controlRecall`, `lift`, `controlCaught`) on each pillar summary. `bench` fails when DIR has no
raw results for the cases.

A `--no-rules` run is the ablation baseline: every catch is ungrounded, and the summary says so
(`skillsAvailable: false`), so a skill-enabled run's grounded recall can be compared against it.
Raw results saved before this change lack `skills`; `--score-only` counts them as nothing loaded,
so re-run them to measure skill loads. Raw results are not reused across runs (`bench` always
re-runs pillars), and the judge cache is keyed on findings only, so the new fields never make a
stale result look current; the rules digest and `plugins` are unchanged.

The `rules-*` cases in `synthetic.json` test the rules pillar: an installed
`no-mistakes-rules` skill (`rules-test-only-whole-module-mock`), an installed `skills` plugin skill
(`rules-skills-sweep-until-empty`, which accepts either of two skills),
workflow-only, manifest-only, and test-only changes (`rules-workflow-only-*`,
`rules-manifest-only-*`, `rules-test-only-*`), `rules-content-only-*` cases whose changed file path
gives no hint of the rule (only the code does), a docs-only negative (`rules-docs-only-readme`), a
near-miss negative that complies with a rule it resembles breaking
(`rules-near-miss-renamed-log-field-monitor-updated`),
a dependency's rules for callers (`rules-dependency-flag-key`), a repository rule that overrides an
installed one (`rules-local-override`, negative), and a compliant dependency call
(`rules-dependency-flag-ok`, negative). Each positive's claim requires citing its rule source, so
a generic finding does not match.

The `links-*` cases test the per-repository configs: a response field rename that breaks a configured
consumer (`links-consumer-field-rename`, blast radius), an additive change with the same consumer
(`links-consumer-additive-field`, negative), and a call that does not match a declared
dependency's route, with no package import to detect (`links-declared-api-payload`, correctness).

## Running

```bash
pnpm exec code-reviewer bench \
  --cases benchmarks/final-review/cases.json \
  --prompts skills/final-review/references/pillars \
  --out "$TMPDIR/final-review-bench" \
  --pillar design --jobs 3
```

For each case, the runner exports the pull request head with `git archive`, so the tree has no
history. It writes the title, description, and a numbered diff (base and head line numbers on every
line) into `.final-review/` inside that tree, then
runs `claude -p` on Sonnet with only `Read`, `Grep`, and `Glob`. With no shell, network, or
`gh`, the reviewer cannot look up the revert. Each pillar prompt is prefixed with the shared
`_contract.md`.

Results are written to `<out>/raw/<pillar>/<case>.json`, then `summary.json` and `summary.md`. Use
`--score-only` to re-score existing raw results, and `--case <id>` to run one case. Runs cost
money and take minutes per case, so run only the pillars whose prompts changed.

Add `--judge sonnet` to grade by claim instead of location. A tool-less `claude -p` call per case
decides which finding, if any, raises each labeled problem, even at a different file or line, and
stores the assignment in the raw result. Judging is cached per model, so `--score-only --judge
sonnet` re-scores for free after the first pass. Prefer judged numbers; location matching both
credits unrelated findings at the right file and misses the right claim cited elsewhere.

## Verifier

The verifier is benchmarked on its own, without re-running pillars or dispatching subagents:

```bash
pnpm exec code-reviewer bench-verifier \
  --cases benchmarks/final-review/cases.json \
  --findings-from "$TMPDIR/final-review-bench" \
  --prompts skills/final-review/references \
  --out "$TMPDIR/final-review-verifier" --jobs 3
```

`--findings-from` is the `--out` directory of an earlier `bench` run. The command first judges any
of those pillar results that lack a current `--judge` assignment (default `sonnet`), so each input
finding is labeled real (it raises a labeled problem) or noise. For each case it gathers every
pillar's findings, plants a copy of each real finding under a second pillar, and makes one
`claude -p` call (default Opus) in the same git-free snapshot with `verifier.md`, the congruence
pillar, and the findings as indexed JSON. The verifier returns the review with `sources` on every
finding: the input indexes it confirms or merges. The snapshot also gets the same staged rule
sources as `bench` (`--no-rules` has the same meaning), and the
verifier prompt points at `rules/INDEX.md`; the verifier and the checker read them but get no
`Skill` tool.

The verifier may add findings of its own, with an empty `sources` array. A correct addition is a
win, so findings are graded on whether they are right rather than counted:

- **Real kept**: real inputs that some output finding cites, directly or through the planted copy.
- **Label recall, pillars → verifier**: labeled problems raised by the pillar findings, and by the
  verifier's output. The output credits a label through a kept real input, or through an added
  finding that the `--judge` model matches to it.
- **Severity agreement**: raised labels whose strongest output severity is within one level of the
  label.
- **Other blocking/high confirmed**: every `blocking` or `high` output finding not credited to a
  label goes to an independent check (`--checker`, default Opus, read-only tools in the same
  snapshot) that decides whether the claim is true at the head. Negative cases were only not
  reverted, so a confirmed finding there is a real catch, not a false alarm.
- **Duplicates merged**: planted pairs that end in exactly one output finding.
- **Findings before → after**: mean pillar findings per case (copies excluded) and mean output
  findings.

Results go to `<out>/raw/<case>.json` (input, output, and grade), `summary.json`, and
`summary.md`. A saved verifier output is reused only while the case head, verifier prompt, model,
turn limit, input findings, and staged rules digest all match, so a rerun resumes, repeats what changed, and grades only
what is missing. A case whose labeled pillar has no current judgement is recorded as an error
rather than verified, and the summary lists any case with no saved run. `--score-only` re-scores
the saved outputs as they are, without model calls.

## Metrics

| Metric             | Meaning                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| Recall             | Expected findings matched by the judge, or by path and a line within 10 of the range |
| Severity agreement | Matched findings whose severity is within one level of the label                     |
| False alarms       | Negative cases with at least one `blocking` or `high` finding                        |
| Findings per PR    | Mean findings per case, to watch for noisy prompts                                   |

Without `--judge`, scoring is mechanical: a finding at the right place with a wrong claim still
counts. Either way, read the raw findings for any case whose result changes. A finding that covers
two labeled problems is credited once.

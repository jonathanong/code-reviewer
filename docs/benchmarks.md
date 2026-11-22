# Benchmarks

Reference for the review benchmark suite in [`benchmarks/review/`](../benchmarks/review/README.md):
its cases, how to run each command, and what the scores and token figures mean. The current
scores and the scope of the suite are in that README.

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

`cases.json` holds cases mined from real pull requests: a run fetches each case's base and head
commits with the `gh` login and checks the head out as a git repository with its history (see
[Mined case checkouts](#mined-case-checkouts)).

A mined case may carry `"body"`: the description as it read at `headSha`. The reviewer is then
given that text. Without it the run reads the pull request's current description, which is right
for a merged pull request and wrong for an earlier head of one that was revised: a description
rewritten after review can state the fix, and the reviewer finds the defect by comparing the two.

### Fixture cases

A case can instead use `"fixture": "<dir>"` (relative to the cases file) in place of `repo`, `pr`,
`baseSha`, and `headSha`; set exactly one shape. A fixture is a synthetic, minimal pull request
that needs no clone or `gh`:

- `base/` and `head/`: the smallest trees that express the pattern. `head/` becomes the reviewer's
  working tree, and the diff is `git diff --no-index base head` with paths shown as `a/<path>` and
  `b/<path>`.
- `pr.md`: the title on the first line (`# ...`), then the description.
- `context.md` (optional): copied to `.review/context.md`, written like the "Other reviewers
  and comments" section of the live run. The pillar prompt mentions that file only when present.

- `repos/<name>/` (optional): dependency repositories, each with a `package.json` name, its own
  `AGENTS.md` or skills, and code. A repository whose package the diff imports is staged as a
  dependency, code included, as `prepare` stages a dependency clone. So is one that the
  fixture's configs list as consumed by the case's `repoId` (matched by directory name), and one
  configured as consuming that `repoId` is staged as a consumer.
- `configs/<owner>/<name>.json` (optional): reviewer configs for the fixture, in the format of
  the machine config directory.
- `"repoId": "owner/name"` (optional, on the case): the fixture repository's name, which the
  configs refer to.

Fixture cases are cached by a content hash of the fixture directory instead of a head SHA.
`synthetic.json` holds the fixture cases: the `lock-scope-*` cases for the correctness pillar,
`options-forwarded-to-helper` (a negative: new code that forwards a helper's options draws no
options finding), and
the `rules-*` cases, one per shared rule skill. It is separate from `cases.json`; run it with `--cases
benchmarks/review/synthetic.json`. A fixture must be synthetic: never copy private code.

`revisions.json` holds cases mined from review rounds instead of reverts: one case per reviewed
head of a pull request that went through several rounds. A positive's expected findings are the
defects a final review reported at that head; its `reason` says how many of them the full review
run at that head reported. A negative is a head the final review approved with no defect. Each
case carries `body`. These labels are weaker than a revert: a finding the author then fixed is
`"confidence": "high"`, one that was only reasoned is `"medium"`, and an approved head was judged
clean, not proven clean.

Labels are written by people or agents from the revert and fix history. Add cases by mining new
reverts and regression fixes, and keep negatives at roughly a third of the set.

### Rule sources

Every run stages rule sources into `.review/rules/` with the same code `prepare` uses: the
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
`[["jong-skills:bounded-iteration", "no-mistakes-rules:queue-rules"]]`; a missing group is listed as
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

`--select` runs the same Haiku skill-selection step `review` runs, once per case, and ends the
`rules` pillar's prompt with the instruction to load the skills it named, so the bench measures the
prompt `review` really sends. Every other pillar gets no such instruction and follows the
contract's line to load the skills whose description matches. `--select-all-pillars` (needs
`--select`) gives every pillar the instruction, the earlier behaviour, to compare the two; The choice is saved as `<out>/selection/<case>.json` (reused when the run
resumes) and as `selected` in each raw result. `--no-rules` ignores it. Without `--select` no
pillar gets more than the contract's general instruction to load matching skills.

`--excerpts alongside|replace` (needs `--select`, not with `--no-rules`) also builds review's
`rule-excerpts` section for the selected skills and writes it to `.review/review-context.md` in
each snapshot, with the line `review` gives the pillar about that file; a plain `bench` has neither.
The two values differ only in the instruction. `alongside` is what a review sends: excerpts, and,
for the `rules` pillar, load every selected skill. `replace` marks each skill in the excerpts as "quoted in full", "quoted
in part (sections dropped: ...)" or "not quoted", and ends the prompt with a block telling the
pillar not to load a skill quoted in full and to load only the others. That block overrides, for
fully quoted skills, the contract's "load every matching skill" line and, in the `rules` pillar,
the selected-skills list, which are static text, so the arm can still be pulled both ways by the prompt. Each raw result records
`excerpts`, and with the flag `summary.json` entries gain `excerpts` and `skillLoads` (`runs`,
`total`, `mean`: distinct skills loaded through the `Skill` tool, not calls), the table header
names the arm, and an "Excerpts arm and Skill loads" table is printed beside the cost tables.
`review` has no such option. Compare arms by input tokens per run and skills loaded per run.

`--loads-only` (needs `--pillar`; not with `--judge`, `--baseline` or `--no-rules`) runs each named
pillar on every selected case, whatever pillars the case expects, to record which skills it loads;
without it `bench` runs a pillar only on its own positives and the negatives. It makes no judge
call and scores no findings. Prompts and `claude` arguments are the same as without the flag, and
works with and without `--select`. `summary.json` entries (`mode: "loads-only"`) hold per pillar
`runs`, `skillsPerRun` (`total`, `mean`: distinct skills per run), `loads` (runs that loaded each
skill), `expectations` (per case with `expectedSkills`, the groups not loaded; an any-of group is
met by one member) and `usage`. `summary.md` and the printed output hold the same as tables, plus
the cost and tokens-by-model tables; they have no recall, severity or false-alarm columns. Raw
results use the same `<out>/raw/<pillar>/<case>.json` paths, so use a fresh `--out`.

Pillar runs pass `--strict-mcp-config`, `--setting-sources user`, `--effort medium` and
`--settings` with `enabledPlugins` set true only for the rule plugins (`no-mistakes-rules`,
`jong-skills`), so the run's fixed context holds the rule skills and built-ins only. `--no-rules` sets
every plugin false. Pillars may use the `Agent` tool to dispatch an `explorer` subagent (Haiku,
read-only tools), and only that one: `--disallowedTools` denies Claude Code's built-in agent types,
which would run on the user's default model. Verifier runs get the same isolation flags and settings; checker runs get the same,
and judge runs get them with every plugin false.
The history pillar has a shell, so it passes `--setting-sources ''` and loads no settings file.

### Cost and turns

The pillar prompt points the reviewer at `.review/files.md` (an index of per-file patches in
`.review/diff/`) and tells it never to read the combined `diff.patch` whole, so a large pull
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
model and the `explorer`'s Haiku separately; it is `{}` when the event has none.

### Tokens per model

`bench`, `bench-selection` and `bench-verifier` print a "Tokens by model" table and write the same
figures to `summary.json` as `models`, a list with one entry per group and arm:

- **Group**: a pillar for `bench`; `verifier` and `checker` for `bench-verifier`; `selection` for
  `bench-selection`.
- **Arm**: `with skills` or `control` (`--no-rules`). With `--baseline DIR`, `bench` adds the
  control arm from DIR beside the run's own arm. `bench-selection` has no arms.
- **Per model**: input, cache-read input, cache-creation input and output tokens, and cost, each
  as a total and a per-run mean (`total`, `mean`, `runs` in JSON; `total / per run` in the table).
  A model such as the `explorer`'s Haiku appears as its own row when a run used it.
- **Coverage**: `runs` is the runs expected (failed and unrun ones included), `covered` is the runs
  whose usage lists models, and each model row has the runs that used it. The table prints
  `using the model of covered of expected`. A failed run that recorded no usage, an unrun case and
  a record saved before `byModel` existed are missing, not zero: they add to the expected count
  only, and a figure no run reported is `n/a`. A mean is over the runs that reported that figure,
  so cost is the average over runs where it is known.

`--score-only` derives all of it from the stored per-run records. The judge's calls are not
counted. For `bench-verifier`, the `checker` entry covers only runs where a checker ran.

`bench-verifier` records `usage` for each verifier run, and `checkUsage` on the grade for the
checker run (null when nothing was checked).

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
`no-mistakes-rules` skill (`rules-test-only-global-call-count`), an installed `jong-skills` plugin skill
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

Evidence sources are not wired into `bench`: it runs the pillars and the verifier only.

## Running

```bash
pnpm exec code-reviewer bench \
  --cases benchmarks/review/cases.json \
  --prompts skills/review/references/pillars \
  --out "$TMPDIR/review-bench" \
  --pillar design --jobs 3
```

For each case, the runner prepares a snapshot (below). It writes the title, description, and a
numbered diff (base and head line numbers on every line) into `.review/` inside that tree, then
runs `claude -p` on Sonnet with the tools `review` gives that pillar (`pillarCapabilities`): `Read`,
`Grep`, `Glob`, `Agent` and `Skill`, plus `git log` and `git show` through `Bash` for the
`history` pillar. There is no other shell, network, or `gh`, so the reviewer cannot look up the
revert. Each pillar prompt is prefixed with the shared `_contract.md`.

### Another harness for the pillar agent

`--harness NAME` runs the pillar agent on another registered harness, such as `codex`, so a pillar
can be measured there. Only the pillar agent moves: the judge (`--judge`), selection (`--select`)
and the verifier stay on Claude. `--model` is then that harness's own model id and is required.
It is still one candidate with no fallback and the default wait budget.

`--reads-outside-checkout` sets `readsOutsideCheckout` on that candidate, which the Codex adapter
requires; `--harness codex` does not imply it. `bench` checks every pillar's capabilities against
the adapter before any snapshot or model call and stops naming the flag or the pillar: without the
grant, or for `history` (it asks for `git log` and `git show`, which Codex refuses), the command
fails at once. An unknown name lists the registered harnesses, and `--loads-only` needs Claude.

```bash
pnpm exec code-reviewer bench --cases benchmarks/review/synthetic.json \
  --prompts skills/review/references/pillars --out "$TMPDIR/review-bench-codex" \
  --pillar correctness --harness codex --model gpt-6.2-sol --reads-outside-checkout
```

Codex reports no cost and no loaded skills. Such a run records `harness` in each raw result and
in each pillar of `summary.json`, and `summary.md` opens with a `Harness:` line. Its cost cells
show `-`, never `$0`, and its Skills loaded and Grounded recall cells read "not reported". Rows
from another harness are not comparable with Claude rows: the model, tools and cost accounting
differ. `--score-only` reads the harness from the saved results.

### Shell for the pillar agent

`--shell PREFIX` (repeatable) is an experiment flag: it adds read-only command prefixes to the
pillar agent on Claude, on top of what the pillar already has, so a run can test whether a pillar
finds more when it can run `git` and `rg` itself, as the Codex sandbox lets it. A prefix is a
command name and subcommand; `bench` grants whatever is named, with no allowlist of commands. It
fails before any work, naming the flag, on an empty prefix, on one with shell syntax (`;`, `|`,
`&`, `>`, `<`, a backtick, `$(` or a newline), and with a non-Claude `--harness`, because Codex
refuses shell prefixes. `review` and `run` never grant it.

```bash
pnpm exec code-reviewer bench --cases benchmarks/review/cases.json \
  --prompts skills/review/references/pillars --out "$TMPDIR/review-bench-shell" \
  --pillar correctness --shell "git log" --shell "git show" --shell "git blame" \
  --shell "git diff" --shell "git grep" --shell rg
```

Each raw result and each pillar of `summary.json` records `shell`, and `summary.md` opens with
"Shell granted to the pillar agent: ...". Such rows are not comparable with normal rows: the pillar
has tools a review does not grant. `--score-only` reads the prefixes from the saved results.

### Reasoning effort for the pillar agent

`--effort LEVEL` runs the pillar agent at `low`, `medium`, `high` or `xhigh`, on Claude or on
`--harness codex`; `max` (and Codex's `ultra`) is not allowed. Any other level is refused before
any work, naming the flag and the levels. A review runs at `medium` in full mode and `low` in light
mode, so the flag is for testing whether a pillar's recall is an effort problem. `medium` is the
default: `--effort medium` records nothing and its rows are comparable with a run without the flag.

```bash
pnpm exec code-reviewer bench --cases benchmarks/review/cases.json \
  --prompts skills/review/references/pillars --out "$TMPDIR/review-bench-high" \
  --pillar correctness --effort high
```

A run at another level records `effort` in each raw result and in each pillar of `summary.json`,
and `summary.md` opens with an `Effort:` line saying its rows are not comparable with normal rows.
`--score-only` reads the effort from the saved results. Only the pillar agent changes; the judge,
selection and verifier keep their own effort.

### Rounds for the pillar agent

`--rounds N` (1 to 3) is an experiment flag: it runs the pillar agent up to N times per case, to
test whether low recall comes from the agent stopping early. Each later round runs the same
pillar step with one extra block appended to the prompt by the benchmark only: the findings so far
(path, line, title, body, as data) and an instruction to look for problems not in that list, to
return only new findings, and to return none if there are none. A round after the first that adds no finding ends
the run, and a later finding at a file and line already reported is dropped. `review` and `run`
never do this. Anything but 1 to 3 fails before any work, naming the flag, as does `--loads-only`.
The default, 1, writes exactly the normal output.

```bash
pnpm exec code-reviewer bench --cases benchmarks/review/cases.json \
  --prompts skills/review/references/pillars --out "$TMPDIR/review-bench-rounds" \
  --pillar correctness --rounds 2
```

The raw result holds the merged findings, `rounds` (requested), `roundsRun`, and `roundFindings`
(what each round added); usage is the sum across rounds. A later round that fails keeps the earlier
findings and records `roundError`. `summary.json` records `rounds`, and `summary.md` opens with
"Rounds: pillar agent run up to N times per case; ...". Such rows are not comparable with normal
rows. `--score-only` reads the rounds from the saved results and refuses a directory whose results
differ.

Results are written to `<out>/raw/<pillar>/<case>.json`, then `summary.json` and `summary.md`. Use
`--score-only` to re-score existing raw results, and `--case <id>` to run one case. Runs cost
money and take minutes per case, so run only the pillars whose prompts changed.

Add `--judge sonnet` to grade by claim instead of location. A tool-less `claude -p` call per case
decides which finding, if any, raises each labeled problem, even at a different file or line, and
stores the assignment in the raw result. Judging is cached per model, so `--score-only --judge
sonnet` re-scores for free after the first pass. Prefer judged numbers; location matching both
credits unrelated findings at the right file and misses the right claim cited elsewhere.

### Mined case checkouts

A mined case's tree is a git checkout built from a per-repository cache under `<out>/cache`:

- **Cache**: `<owner>__<name>.git`, a bare repository with an `origin` and no branch refspec. A case
  populates it with `git fetch origin <baseSha> <headSha>` using the `gh` credential helper, so it
  holds the full history of those two commits and nothing newer. It is neither shallow nor
  filtered, and it is shared by the cases of a repository.
- **Tree**: `git init`, with the cache's `objects` directory as an alternate (no copy of the
  objects), `refs/remotes/origin/<base branch>` and `refs/remotes/origin/HEAD` at `baseSha`, and
  HEAD detached at `headSha`. The base branch name comes from `gh pr view`. `git diff
  origin/<base>...HEAD`, `git merge-base` and `git log origin/<base>..HEAD` work. The tree has no
  remote, so nothing can be fetched into it, and `.review/` is in `.git/info/exclude`.
- **Diff**: `<baseSha>...<headSha>`, taken from the cache.

Fixture cases are not git checkouts: their tree is a copy of `head/` with no `.git`.

What this does not hide: the cache of a repository also holds the commits fetched for its other
cases, so a commit that is later than one case's head, such as a revert, can be present as an object
when another case's head follows it. No ref reaches it, so `git log` and `git log --all` do not list
it and it can be read only by naming its SHA, which the case does not contain. Treat a catch that
cites a later commit as suspect. A cache made before this change (a directory without the `.git`
suffix) holds every branch and is never read; delete it.

## Verifier

The verifier is benchmarked on its own, without re-running pillars or dispatching subagents:

```bash
pnpm exec code-reviewer bench-verifier \
  --cases benchmarks/review/cases.json \
  --findings-from "$TMPDIR/review-bench" \
  --prompts skills/review/references \
  --out "$TMPDIR/review-verifier" --jobs 3
```

`--findings-from` is the `--out` directory of an earlier `bench` run. The command first judges any
of those pillar results that lack a current `--judge` assignment (default `sonnet`), so each input
finding is labeled real (it raises a labeled problem) or noise. For each case it gathers every
pillar's findings, plants a copy of each real finding under a second pillar, and makes one
`claude -p` call (default Opus) in the same snapshot with `verifier.md`, the congruence
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

## Skill selection

Before the pillars run, `review` makes one tool-less Haiku call (`selectSkills`) that reads the pull
request title, the changed-file index, the start of each file's patch, and the descriptions of the installed rule skills, and names
the skills the pillars must load. This eval asks one question: does that call name every skill a
case needs? It runs the same function on the same kind of input for each case that declares
`expectedSkills`, several times, and counts the attempts that name all of them. An any-of group is
met by any one member.

```bash
pnpm exec code-reviewer bench-selection \
  --cases benchmarks/review/cases.json \
  --cases benchmarks/review/synthetic.json \
  --out "$TMPDIR/review-selection"
```

Each attempt costs one Haiku call, with `--attempts 3` (default) per case. Attempts are saved to
`<out>/raw/<case>/<attempt>.json`; `summary.md` has a row per case, a row per expected skill (the
skills whose descriptions fail to trigger), and tokens by model. `--score-only` re-scores saved
attempts, `--case <id>` limits the run, and `--cache <dir>` reuses the clone cache of an earlier
`bench` run.

A case may also declare `"unwantedSkills": ["jong-skills:agent-workflow"]`: full `plugin:skill`
names the call should leave out because nothing in the changed files falls under what the skill
governs. The loader rejects an empty array, a bare name, a repeat, and a name that is also in
`expectedSkills` (an any-of member counts). The names are only scored here; `bench` ignores them.
When any case declares them, the run also reports over-selection, and cases without the field are
unaffected:

- **Unwanted selections**: the attempts, of the cases that declare the field, that named at least
  one unwanted skill, as "N of M attempts", plus the number of unwanted selections in all.
- **Per skill**: for each unwanted skill, the attempts of the cases that list it that selected it.
- **Per case**: attempts with any unwanted skill, and the count per skill.

They appear in `summary.md`, in `summary.json` (`summary.unwanted`, and `unwanted` on each case
and attempt that declares it) and as an `unwanted` object in the final JSON line. A hit does not
depend on them.

It does not show that the reviewer then loads or applies a selected skill, that a selected skill
helps, or that the other skills offered did no harm: it counts only the names returned. Without
`unwantedSkills`, selecting extra skills is not penalized; the mean number selected is reported
beside the hit rate. A label is a judgment about what the changed files need, so a selection of an
unlabeled skill is not a claim that it was right.

The score for this eval is in the benchmark README.

## Shared context

`bench-context` asks whether the thing a pillar needs is in the context a review builds. It makes
no model call and exits 0 whatever the result.

```bash
pnpm exec code-reviewer bench-context \
  --cases benchmarks/review/synthetic.json \
  --history benchmarks/review/context-history.json \
  --out "$TMPDIR/review-context"
```

- **Rule excerpts.** For each case with `expectedSkills`, it builds the rule-excerpts section for
  exactly those skills (every member of an any-of group; no selection step) from the installed
  rule plugins, and reports each skill as quoted in full, in part or not at all. A case's optional
  `expectedRules` (`[{ "skill", "text" }]`, `skill` listed in `expectedSkills`) names the rule an
  expected finding depends on, as a verbatim substring of one rule line. Each is reported as
  `present` (quoted in the excerpt), `cut` (in the installed skill but not quoted: over the cap or
  a prose skill), `missing` (not in the installed skill: the text or the skill has drifted) or
  `absent` (the skill is not installed). The report also gives characters quoted per skill against
  the cap and the size of the section.
- **History and linked regressions.** `--history` files hold cases of `base` and `head` commits
  (each a message and `files`, path to full text) that are built into a temporary git repository.
  A `{0}` in a message is the full sha of base commit 0. `expect.history` lists base commits that
  the changed-line-history section must list under a path, and `expect.linked` base commits the
  linked-regressions section must find. Only local git is used; the eval never calls GitHub.
- **Output.** `summary.json` and `summary.md` in `--out`, and the same table on stdout.
  `--case <id>` limits the run.

It does not measure whether a pillar reads or applies the excerpt; `bench --excerpts` does. The
score is in the benchmark README.

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

# Benchmark history

Newest first. Every measured run and every change to what is measured gets an entry.

## 2026-11-21: selected skills are forced on the `rules` pillar only (three runs)

The change: `review` tells only the `rules` pillar to load every skill the selection step chose;
every other pillar, including a configured one, gets no such list and follows the contract's line to
load the skills whose description matches. `bench --select` does the same, and
`bench --select --select-all-pillars` reproduces the earlier behaviour. Three runs decided it. All
used reviewer Sonnet (`claude-sonnet-5-5`), judge Opus, synthetic cases, the same session, on
2026-11-21. "Pointed" is `bench` without `--select`; "forced" is `bench --select` as it was before
this change.

1. `rules` pillar, three attempts per arm, the other five tagged cases
   (`rules-skills-sweep-until-empty`, `rules-manifest-only-duplicate-utility`,
   `rules-content-only-metrics-on-tx-client`, `rules-content-only-unordered-pick`,
   `rules-near-miss-renamed-log-field-monitor-updated`), commit 0ba88c2.

   | Arm     | Recall   | Distinct skills per run | Turns per run | Cost per run  |
   | ------- | -------- | ----------------------- | ------------- | ------------- |
   | Pointed | 9 of 12  | 1.6                     | 11.3          | $0.12 ($1.82) |
   | Forced  | 12 of 12 | 6.3                     | 21.1          | $0.15 ($2.28) |

   No false alarm on the negative case in either arm. Pointed missed
   `rules-content-only-unordered-pick` in all three attempts: it loaded `postgresql-rules` and never
   `queue-rules`, which the selection step had picked. With the earlier five-case entry this is 24
   of 27 pointed against 27 of 27 forced.

2. `--loads-only`, pillars `correctness`, `security` and `design`, one attempt per arm, four cases
   (`rules-test-only-global-call-count`, `rules-content-only-argv-entry-check`,
   `rules-content-only-renamed-log-field`, `rules-skills-sweep-until-empty`), the commit that added
   `--loads-only`. No judge, so no recall.

   | Arm     | Skills per run (`correctness` / `security` / `design`) | Turns per run      | Cost per run          |
   | ------- | ------------------------------------------------------ | ------------------ | --------------------- |
   | Pointed | 0.3 / 0.0 / 0.0                                        | 7.8 / 5.0 / 7.0    | $0.11 / $0.08 / $0.09 |
   | Forced  | 6.3 in each                                            | 19.0 / 17.8 / 18.5 | $0.15 / $0.13 / $0.14 |

3. `correctness` and `blast-radius` on their own cases, three attempts per arm, seven cases
   (`lock-scope-ancestor-locks`, `lock-scope-race-response`, `links-declared-api-payload`,
   `links-consumer-field-rename`, and negatives `lock-scope-written-row-only`,
   `options-forwarded-to-helper`, `links-consumer-additive-field`), main after `--loads-only`
   merged. Both arms: recall 9 of 9 (`correctness`) and 3 of 3 (`blast-radius`), no false alarm in 9
   negative runs per pillar. Pointed: 0.2 skills per run, $3.23 for 30 runs. Forced: 6.1 skills per
   run, $4.55 for 30 runs.

What it showed: forcing earns its place only in `rules`, where the pointed pillar missed a skill the
selection step had picked. Elsewhere it costs about 40% more per run and roughly 2.5 times the
turns for the same findings.

Limits: recall is at the ceiling in run 3, so it cannot show a small loss. The cases are synthetic.
`security`, `design`, `congruence` and `history` have no recall measurement. Whether a non-`rules`
pillar finds more on real cases with a rule skill loaded is unmeasured.

Comparability: this change makes every earlier `--select` row for a non-`rules` pillar
non-comparable with later ones, because those pillars no longer get the instruction. The change
itself was not re-run after it was implemented.

## 2026-11-21: `bench --loads-only` (no run)

No model run. A new opt-in flag runs the named pillars on the named cases whatever pillars the
cases expect, skips the judge, and reports the skills each pillar loaded, whether each case's
`expectedSkills` were loaded, and cost, with no recall, severity or false-alarm figures. It is for
comparing pointed (`bench`) and forced (`bench --select`) skill loads on pillars other than
`rules`. Without the flag prompts, arguments and outputs are unchanged, so no earlier entry stops
being comparable.

## 2026-11-21: skill loading, pointed against forced: `rules` pillar, three attempts on five synthetic cases

Commit 0ba88c2. Reviewer Sonnet (`claude-sonnet-5-5`), judge Opus, `--pillar rules`, three runs per
arm in the same session, the five cases of the `--excerpts` pilot. "Pointed" is `bench` without
`--select`: the contract alone tells the pillar to load the skills whose description matches.
"Forced" is `bench --select`: the selection step picks skills and the pillar is told to load every
one, as a review does. Neither arm had a context file. Reviewer cost $3.73.

| Arm     | Recall   | Expected skill loaded | Distinct skills loaded per run | Turns per run | Cost per run |
| ------- | -------- | --------------------- | ------------------------------ | ------------- | ------------ |
| Pointed | 15 of 15 | 15 of 15              | 1.0                            | 9.4           | $0.12        |
| Forced  | 15 of 15 | 15 of 15              | 3.6                            | 16.2          | $0.13        |

Pointed, the pillar loaded exactly the expected skill in every run and nothing else. Forced, it also
loaded the selected prose skills (`typescript-authoring` 12 times, `test-authoring` 6) and took
about 70% more turns for the same findings. All five cases expect a `no-mistakes-rules` skill, so
this does not show whether a pointed pillar loads a prose skill it needs, and it covers one pillar:
`bench --pillar correctness` ran no case, because these cases expect only `rules` findings. Recall
is at the ceiling in both arms, so the sample cannot show a recall difference.

## 2026-11-21: first `bench-context` run: is the rule a case depends on in the shared context

Commit 6302658. No model: `bench-context` builds the rule-excerpts section for exactly the
`expectedSkills` of the 10 tagged synthetic cases (no selection step) and checks that section's
text, and builds three small history cases in temporary git repositories. Installed plugins:
`no-mistakes-rules` 0.109.103 and `jong-skills` 2408b5e03fdc. Cost $0.00.

| Check                                           | Result                                                       |
| ----------------------------------------------- | ------------------------------------------------------------ |
| Expected skills quoted in full / in part / none | 9 / 1 / 1 (of 11 skill rows; one case names an any-of group) |
| Expected rule text in the excerpt               | 10 present, 1 cut, 0 missing from the skill, 0 not installed |
| Most quoted from one skill                      | 4,857 of 6,000 characters (`testing-rules`)                  |
| Mean / largest rule-excerpts section            | 3,787 / 5,516 characters                                     |
| History and linked-regression checks            | 5 of 5 found (3 cases)                                       |

The one rule cut from the excerpt is in `jong-skills:bounded-iteration`, which is mostly prose, so
it is never quoted; the same case also names `no-mistakes-rules:queue-rules`, which is quoted in
full and holds the sibling rule ("MUST NOT loop until empty"). `postgresql-rules` is quoted in
part and still holds the rule its case depends on. Every case that depends on one rule therefore
has that rule in the context, but one case would rest on a skill load if the excerpts replaced
loading. This does not measure whether a pillar uses the excerpt (`bench --excerpts` does).

## 2026-11-21: (no run) the pillar's context line says the context is not exhaustive

When a review builds a shared context file, the line that names it in each pillar prompt gains:
"It is not exhaustive: a section that is empty or short means nothing was found mechanically, not
that nothing exists. Check anything you rely on from it against the code, and look further with git
or the files when you need more." A plain `bench` passes no context file and is unchanged;
`bench --excerpts` (both arms) carries the new sentence, so the 2026-11-21 pilot is not comparable
with later `--excerpts` runs. No run was made and no score is re-measured.

## 2026-11-21: pilot of `bench --excerpts`: one attempt per arm on five synthetic rules cases

Commit 6ce16d7. Reviewer Sonnet (`claude-sonnet-5-5`), judge Opus, one attempt per arm, both arms in
the same session, `--pillar rules --select`. Cases: `rules-test-only-global-call-count`,
`rules-test-only-per-item`, `rules-content-only-argv-entry-check`,
`rules-workflow-only-path-filtered-required-check`, `rules-content-only-renamed-log-field`.

| Arm         | Recall | Findings per PR | Distinct skills loaded per run | Turns per run | Input tokens per run | Cost per run | Total |
| ----------- | ------ | --------------- | ------------------------------ | ------------- | -------------------- | ------------ | ----- |
| `alongside` | 5 of 5 | 1.2             | 4.0                            | 15.2          | 130,500              | $0.13        | $0.66 |
| `replace`   | 5 of 5 | 1.4             | 2.2                            | 11.4          | 103,511              | $0.14        | $0.71 |

Under `replace` the pillar loaded fewer skills and took fewer turns, and every expected claim was
still found. Cost did not fall: the saved cache reads were offset by more cache creation. In one
case (`rules-workflow-only-path-filtered-required-check`) the `replace` run loaded no skill at all,
including two that were not quoted, so the override can also suppress loads it should not. In two
cases it still loaded a `no-mistakes-rules` skill. Grounded recall is not comparable between the
arms, because a fully quoted skill is not loaded. One attempt per arm cannot resolve a difference in
recall or cost; this is a pilot, not a measurement, and no README row changes.

## 2026-11-21: (no run) `bench --excerpts` arm: shared rule excerpts with or without loading quoted skills

`bench` gains an opt-in `--excerpts alongside|replace` (requires `--select`). It builds review's
rule-excerpts section for the selected skills, writes it to `.review/review-context.md` and adds
review's line about that file to the pillar prompt. `alongside` adds only that, which is what a
review sends today; `replace` also marks each skill as quoted in full, in part or not at all, and
ends the prompt with a block telling the pillar not to load fully quoted skills (overriding the
contract's and the selection step's "load every skill" lines). `summary.json` records the arm and
distinct skills loaded per run, and the printed table names the arm. Without the flag the pillar
prompt, argv and outputs are unchanged, so no existing case moves. The bench pillar prompt
previously had no excerpts at all, so `alongside` is not comparable with any earlier entry.
No run was made and no score is re-measured.

## 2026-11-21: (no run) production verifier of a follow-up is offered earlier evidence that still holds

A production follow-up review whose earlier review of this machine saved evidence for a source that
declares `paths` in the machine config, where none of those paths changed since the commit the
evidence ran against, adds one block after the earlier-review block of the verifier prompt: the
saved source name, commit, status and result text, as data that was not re-run and that the
current code overrides. The block is conditional and, when it is added, the earlier-review block drops its
sentence that no evidence is offered. Without `paths` configured nothing is added and every prompt
is unchanged. The benchmark verifier arm passes no earlier review and no evidence, so benchmark
prompts are unchanged. No run was made and no score is re-measured.

## 2026-11-21: (no run) findings gain an optional `fix` field for fixer-only detail

The pillar contract now narrows `body` to what is wrong and why it matters, and the pillar output
schema, the verifier output schema (production and benchmark) and the approval-check schema gain an
optional `fix` string for exact steps, file lists, commands and reproduction, which is posted
collapsed. The verifier reference tells the verifier to move such detail into `fix`. Every pillar
and verifier prompt and schema therefore differs: **all cases are no longer comparable with earlier
entries until re-measured**, and no README row is re-measured. Pillars may now write shorter
bodies, which could move which expected claim a judge finds in the body. No run was made.

## 2026-11-21: (no run) production verifier of a follow-up sees this machine's earlier review

A production follow-up review (light, diff since the last reviewed commit) whose pull request has an
earlier review of this machine at an ancestor of the head, found in the tracker and that run's
`report.json`, now adds one block to the verifier prompt: the earlier findings as claims, and the
instruction to report only what is new since that commit or what the diff since it made wrong. No
schema field changes. The benchmark verifier arm (`buildVerifierPrompt`) passes no earlier review and
no case supplies a since-diff or a reviewed SHA, so no case is a follow-up and none would be affected
if the benchmark did pass an earlier review; a new case of that kind is where precision could move,
because the verifier could drop a finding it should have kept. No run was made and no score is
re-measured.

## 2026-11-21: (no run) production verifier may propose splitting a large mixed change

A production review of a large change whose git-measured shape has both a substantial mechanical
part (the same edit repeated across files, or whitespace-only lines) and a substantial remainder
now adds one block to the verifier prompt and an optional `splitProposal` to its output schema: one
or two sentences naming what to move into its own pull request, or nothing when a split would not
help. It never changes a finding, a severity or the verdict. The benchmark verifier arm
(`buildVerifierPrompt`, `VERIFIER_OUTPUT_SCHEMA`) passes no summary and is unchanged, so no
`bench-verifier` prompt differs and no score here measures this. Cases that would be affected if it
did: only one whose fixture diff is large and mixes a repeated mechanical edit with hand-written
changes. None does today. No run was made and no score is re-measured.

## 2026-11-20: (no run) production verifier reviews a change that fixes a regression

A production review whose pull request names commits it fixes or reverts, found in local history,
now adds one block to the verifier prompt and an optional `regressionPrevent` to its output schema:
check that the diff addresses what those commits broke, and give at most one line naming a rule or
test that would have caught it. The benchmark verifier arm (`buildVerifierPrompt`,
`VERIFIER_OUTPUT_SCHEMA`) passes no linked commits and is unchanged, so no `bench-verifier` prompt
differs and no score here measures this. Cases that would be affected if it did: only a case whose
fixture commit messages revert or fix a commit present in its history. None does today; a new case
of that kind is where precision could move, because the verifier could raise a finding that a pillar
did not report. No run was made and no score is re-measured.

## 2026-11-20: (no run) production verifier may restate other reviewers' blocking/high items

A production review whose pull request has unresolved threads from other reviewers that state a
blocking or high severity now adds one block to the verifier prompt and an optional `raisedBy` to
its output schema; the verifier may restate a valid item as a finding that credits and links the
reviewer. The benchmark verifier arm (`buildVerifierPrompt`, `VERIFIER_OUTPUT_SCHEMA`) passes no such
items and is unchanged, so no `bench-verifier` prompt differs and no score here measures this.
Cases that would be affected if it did: only a case whose fixture lists another reviewer's open
thread with a blocking or high marker. The one fixture with another reviewer's note,
`lock-scope-race-response`, states P2 (medium), so even then it would pass no item; a new case
with a P0 or P1 note is where precision could move, because the verifier could then keep an item no
pillar reported. No run was made and no score is re-measured.

## 2026-11-20: (no run) production pillars may read a context file

A production review now builds `review-context.md` (rule excerpts quoted from the selected skills,
history of the changed lines, commits the change says it fixes or reverts) and adds one paragraph
to each pillar prompt that names it. The benchmark does not build or pass that file, and
`src/review/benchmark/runner.mts` is unchanged, so no `bench` prompt differs and no score here
measures the context. Production pillar prompts differ from the benchmark's by that paragraph
whenever a context file was built. A later opt-in arm will compare pillars with and without the
file in one session. No run was made and no score is re-measured.

## 2026-11-21: (no run) security pillar no longer calls /security-review

`pillars/security.md` lost its "Built-in reviewer" section, which told the pillar to run a host's
`/security-review` command when one existed. No built-in prompt calls a harness's native reviewer
any more, so a security run reviews directly on every harness. Every `bench` security pillar row
(the security cases in `cases.json` and `synthetic.json`) and every verifier row that takes
security findings from the saved pillar output is no longer comparable with earlier entries; the
other pillars' prompts are unchanged. No run was made and no score is re-measured.

## 2026-11-20: bench output gained per-model token figures (no run)

`bench`, `bench-selection` and `bench-verifier` now report, per model and arm, input, cache-read,
cache-creation and output tokens and cost, as totals and per-run means, with how many runs each
figure covers. No score changed and no case, grader or prompt changed; every row stays comparable.
No run was made. See `docs/benchmarks.md`.

## 2026-11-20: the rule plugin list became configurable (no run)

The machine-only `rulePlugins` key replaces the hardcoded list of rule plugins. The default list is
unchanged and the default prompts are byte-identical to before (a test pins the contract and rules
text). Benchmarks stay pinned to the default list and never read machine config, so no score is
affected. No run was made.

## 2026-11-19: the congruence pillar now checks referenced issues (no run)

`pillars/congruence.md` says to hold the change to what each referenced or closing issue asks, and
`_contract.md` lists `issues.json`. The per-run Linked issues block and the "Referenced issue"
quotes in `context.md` appear only when the description refers to an issue other than a closing
one, which bench cases do not do, so the benchmark prompts differ from before only by the added
reference text. The congruence rows are not comparable with earlier entries until re-measured. No
run was made.

## 2026-11-19: the contract and verifier prompts gained a dependencies rule (no run)

`pillars/_contract.md` gained a Dependencies section and `verifier.md` a step and an output field
for implied dependencies. The per-run Known dependencies block appears only in runs whose directory
has a `dependencies.json`, which bench cases never have, so the benchmark prompts differ from before
only by the added reference text. The extended verifier output schema adds an optional field. No run
was made; scores are not re-measured.

## 2026-11-19: the contract and verifier prompts gained a carried-changes rule (no run)

`pillars/_contract.md` gained a Carried changes section and `verifier.md` a step that drops findings
on carried changes. The per-run Carried changes block appears only in runs whose directory has a
`carried.json` with carried commits, which bench cases never have, so the benchmark prompts differ
from before only by the added reference text. No run was made; scores are not re-measured.

## 2026-11-19: an empty evidence result needs a working control query (no run)

`references/evidence.md` step 4 now spells out the control rule (loosen the same query so it must
return something; if the control is also empty the evidence is inconclusive, effect `none`).
Only the evidence run reads this file; `bench` never runs it, so no benchmark prompt, case or
score is affected. No run was made and the new wording is not measured live.

## 2026-11-19: premise challenge and a prevention note on findings (no run)

`pillars/_contract.md` gained a Premise section (a reviewer may challenge whether the change should
exist in this form, only with evidence from the tree or context, as a `medium` or `low` finding
the verifier may turn into a question, never `blocking` or `high` on that ground alone) and an
optional `prevent` line on a finding (a mechanical check that would stop the class of mistake).
`verifier.md` step 2 and step 8 say how to keep or convert them. The pillar and verifier output
schemas gained an optional `prevent` string, which the bench graders ignore. Every pillar prompt
includes the contract, so every `bench` pillar row and every `bench-verifier` row is no longer
comparable with earlier entries. The expected movement is a few extra `medium` or `low` premise
findings and `prevent` lines; recall of expected findings is not expected to move. No run was made.

## 2026-11-19: a full review that would approve gets a second check (no run)

New `references/refute.md`, the prompt of a separate run (the approval check) that tries to refute
an approval, and one added paragraph in `verifier.md`'s Verdict section pointing at it. The check
runs only in `review`, after the verifier, for a full review whose derived verdict is Approve; the
benchmark has no such step and never reads `refute.md`. `bench-verifier` rows are not comparable
with earlier entries (the verifier prompt text changed by that paragraph); recall and severity are
not expected to move. The approval check itself is not measured. No run was made.

## 2026-11-19: posted text is short and free of review narration (no run)

`pillars/_contract.md` gained a rule for posted text: lead with the defect and its consequence, one
finding per comment, no narration of the review (pillar, what was checked, tool names, "the
verifier"), no praise, no restating the diff, and link an open thread instead of restating it.
`verifier.md` step 5 no longer asks the body to credit another reviewer at length. Every pillar
prompt includes the contract, so every `bench` pillar row and every `bench-verifier` row is no
longer comparable with earlier entries; body length and wording are the expected movement, recall
is not. The length targets and the process-word check are deterministic code in `post`, not graded
by the bench. No run was made.

## 2026-11-19: `blocking` is rarer and the verifier re-decides severity (no run)

`pillars/_contract.md` now defines `blocking` by four conditions that must all hold (code that
runs, a path someone takes, introduced or made reachable by this pull request, a fix that needs a
decision rather than a mechanical edit), with special cases: a wrong path behind a flag that ships
off blocks only if it would stop the flag being turned on, a guard that fails open on an
irreversible or money-moving action blocks, untested but correct-looking code does not, and a
title or description problem is `medium` at most. The pillar bars were reconciled: correctness
(a missing test is never blocking), congruence (`medium` at most), and rules (a rule a linter or CI
check enforces is `high` at most). `verifier.md` decides severity anew rather than re-rating the
pillar's, and a merged finding takes the severity the verifier decides, not the strongest. Every
pillar prompt includes the contract, so every `bench` pillar row and every `bench-verifier` row,
including severity agreement, is no longer comparable with earlier entries. Recall of expected
findings is not expected to move, since a finding still counts when rated `high`; severity
agreement on `blocking` cases may fall by design. No run was made.

## 2026-11-19: the verifier may return open questions, which make the verdict Comment (no run)

`verifier.md` gained a Questions step (ask only what the code and context cannot settle and whose
answer could change the review; each question has `askOf` and a required `why`), a top-down
Verdict rule (blocking finding: Request Changes; else a high finding or any open question:
Comment; else Approve), and a `questions` array in its example output. The verifier output schema
(shared by `bench-verifier` and `review`) gained an optional `questions` array, which the bench
graders ignore. `context.md` gains an "Open questions from the last review" section only when the
last review asked some, which no bench case has. A run with no questions returned and the same
findings differs from before only by the added verifier text. No run was made. `bench-verifier`
rows are not comparable with earlier entries: its prompt text and schema changed. Pillar rows
(`bench`) are unaffected.

## 2026-11-19: the contract and verifier prompts gained a merge-resolution rule (no run)

`pillars/_contract.md` gained a Merge resolutions section (judge the resolution, not the incoming
base change) and `verifier.md` a step that reads the resolutions. The per-run Merge resolutions
block and the push routing (a re-review after a base-only merge or an unchanged-change rebase is
light) appear only for runs whose directory has `push.json`, which bench cases never have, so the
benchmark prompts differ from before only by the added reference text. No run was made; scores are
not re-measured.

## 2026-11-19: correctness, security and verifier runs may fetch configured references (no run)

When a machine config lists `references`, the correctness pillar, the security pillar and the
verifier get `WebFetch` allowed for the listed domains only, a References block in their prompt,
and `--setting-sources ''` (no settings file, as for the history pillar's shell). Their prompts and
flags are unchanged when none is configured, which is every bench run: `bench` is not wired to
references and never passes domains, so the benchmark prompts and tools are identical to before.
No run was made; scores are not re-measured, and a real review with references may behave
differently from the bench.

## 2026-11-19: the contract and verifier prompts gained a stack block (no run)

`pillars/_contract.md` gained a Stacks section and `verifier.md` a Stacks step: judge each finding
against the top of the stack, and keep a finding a later member fixes as `low` with a `Fixed in #N:`
prefix. The per-run Stack block that carries the members and the later diffs appears only in runs
whose directory has `stack.json`, which bench cases never have, so the benchmark prompts differ from
before only by the added reference text. No run was made; scores are not re-measured.

## 2026-11-19: history pillar runs load no settings file (no run)

The history pillar is the one pillar with a shell. It passed `--setting-sources user`, so the
operator's own allow rules and sandbox auto-allow applied on top of its `git log` / `git show`
allow-list: in a live check with those settings a run executed every command it was given,
including a chained `touch`. It now passes `--setting-sources ''`. In the same check without user
settings, chained and substituted commands were denied, read-only built-ins and `git log` ran, and
the rule plugins still loaded. Other pillars have no shell and are unchanged. History-pillar scores
were not re-measured; user hooks and environment settings no longer reach that pillar, so its
earlier rows are not strictly comparable.

## 2026-11-19: `vouchington-2936` re-measured after the lock rule was reworded

Commit: the one before the snapshot change above (runs used the export without history).
Reviewer Sonnet 5.5, selection Haiku, judge Opus, correctness pillar, 3 attempts with `--select`
and 3 with `--no-rules` in one session. Rule plugins: `jong-skills` 8cad1e4eb680 (its
`postgres-schema-design` now says to avoid advisory locks, where 0480fabddb14 said never to use
them) and `no-mistakes-rules` 0.109.97 (was 0.109.60). Reviewer cost $0.69.

| Case               | With skills | Without |
| ------------------ | ----------- | ------- |
| `vouchington-2936` | 0 of 3      | 0 of 3  |

All three runs with skills loaded `jong-skills:postgres-schema-design`. In the 2026-11-16 run every
attempt objected to the advisory lock itself. Here none does: two attempts raise nothing, and one
reviews the lock key (single-key hash form, unbounded wait) without finding that batch ids
differing only in letter case take different locks. The rewording removed the wrong finding; it did
not produce the expected one, which neither rule plugin describes. Both plugins changed since the
earlier run, so the difference is not attributable to the lock wording alone.

Also on 2026-11-19, `bench-selection` over both case files with the renamed plugin (22 tagged
cases, 3 attempts, $0.18): the expected skill was selected in 65 of 66 attempts. The miss was
`no-mistakes-rules:queue-rules` on one attempt of `rules-content-only-unordered-pick`.

## 2026-11-19: `review` stops when skill selection fails; no run

Commit: this change. No run. `review` used to continue with no rule skills when the Haiku
selection call failed twice or no rule skill was installed; it now stops with an error and posts
nothing. `bench --select` is unchanged and still records such an attempt as run without skills.

## 2026-11-19: mined cases are git checkouts with history; no run

Commit: this change. No run. A mined case's tree was an export with no `.git`; it is now a git
checkout of the pull request head with full history up to the head, `origin/<base branch>` and
`origin/HEAD` at the base, and no later commit reachable (details in the README's "Mined case
checkouts"). The reviewer can therefore read history and diff against the base ref. Bench pillar
runs also use the tool flags `review` uses: the `history` pillar gets `Bash(git log:*)` and
`Bash(git show:*)` and no other shell; the other pillars are unchanged. Fixture cases are unchanged.

Nothing is re-measured. Results on mined cases from here on are not comparable with earlier
entries, because the reviewer can now read history, and the `history` pillar can use it; the
README table is still the 2026-11-16 closing run. Fixture rows are not affected. The shared clone
cache changed from a full clone to a bare repository under a new directory name, so a run fetches
each case again.

## 2026-11-17: rule plugin renamed to `jong-skills`; no run

Commit: this change. No run. The `skills` plugin (jonathanong/skills) moved to
jonathanong/harness-plugins and is now installed as `jong-skills@harness-plugins`, so its skills
load as `jong-skills:<name>`. `RULE_PLUGINS`, the pillar prompts that name a skill to load, and
every `expectedSkills` tag in `cases.json` and `synthetic.json` now use the new name. Earlier
entries keep the old `skills:` names as they were measured.

Nothing is re-measured. The README table is still the 2026-11-16 closing run, taken with
`skills` 0480fabddb14. A run on this commit needs `jong-skills` installed; with only the old
plugin installed, selection offers no `jong-skills:` skill and every tagged case scores as not
loaded. The new plugin also carries rule changes made since that run (among them advisory locks
going from "never" to "avoid"), so the next run is not comparable with the closing run on the
cases those rules touch (`vouchington-2936` first).

## 2026-11-16: first measured verifier run

Commit: this change. `bench-verifier`, verifier Opus, labels judged by Sonnet, 3 attempts, on the
with-skills findings of the closing run below (attempt N reads attempt N). Cost $25.14: fixtures
$4.99, $4.85, $4.99; mined $3.85, $2.86, $3.60.

| Set           | Real kept        | Label recall, pillars → verifier | Severity agreement | Other high/blocking confirmed | Duplicates merged | Findings before → after         |
| ------------- | ---------------- | -------------------------------- | ------------------ | ----------------------------- | ----------------- | ------------------------------- |
| Fixtures (21) | 100%, 100%, 100% | 100% → 100% in each              | 100% in each       | n/a, n/a, 1 of 1              | 100% in each      | 0.9 → 0.9, 0.8 → 0.8, 0.9 → 0.8 |
| Mined (8)     | 100%, 100%, 100% | 78% → 78%, 67% → 78%, 56% → 56%  | 86%, 100%, 100%    | 2 of 2, n/a, 2 of 2           | 100% in each      | 2.3 → 2.3, 2.0 → 2.3, 2.1 → 2.1 |

No real finding was dropped and every planted duplicate was merged. The verifier refuted nothing,
so the run does not test refutation. `links-consumer-field-rename` was not run: its pillar
(blast-radius) was not in the closing run. Label recall here is Sonnet-judged and is not comparable
with the Opus-judged pillar tables.

## 2026-11-16: closing run on one commit; README rebuilt from it

Commit: this change. Reviewer Sonnet 5.5, selection Haiku, judge Opus, 3 attempts with `--select`
and 3 with `--no-rules`, one session. Rule plugins `no-mistakes-rules` 0.109.60 and `skills`
0480fabddb14. Reviewer and selection cost $23.43: fixtures $10.75 with,
$4.34 without, $0.16 selection; mined $5.58 with, $2.47 without, $0.13 selection.

Why: the README table had rows from several runs and two prompts. Every README number now comes
from this run, except the selection and verifier lines below.

| Group                                         | With skills | Without |
| --------------------------------------------- | ----------- | ------- |
| Fixture rules positives (10)                  | 30 of 30    | 3 of 30 |
| `rules-repo-orchestration-package`            | 3 of 3      | 3 of 3  |
| `links-declared-api-payload`                  | 3 of 3      | 0 of 3  |
| `lock-scope-*` positives (2)                  | 6 of 6      | 6 of 6  |
| Fixture negatives, high or blocking (14 rows) | 0 of 42     | 0 of 42 |
| Mined design (4)                              | 10 of 12    | 5 of 12 |
| Mined rules (1)                               | 3 of 3      | 0 of 3  |
| Mined correctness (3)                         | 5 of 12     | 4 of 12 |

- `vouchington-tooling-154` scored 5 of 6 with skills and 4 of 6 without: the widened correctness
  prompt catches it in the control too, so the previous entry's gain belongs to the prompt.
- `vouchington-2936` 0 of 6 and `vouchington-4154` 0 of 6. Two prompt edits aimed at them (a longer
  "Data shape" item; "when you object to an approach, still review it as written") were tried at 3
  attempts, changed nothing, and were dropped. On `vouchington-2936` the reviewer objects to the
  advisory lock, which `skills:postgres-schema-design` forbids, and never reaches the lock key.
- One `vouchington-1146` run reviewed without skills because the selection call exited 1.
- Expected skill selected and loaded: 30 of 30 fixture runs, 23 of 24 mined runs.

Changes in this commit:

- `correctness.md`: the "Built-in reviewer" section is removed. In the saved transcripts of about 340 bench cases the
  reviewer never invoked `/code-review`, so the section did nothing in a headless run.
- New negative `options-forwarded-to-helper`: a module split whose new function forwards the codec
  options. 0 findings in the correctness pillar in 6 runs. Two positive twins (new code pinning the
  helper's defaults) were written and dropped: the prompt from before the widening caught both 3 of
  3, and so did the no-rules control, so neither showed the widening works. Only the mined
  `vouchington-tooling-154` does.
- Selection wording: a stricter instruction ("pick a skill only when the changed lines contain what
  its description names") was measured with `bench-selection` against the current one. Hits 69 of
  69 both ways; mean selected 8.7 against 8.8. No gain, not kept. Those runs included a positive
  fixture dropped in this commit; re-scored without it the current wording is 66 of 66, mean 9.1.
- `selectSkills` now tries a failed selection call once more, after the `vouchington-1146` run above
  reviewed without skills, and counts both calls in the reported usage. Not re-measured.
- `security.md` keeps its "Built-in reviewer" section: no saved run covers the security pillar.
- First `bench-verifier` pilot: `lock-scope-race-response` and `lock-scope-written-row-only`, 1
  attempt, Opus, $0.51. Real kept 1 of 1, severity agreed, planted duplicate merged.

## 2026-11-16: correctness options check widened; five platform cases removed

Commit: this change. Reviewer Sonnet 5.5, selection Haiku, judge Opus, 3 attempts, with-skills arm,
same session as the entries below, whose current-instruction runs are the control for the prompt.

Prompt: the "Options threading" item in `correctness.md` now also covers new code that calls a
helper taking options without letting its own caller set them. `vouchington-tooling-154` was
missed because its two new functions never gained an option: they call codec helpers that take
`marker` and `sessionIdPattern` and pin the defaults.

| Case (correctness)        | Prompt before | Widened prompt               |
| ------------------------- | ------------- | ---------------------------- |
| `vouchington-tooling-154` | 0 of 6        | 4 of 6, defect raised 3 of 3 |
| `vouchington-2936`        | 1 of 3        | 0 of 3                       |
| `vouchington-4154`        | 0 of 3        | 0 of 3                       |
| Fixture positives (3)     | 9 of 9        | 9 of 9                       |
| Fixture negatives (6)     | 0 high of 18  | 0 high of 18                 |

Reviewer cost $2.30 for the mined runs and $3.53 for the fixtures. The fixture "before" figures
are from the full run below (with the two cleaned negatives from the entry after it).
`rules-docs-only-readme` drew a medium finding in 3 of 3 runs (the README's `pnpm test` cannot
run because `vitest` is not a declared dependency); both of its trees now declare it, not
re-measured. Correctness figures in earlier entries used the prompt before this change.

Cases:

- Removed `vouchington-platform-57`, `-59`, `-62`, `-66` and `-67`. Their rule is not in their
  snapshots (see the entry below), and `rules-repo-orchestration-package` covers it. Earlier
  entries that count 9 design cases or 13 mined cases include them; without them the
  current-instruction design figure is 10 of 12 with skills against 4 of 12 without.
- `rules-repo-orchestration-package` measured: caught and tied to the repository rule in 3 of 3
  with skills ($0.43).

## 2026-11-16: remaining mined cases with the current instruction; repository-rule fixture

Commit: this change. Reviewer Sonnet 5.5, selection Haiku, judge Opus, 3 attempts, same session
and control as the two entries below. With-skills arm only, the seven mined cases not yet run with
the current skill instruction (reviewer cost $4.03, $0.19 a run).

| Pillar      | Caught, current instruction (13 cases) | Earlier instruction | Without |
| ----------- | -------------------------------------- | ------------------- | ------- |
| design      | 12 of 27                               | 16 of 27            | 4 of 27 |
| rules       | 3 of 3                                 | 3 of 3              | 0 of 3  |
| correctness | 1 of 12                                | 1 of 12             | 0 of 12 |

The current-instruction column joins this run with the six-case "no cap" arm below. Every
selected skill was loaded in 39 of 39 runs. Loading the skills did not raise catches. Per case
(current, earlier): `platform-57` 0, 1; `platform-60` 2, 2; `platform-62` 0, 0; `platform-66` 0,
0; `2936` 1, 1; `tooling-154` 0 of 6, 0 of 6; `clients-38` 3, 3. The one unscored
`tooling-154` catch noted below did not repeat in these three attempts.

Case changes, no run beyond a pilot:

- `vouchington-platform-57`, `-59`, `-62`, `-66` and `-67` lose
  `expectedSkills: ["skills:typescript-authoring"]`. Their claim (a business workflow packaged
  behind injected hooks) is stated by vouchington-platform's own `AGENTS.md`, which gained the rule
  after these snapshots' base commits; no shared skill states it. Skill-load and grounded-recall
  figures for design in earlier entries counted these five cases.
- Added fixture `rules-repo-orchestration-package`: the same rule in the fixture repository's
  `AGENTS.md`, broken by a new package. Pilot, 1 attempt per arm: caught and tied to the
  repository rule in both, since `--no-rules` leaves the repository's `AGENTS.md` in place.

## 2026-11-16: three weak fixture positives replaced, two negatives cleaned

Commit: this change. Reviewer Sonnet 5.5, selection Haiku, judge Opus, 3 attempts per arm, one
session, current skill instruction, the five changed cases only (reviewer cost $2.77 with, $1.04
without).

- Removed `rules-test-only-whole-module-mock`, `rules-content-only-dedup-by-entity` and
  `rules-content-only-form-body-mutation`: the control caught each once or twice in three
  attempts. Earlier entries that count 10 rules positives include them.
- Added `rules-test-only-global-call-count` (testing-rules: exact call count on a patched global),
  `rules-content-only-unordered-pick` (queue-rules: work picked without `ORDER BY`) and
  `rules-content-only-argv-entry-check` (typescript-rules: entry module detected through
  `process.argv[1]`). With skills 9 of 9, expected skill loaded 9 of 9; without, 1 of 9
  (`unordered-pick`, 1 of 3: the control raised the defect in the pilot too, and the judge rejected
  it only for not citing the rule).
- Two tried replacements were dropped after a one-attempt pilot because the control caught them: a
  job whose only recovery is the failed set (queue-rules) and an API key shown again after creation
  (security-rules).
- `rules-local-override`: `parseAmount` now rejects exponents, padding and unsafe integers, and a
  `receipt.ts` in both trees uses the exported `formatAmount`. `lock-scope-written-row-only`: the
  tests run against a transaction on a test database through a `test-db.mts` helper present in
  both trees, replacing a fake that echoed `rowCount`. Both negatives: 0 findings in 12 runs with
  skills and 12 without (4 of 12 runs had a high or blocking finding before).
- One unscored run of `vouchington-tooling-154` (correctness, current instruction) raised the
  unforwarded codec options at medium; the three scored attempts with the earlier instruction
  raised nothing.

## 2026-11-16: full fixture and mined run with selection, then a firmer skill instruction

Commit: this change. Reviewer Sonnet 5.5, selection Haiku, judge Opus, 3 attempts per arm, one
session. The with-skills arm uses the new `bench --select`, which runs `review`'s selection step
and ends the pillar prompt with the instruction to load the selected skills; earlier entries ran
without it and are not comparable. `vouchington-1144`, `1145` and `1146` gained
`expectedSkills: ["skills:feature-rollout"]` (its "Reachable from an entry point" rule; a loose
fit for 1144, whose claim is broader).

Fixtures (`synthetic.json`, rules and correctness; reviewer cost $9.00 with, $3.95 without,
selection $0.14):

- Rules positives 30 of 30 with, 4 of 30 without. The control caught
  `rules-test-only-whole-module-mock` (1 of 3), `rules-content-only-dedup-by-entity` (2 of 3) and
  `rules-content-only-form-body-mutation` (1 of 3).
- Correctness: `links-declared-api-payload` 3 of 3 against 0 of 3; both `lock-scope-*` positives
  6 of 6 in both arms.
- Expected skill selected and loaded in 33 of 33 runs of the 11 tagged cases. Selection named 2
  to 10 skills a case.
- Negatives: a high or blocking finding in 4 of 36 runs with skills, 0 of 36 without: three on
  `rules-local-override` (lenient `Number()` parsing twice, an unused export once) and one on
  `lock-scope-written-row-only` (a test that echoes a fake). All are real flaws in the fixture
  code, none is the rule the negative is about.

Mined (13 cases; reviewer cost $6.55 with, $3.48 without, selection $0.17):

| Pillar      | Caught with | Caught without | Expected skill selected | Expected skill loaded |
| ----------- | ----------- | -------------- | ----------------------- | --------------------- |
| design      | 16 of 27    | 4 of 27        | 27 of 27                | 12 of 27              |
| rules       | 3 of 3      | 0 of 3         | 3 of 3                  | 3 of 3                |
| correctness | 1 of 12     | 0 of 12        | 9 of 9                  | 6 of 9                |

Selection named 12 to 20 skills on the larger cases and the reviewer then loaded 0 to 2; with 7 or
fewer it loaded nearly all. The first with-skills attempt 3 died on a `git fetch` before any model
call and was rerun whole.

Skill instruction, same session, the six worst-loading cases (`vouchington-1144`, `1145`, `1146`,
`4154`, `platform-59`, `platform-67`), design and correctness, 3 attempts each:

| Arm                                    | All selected loaded | Expected selected | Expected loaded | Design caught | Cost a run |
| -------------------------------------- | ------------------- | ----------------- | --------------- | ------------- | ---------- |
| Old instruction                        | 0 of 18             | 18 of 18          | 2 of 18         | 13 of 15      | $0.19      |
| New instruction, selection capped at 8 | 18 of 18            | 11 of 18          | 11 of 18        | 10 of 15      | $0.24      |
| New instruction, no cap (kept)         | 18 of 18            | 18 of 18          | 18 of 18        | 10 of 15      | $0.27      |

The new instruction ("Before reading any file, call the Skill tool once for each of these skills,
all in your first turn ... load every one") fixes loading by itself. The cap was dropped: it
pushed the expected skill out of the selection in 7 of 18 runs. Loading the skills did not raise
catches on these cases; `vouchington-4154` and `platform-67` (0 of 3) are missed with the skill
loaded. The remaining seven mined cases and the fixtures are not re-measured with the new
instruction.

## 2026-11-16: verifier prompt no longer tells the verifier to post

No run. `verifier.md` dropped its instructions to preview, post, and resolve threads, which the
headless run already overrode; it now asks for fixed thread ids in the summary. The skills,
source and benchmark directories were renamed (`skills/review`, `src/review`,
`benchmarks/review`), and the snapshot directory is `.review/`. Verifier numbers were never
recorded, so nothing is made incomparable.

## 2026-11-16: skill selection measured, then given a diff excerpt

Agent model Haiku, no judge, 3 attempts per case, 24 cases with `expectedSkills` (14 mined, 10
synthetic). Both runs in one session.

| Selection input                     | Commit  | Named every expected skill | Mean selected | Cost  |
| ----------------------------------- | ------- | -------------------------- | ------------- | ----- |
| Title and file index                | parent  | 63 of 72                   | 8.3           | $0.14 |
| Plus the start of each file's patch | c27a372 | 72 of 72                   | 9.5           | $0.22 |

All nine misses in the first run were the three `rules-content-only-*` cases whose file names say
nothing about the topic (observability, PostgreSQL, queues). `selectSkills` now also receives up
to 2,500 characters of each file's patch, 40,000 in total. Selection is broad: mined cases get 10
to 19 of the 47 skills named, and the eval does not penalize that.

## 2026-11-15: skill-selection eval added

No run. `bench-selection` calls `selectSkills` on each case with `expectedSkills`, `--attempts`
times, and scores whether every expected skill is named. It adds a measurement and changes no
existing case, grader, or prompt, so earlier entries stay comparable. Its results table in
`README.md` is marked not yet measured.

- The selection input is rebuilt from the same snapshot `bench` makes: the title is the first line
  of the snapshot's `pr.md`, and the index is rendered as `prepare` writes `diff/INDEX.md`.

## 2026-11-16: correctness prompt reads lock rules from the skill

Commit: this change, on `feat/review-command`. Reviewer Sonnet, judge Opus, 3 attempts per arm,
both arms in one session. Cases: the three `lock-scope-*` synthetic cases, correctness pillar.
Cost $0.10 per run in the new arm and $0.09 in the control.

`correctness.md` no longer restates the lock rule. It tells the reviewer to load
`skills:postgres-schema-design` when the diff takes a lock or closes a race, and names the test
and data skills as `plugin:skill` instead of bare names with "only when relevant".

| Arm        | Positives caught | Skill loaded (positives) | Skill loaded (all runs) | Blocking or high on the negative |
| ---------- | ---------------- | ------------------------ | ----------------------- | -------------------------------- |
| Old prompt | 6 of 6           | 0 of 6                   | 0 of 9                  | 0 of 3                           |
| New prompt | 6 of 6           | 6 of 6                   | 7 of 9                  | 0 of 3                           |

Recall is at the ceiling in both arms, so this shows the catch is now grounded in the skill, not
that more is caught. No run in either arm asked for a wider lock. Earlier entries' correctness
skill-load numbers are not comparable. The README table was not re-measured.

## 2026-11-15: pillar runs get the explorer subagent and isolated settings

No run. Pillar prompts, tools and flags changed, so earlier pillar runs are not comparable on
cost, turns or which skills loaded; recall may move too.

- `_contract.md` adds a paragraph telling pillars to hand broad searches to an `explorer` subagent.
- Pillar runs get the `Agent` tool and `--agents` defining `explorer` (Haiku; Read, Grep, Glob).
- Every pillar run adds `--strict-mcp-config`, `--setting-sources user`, `--effort medium`, and
  `--settings` enabling only the rule plugins (`no-mistakes-rules`, `skills`); a `--no-rules` run
  switches every plugin off. `bench-verifier` verifier runs get the same isolation flags and
  settings; the checker gets the rule-plugin settings and the judge gets every plugin off, with the same isolation flags.
- The result event used for findings is now the last one that carries structured output, because a
  run with a subagent can print an early result event.

## 2026-11-15: replacement rule fixtures measured

Commit 87c967e. Reviewer Sonnet 5.5, judge Opus, 3 attempts with skills and 3 with `--no-rules`,
rules pillar, `rules-test-only-whole-module-mock` and `rules-content-only-metrics-on-tx-client`.

- With skills: both caught in 3 of 3 attempts, expected skill loaded in 6 of 6 runs.
- Control: neither caught in 3 of 3 attempts.
- Cost $0.17 a run, about 10 turns.

Both cases discriminate. The other 12 rules fixtures were not re-run in this session.

## 2026-11-15: naming the skills in the prompt on mined cases

Commit 87c967e with a prompt edit made only in a scratch copy: a section at the end of the pillar
prompt naming four skills to load (`skills:typescript-authoring`,
`no-mistakes-rules:typescript-rules`, `skills:test-authoring`, `no-mistakes-rules:testing-rules`).
Reviewer Sonnet 5.5, judge Opus, 3 attempts, no control.

- Design (`vouchington-platform-60`, `-62`, `-67`): 9 of 9 runs loaded both TypeScript skills;
  3 of 9 expected findings caught, all with the skill loaded. About $0.29 a run, 12 to 24 turns.
- Correctness (`vouchington-tooling-154`): 0 of 3 runs loaded any skill; 0 of 6 expected findings
  caught. One case only, so the cause is not separated from the case; `correctness.md` also tells
  the reviewer to load skills "only when relevant".

Named skills are loaded reliably by the design pillar. Not committed.

## 2026-11-15: stronger "load skills" wording on mined cases

Commit 2486bc6 with prompt edits made only in a scratch copy. Reviewer Sonnet 5.5, judge Opus, 3
attempts, no control.

- Adding a "load the rule skills first" bullet to the shared contract: 0 of 9 runs loaded a skill
  (`vouchington-clients-38` rules, `vouchington-platform-60` and `-67` design).
- Adding a "First step: load the rule skills" section to the end of each pillar prompt: design
  loaded a skill in 6 of 9 runs (`vouchington-platform-60`, `-62`, `-67`), and the expected
  `skills:typescript-authoring` in 4 of 9; correctness loaded none in 3 of 3
  (`vouchington-tooling-154`). No case was caught with its expected skill loaded.

Wording alone does not make a Sonnet pillar load skills reliably on a real repository. Neither edit
was committed.

## 2026-11-15: bench reads per-file patches and records cost

No run. The pillar prompt now points at `files.md` and the per-file patches instead of the combined
diff, and raw results record cost, turns and tokens. Runs before this entry are not comparable on
large pull requests.

## 2026-11-15: two rule fixtures replaced

No run. `rules-shared-error-text` and `rules-content-only-not-in-nullable` were caught by the
no-rules control in the fixture run below, so they were replaced with
`rules-test-only-whole-module-mock` and `rules-content-only-metrics-on-tx-client`. The replacements
have not been measured in either arm.

## 2026-11-15: first mined-case run with skill tags

Commit 2486bc6. Reviewer Sonnet 5.5, judge Opus, 3 attempts with skills and 3 with `--no-rules`
(2 for correctness). 14 mined cases were tagged with the shared skill that states their rule.

Expected findings caught per attempt (with skills, then control):

| Pillar      | Case                    | With skills   | Control       |
| ----------- | ----------------------- | ------------- | ------------- |
| design      | vouchington-platform-57 | 1/1, 1/1, 0/1 | 0/1, 0/1, 0/1 |
| design      | vouchington-platform-59 | 1/1, 1/1, 1/1 | 1/1, 1/1, 1/1 |
| design      | vouchington-platform-60 | 1/1, 1/1, 1/1 | 1/1, 1/1, 1/1 |
| design      | vouchington-platform-62 | 0/1, 0/1, 0/1 | 0/1, 0/1, 0/1 |
| design      | vouchington-platform-66 | 0/1, 0/1, 0/1 | 0/1, 0/1, 0/1 |
| design      | vouchington-platform-67 | 0/1, 0/1, 0/1 | 0/1, 0/1, 1/1 |
| rules       | vouchington-clients-38  | 0/1, 0/1, 0/1 | 0/1, 0/1, 0/1 |
| correctness | vouchington-2936        | 0/1, 0/1, 0/1 | 0/1, 0/1      |
| correctness | vouchington-4154        | 0/1, 0/1, 0/1 | 0/1, 0/1      |
| correctness | vouchington-tooling-154 | 1/2, 1/2, 1/2 | 1/2, 0/2      |

- Skills loaded: one run of 30 loaded any skill (`vouchington-clients-38`, attempt 3:
  `no-mistakes-rules:dependency-rules` and `git-rules`, not the expected `skills:dependabot`).
- `vouchington-1077`, `1081`, `1143` (design) and `1077`, `1081`, `1092` (rules) failed in every
  attempt of both arms with `claude exited with 1` after reading the combined diff, at about $3
  each. Cause: the bench prompt told the reviewer to read the whole diff.
- `vouchington-platform-59` and `-60` are ceiling cases: the control catches them every time.
- Loose tag: `vouchington-2936` is tagged `skills:postgres-schema-design`, which says never to use
  advisory locks; the mined claim is about the casing of an advisory-lock key. The other 13 tags
  name the skill whose rules cover the mined claim's topic; none is backed by a quoted sentence.
- A mined case is a full repository snapshot with its own `AGENTS.md` and docs, so `--no-rules`
  removes only the installed skills, not the repository's own rules.

The installed skills did not change what the reviewer caught on real repositories, because it did
not load them. The same prompts loaded the expected skill in 90% of fixture runs.

## 2026-11-15: rule fixtures, plugin skills only

Commit 2d9a96f. Reviewer and judge both Sonnet 5.5 (the judge was not a different model), 3 attempts
with skills, 1 control. Rules pillar, 10 positive and 4 negative fixture cases.

- Recall 100% in all three attempts; false alarms 0 of 4.
- Expected skill loaded in 90% of runs; grounded recall 100%, 89%, 100%.
- Control recall 22%: it caught `rules-shared-error-text` and `rules-content-only-not-in-nullable`.
- Attempt 2 caught `rules-manifest-only-duplicate-utility` without loading `dependency-rules`.

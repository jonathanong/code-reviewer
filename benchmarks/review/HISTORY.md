# Benchmark history

Newest first. Every measured run and every change to what is measured gets an entry.

## 2026-11-24: a third targeted check, `clean-code-newly-reports`; each target in its own call; focus-only cases

- **Target added.** `skills/review/references/targets/clean-code-newly-reports.md`: for a change to
  the logic of an existing check, rule or resolver, find input the base passes that the head
  reports, compare any before and after output in the description, and test that nothing newly
  reports or the description names each kind.
- **Why.** Two reviews approved here were rejected downstream for exactly this
  (`no-mistakes-3973`, `no-mistakes-4024`, pinned in the entry below).
- **Focus step, target in its own call**, Sonnet 5.5, one case per command, same session. Counts
  are attempts answering as expected, pooled over scratch case files holding only this point and
  the runs beside requester points after the split below (the target's call is the same prompt).

  | Case               | Expected            | Committed wording | Without its two examples |
  | ------------------ | ------------------- | ----------------- | ------------------------ |
  | `no-mistakes-3973` | `does_not_hold`     | 9 of 10           | 5 of 9                   |
  | `no-mistakes-4024` | `does_not_hold`     | 3 of 4            | 3 of 3                   |
  | `no-mistakes-4006` | `holds`, no finding | 3 of 3            | 3 of 3                   |
  | `no-mistakes-4008` | `holds`, no finding | 3 of 3            | 3 of 3                   |
  | `no-mistakes-3963` | `holds`, no finding | 4 of 4            | 3 of 3                   |

  The failing `no-mistakes-3973` attempt answered `holds`, naming only the opt-in kinds. The
  failing `no-mistakes-4024` attempt compared against an intermediate head and said the
  description lists the added reports. About $0.20 an attempt.

- **The two examples are the two cases' own mechanisms.** "A name that was unresolved and now
  resolves" is `no-mistakes-3973` and "a value set in one branch that the base took as set
  everywhere" is `no-mistakes-4024`. They were kept because without them `no-mistakes-3973` fell
  to 5 of 9. The score on these two cases
  therefore says little about a rule change with a different mechanism; no such case is pinned.
- **Earlier wordings.** A plain point ("does not report anything on code the base passes beyond
  what the description says") got 1 of 2 on one attempt each (missed 3973). A first target
  wording that led with the description's output got 1 of 2 the other way (missed 4024).
- **A target asked beside requester points was not answered.** `no-mistakes-3973` with its three
  original requester points and this target in one call, three attempts: the target came back
  `not_checked` twice ("I did not trace the resolver changes") and `holds` once; 0 of 3. The
  requester points were answered every time.
- **Each target now gets its own call** (`src/review/run/focus-run.mts`). Requester points share
  one call; each selected target runs in a call of its own, at the same time; the step counts as
  failed only when every call failed. Same case and points, three attempts: 2 of 3 with the
  committed wording and 1 of 3 without the examples (both counted in the table), at $0.35 to
  $0.41 a run against $0.20 for the single call. In one of the six runs a requester point came
  back `not_checked`; the other seventeen requester answers were as expected. A target call that
  fails twice leaves its point `not_checked` with "The step failed twice." in the report's focus
  list; the step is not listed as skipped unless every call failed. A review with requester points and one target now makes two focus calls instead of
  one, about $0.20 more.
- **No control arm for the target itself.** Without it nothing is asked. Both pull requests were
  approved by full reviews (the misses themselves).
- **Committed quiet entry.** `no-mistakes-3963` now carries this target expecting `holds`,
  beside its `untraced-name-passes` entry (`does_not_hold`); one attempt on the committed case:
  2 of 2, two calls, $0.39. It has no `expectNoFindings`, which is graded for the whole case.
- **Selection** (`bench-selection`, Haiku 5.5, three attempts a case): picked 3 of 3 on
  `no-mistakes-3973` and `no-mistakes-4024`; 0 of 3 on `no-mistakes-4006`, `no-mistakes-4008`
  and `vouchington-6282`. It is also picked 3 of 3 on `no-mistakes-3963`, beside
  `untraced-name-passes`: that change adds opt-in reports to an existing rule, and the focus step
  answers `holds` there (table above). `vouchington-6254` had one unwanted pick in 3, of
  `unneeded-concurrency-guard`, not of this target.
- **Focus-only cases.** A case may set `focusOnly: true` (a negative with focus points). No
  pillar run scores it and its expected skills and reads apply to no pillar. Set on
  `no-mistakes-3963-f282a5d`, `no-mistakes-3973`, `no-mistakes-4024` and `no-mistakes-4006`,
  which were negatives only because no pillar finding is recorded. Pillar false-alarm rows that
  included any of them are not comparable with rows from this entry on.
- **Not comparable.** The selection prompt now lists three targets, so target-selection rows
  from before this entry are not comparable. Focus rows for a case with both requester and
  target points are not comparable either: the target is now asked alone. Pillar and verifier
  prompts are unchanged.
- **Not measured.** A whole review with the target, the verifier's handling of its findings, any
  repository other than no-mistakes, a change to a non-lint check (a type checker, a validator),
  and two or more targets beside requester points after the split.

## 2026-11-24: a second targeted check, `untraced-name-passes`

- **Target added.** `skills/review/references/targets/untraced-name-passes.md`: for a change to a
  check that decides by a name in the code it scans, test three shapes (re-exported from a local
  module, built by a call in a local module, the result of calling an imported function) and
  whether each is reported or reported as unresolved. Other shapes do not fail the claim.
- **Why three shapes.** Two earlier wordings asked that no untraced name be treated as clean. On
  the sound fixture they answered `does_not_hold` in 5 of 7 attempts across fixture repairs, each
  time for a deeper real gap (subpath imports, methods on imported objects, local aliases, nested
  members). A claim no check can meet is noise on every lint-rule change, so it was narrowed.
- **Cases.** `no-mistakes-3963` gains a target focus entry (`does_not_hold`).
  `no-mistakes-3963-f282a5d` is the later head of the same pull request, focus-only: the fix
  follows wrapped bindings but still drops a receiver built by an imported factory with no
  traceable argument. That label rests on this session's reading of
  `ast/playwright_bindings.rs`; it was reported to the author's session and is not yet confirmed.
  Its `body` is the description edit in effect when that head was pushed. `focus-target-untraced-reported` in `synthetic.json` is a
  check meant to report all three shapes (`holds`, no finding); its own tests pass.
- **Focus step, committed wording**, Sonnet 5.5, one case per command, same session:
  `no-mistakes-3963` 3 of 3 and `no-mistakes-3963-f282a5d` 3 of 3 (`does_not_hold`).
  The three attempts on the later head ran before its `body` was pinned; one attempt with the
  body was also correct.
  `focus-target-untraced-reported`, three attempts after each of four fixture states: 2 of 3,
  then 3 of 3, 2 of 3 and 2 of 3 on the last three, so 7 of 9 since the wording was committed.
  Every failing attempt named a real gap inside the third shape (`make()()`; a result held by
  `export const`; a result that is awaited, destructured or function-scoped). The first two were
  repaired and the last was left: a hand-written check is rarely complete, so expect this target
  to raise a finding on most real checks and the verifier to weigh it. About $0.20 a mined
  attempt and $0.12 a fixture attempt.
- **A different implementation.** One attempt on `no-mistakes-4006` (not a committed focus entry)
  answered `holds`: that rule falls back to matching the name `test`, so all three shapes report.
- **No control arm.** Without the target nothing is asked, so there is no "before" status. The
  nearest baseline is the correctness pillar on `no-mistakes-3963`: 0 of 1 with skills and 0 of 1
  without (entry below).
- **Selection** (`bench-selection`, Haiku 5.5, three attempts a case): the new target was picked
  3 of 3 on `no-mistakes-3963`, `no-mistakes-3963-f282a5d`, `no-mistakes-4006` and the fixture,
  and 0 of 3 on `no-mistakes-4008`, `vouchington-6282`, `vouchington-6254`,
  `select-target-no-guard` and `focus-target-guard-needed`, each of which lists it under
  `unwantedTargets`. `vouchington-6254` picked the older `unneeded-concurrency-guard` in 2 of 3
  though it only removes locks; not measured before this change, so whether listing a second
  target caused it is unknown.
- **Two more known misses pinned, no target yet.** `no-mistakes-3973` and `no-mistakes-4024`:
  approved here, then rejected downstream because the change made code the base passes newly
  report. Each carries one plain focus point (`does_not_hold` expected). Pilot, one attempt:
  `no-mistakes-4024` correct, `no-mistakes-3973` wrong (`holds`; the description's "after"
  output shows one new `unmatched-producer` line without comment). Not a rate.
- **Not comparable.** The selection prompt now lists two targets, so target-selection rows from
  before this entry are not comparable. Pillar and verifier prompts are unchanged.
- **Not measured.** A whole review with the target, the verifier's handling of its findings, and
  any repository other than no-mistakes.

## 2026-11-24: three known misses from no-mistakes reviews, and a focus rule for multi-part points

- **Cases added** to `cases.json`, each with `body` as the description read at the reviewed head:
  `no-mistakes-4008`, `no-mistakes-3963`, `no-mistakes-4006`. The `expectedSkills` tags on the
  first two (`github-actions-rules`, `static-analysis-checklist`) are loose fits: neither skill
  states the missed rule.
- **Prompt change.** The focus prompt gains one sentence: a point holds only when every part of it
  holds, and when the code does what a point says must not happen the status is `does_not_hold`
  even if a reason for it comes to mind. Every `bench-focus` row before this entry is not
  comparable.
- **Run.** Working tree on de37131, `bench-focus`, Sonnet 5.5, no judge, one case at a time, about
  $2.00 in total.
- **`no-mistakes-4008`** (the push diff base accepted a run that concluded `failure`; point "A
  failed or cancelled previous run is not used as completed in a way that skips the paths of its
  commits", expected `does_not_hold`):
  - Asked alone, before the change: 1 of 1. The live miss did not reproduce.
  - Asked with the other four points of the live run, in the same order, before the change: 1 of 3.
    Both misses noted that cancelled runs are excluded and excused the failed run.
  - Same five points after the change: 3 of 3.
  - Only that point's rate is quoted. The first point (the fallback never narrows the diff) is
    was labelled `holds` from the live answer during these runs; see the label correction below. The target point on this case answered
    `holds`, `does_not_hold` and `not_checked` across the three attempts after the change, and
    `holds` in all three before.
- **Cases the change does not target**, one attempt each after the change: the six synthetic focus
  cases 7 of 7 points, `vouchington-6282` 1 of 1, `vouchington-6254` 1 of 1 with no finding.
- **`no-mistakes-4006`** (a point about a rule another open pull request also adds): 0 of 1,
  `not_checked`, before any change. The step cannot see another pull request.
- **`no-mistakes-4006` with named pull requests** (the entry below; working tree on 190ccdf, the
  other head pinned by `focusRefs`): 3 of 3 `does_not_hold`, each citing files both pull requests
  add, about $0.47. The 0 of 1 before is one attempt, but the step had no way to see the other pull
  request, so it is a structural miss and not a rate.
- **`no-mistakes-3963`**, correctness pillar, Sonnet 5.5, judge Opus 5.5, one attempt per arm: 0 of 1
  with selected skills and 0 of 1 with no rules, no findings in either, about $0.38. The miss
  reproduces and no skill states the rule, so nothing here fixes it yet.
- **`no-mistakes-4006` is a focus-only case.** No shared skill states a rule about duplicate pull
  requests, so it declares no expected pillar finding and is typed `negative` only because a case
  must have a kind. The pull request had other real findings, so it is not a pillar negative; do
  not include it in a pillar run.
- **Side effects of the sentence on a multi-point case where every point holds.** New case
  `no-mistakes-4027` (three requester points, hand-verified and merged, `expectNoFindings`), three
  attempts per arm in the same session: 9 of 9 points `holds` with no finding without the sentence,
  and 9 of 9 with no finding with it.
- **Label corrected after the runs.** On `no-mistakes-4008` the first point (the fallback never
  narrows the diff) now expects `does_not_hold`: with no base the ast-grep step passes
  `origin/main`, which on a push to main is the head, so `check-inline-fixture-writes.py` compares
  the baseline with itself and its shrink-only rule cannot fail. Under the new label that point
  scored 0 of 3 before the sentence and 1 of 3 after. Not re-run.
- **What it showed.** The miss was a multi-point effect, not a single-point one, and one sentence
  moved it from 1 of 3 to 3 of 3 on one case. Three attempts cannot resolve whether the change
  makes the target point on that case less stable.

## 2026-11-24: focus step reads the pull requests a requester point names (no run)

- **Change.** A requester focus point that names another pull request of the same repository
  (`#123`, `PR 123`, `pull request 123`) now adds one computed block per named pull request (the
  first 3) to the focus prompt: its head commit, changed-file count and file list from local git,
  marking paths the reviewed pull request also changes. The focus prompt changes only then; with no
  such point it is byte-identical and no git fetch runs. The verifier, pillar and selection prompts
  are unchanged.
- **Case field.** `focusRefs` (pull request number to a full 40-character commit) pins the other
  head for `bench-focus` so the run is reproducible; `no-mistakes-4006` pins 3963.
- **Overlap marking.** It compares the named pull request with this pull request's own changes since their merge base (not the endpoint diff); the rendered block text for a readable case keeps its form. When this pull request's own diff cannot be read, the shared count and the "Also changed here" cells read unknown, and the sentence says so.
- **Not comparable.** `no-mistakes-4006` (its focus point names 3963; it answered `not_checked`
  before, with "PR 3963 isn't in the checkout"), and any other focus row whose requester point
  matches those patterns, such as `no-mistakes-3963` and `no-mistakes-4008` if their points name a
  pull request. Synthetic focus cases and `vouchington-6282` name none, so their rows still
  compare. No run in this entry; the entry above measures it.

## 2026-11-24: pilot of the `unneeded-concurrency-guard` target

- **Run.** Working tree of the targeted-checks change (the entry below), focus and selection steps
  as a review runs them, Sonnet 5.5 for focus and Haiku 5.5 for selection, no judge, one case at a
  time. Total about $1.40.
- **Focus, `vouchington-6282`** (the guard is unneeded: one ordering key at concurrency 1), expected
  `does_not_hold`:
  - First target framing (the reviewer's own check, with no instruction to doubt the claim) and the
    first point text: 0 of 1. The step answered that overlap is possible and the guard is needed.
    The same point text under the requester framing had scored 1 of 1 twice earlier in the day.
  - Framing changed to say each target ends with a claim to test and try to disprove, and the point
    text changed to name what already serialises callers (ordering key, fixed job id, single
    schedule, unique constraint, existing lock): 2 of 3. The miss cited the ordering key and still
    answered `holds`, on the ground that a stalled job can be redelivered.
- **Selection.** `select-target-concurrency-guard` 3 of 3 selected and `select-target-no-guard`
  0 of 3 selected, on both wordings of `when`. `vouchington-6282` 3 of 3 selected. `vouchington-6254`
  (removes redundant locks; now labelled `unwantedTargets`) selected the target in 3 of 3 with the
  first `when` and 2 of 3 after `when` gained "Not when it only removes, moves or renames an
  existing one."
- **Where the target must stay quiet**, one attempt each, final wording:
  - `focus-target-guard-needed` (new synthetic case: a schedule and a button enqueue the same export
    with no job id or ordering key, at concurrency 4): `holds`, no finding. Pass.
  - `vouchington-6254` (the unwanted selection above): `holds`, no finding. The case first expected
    `not_checked`; the step answered `holds` with the basis "This PR removes locks rather than
    adding a guard". Neither status leaves a trace in a posted review, so the case now expects
    `holds` and grades that no finding is raised. Not re-run after that label change.
- **What it showed.** The target can catch the miss the correctness pillar missed twice, but not
  every time, and its framing decides the answer. On the two cases where it should stay quiet it
  raised no finding, one attempt each, so an unwanted selection has cost one focus call (about
  $0.20) and nothing else. One or three attempts per case is not a rate.

## 2026-11-24 (no run): targeted checks the reviewer raises itself

- **What changed.** Added built-in targeted checks under `skills/review/references/targets/`
  (starting with `unneeded-concurrency-guard.md`) that the reviewer selects and runs through the
  existing `focus` step in `full` reviews (never in `light` or `skip` reviews). When any built-in
  target is enabled, `selectSkills` (`src/review/run/select-skills.mts`) appends a
  `## Targeted checks` section listing each target's `name` and `when` (never its body) and
  switches to `SKILL_AND_TARGET_SELECTION_SCHEMA` (`{ skills: string[], targets: string[] }`), or
  `TARGET_ONLY_SELECTION_SCHEMA` (`{ targets: string[] }`) when `rulePlugins` is `[]` (degrading
  to no targets on failure). Unknown target names are ignored and a missing or malformed `targets`
  field degrades to `[]`. Selected targets run in the `focus` step alongside any requester points
  (requester first, up to 20 points; targets omitted by the cap are recorded in `report.json` as
  `droppedTargets` and in `report.md`) with origin `target:<name>`. Target points get dedicated
  framing as the reviewer's own standing checks in both `focusLines` and `focusVerifierLines`
  (requester-only prompts stay byte-identical), and one sentence in
  `skills/review/references/verifier.md` was updated so focus drop reasons cover both requester and
  target points. Target outcomes are recorded in `review.json` and `report.json`/`report.md` after
  all model steps finish, and omitted from the posted "Requested checks" block. Added repository
  config `targets.disabled` (target names or `"all"`), validated against the same references
  directory used for selection and focus.
- **Benchmark changes.** `bench-focus` now accepts `{ target: "<name>", expectedStatus, reason }`
  in a case's `focus` array, reading the point text verbatim from the target file; added a
  `focus` entry with `target: "unneeded-concurrency-guard"` to `vouchington-6282` in `cases.json`
  (`vouchington-6254` gains `unwantedTargets` and a quiet `focus` entry, see the pilot entry above). `bench-selection` now offers built-in targets and scores
  optional `expectedTargets` and `unwantedTargets` fields; added two synthetic selection fixtures
  to `synthetic.json` (`select-target-concurrency-guard` and `select-target-no-guard`).
- **Comparability.** The selection step's prompt and output schema changed whenever built-in
  targets are enabled, and `skills/review/references/verifier.md` changed one sentence on focus
  findings, so earlier `bench-selection`, `bench-verifier`, and `--select` rows are not comparable
  with runs after this change. Pillar prompts, the requester-only focus prompt, and `bench-context`
  did not change, so earlier `bench` (without `--select`), `bench-context`, and requester-only
  `bench-focus` rows remain comparable. No model calls were made in this change; the new
  `vouchington-6282` focus entry and target selection fixtures have not been measured yet.

## 2026-11-24 (pilot): add `bench-focus` and five synthetic focus cases

Pilot, one attempt per case, Sonnet 5.5, run one case at a time: 6 of 6 points correct across the
five cases ($0.43 in total, about $0.09 a case). The hostile point came back `not_checked` with no
finding. One attempt shows the graders work; it is not a rate. Every case passed, so the suite is a
guard against regressions in the focus step, not a measure of how much the step helps.

- **What changed.** Added `code-reviewer bench-focus` (`src/review/benchmark/focus-cli.mts`,
  `focus-case.mts`, `focus-prepare.mts`, `focus-score.mts`) to benchmark the real requester-focus
  step (`runFocus` with computed `Change facts`) without changing the focus prompt, schema, or
  verifier. Cases in existing case files may declare an optional `focus` array of
  `{ point, expectedStatus, reason, expectNoFindings? }`; `bench-focus` skips cases without
  `focus`, builds a two-commit git checkout for fixture cases so `buildFocusFacts` runs real git
  commands, and grades statuses deterministically (plus zero findings when `expectNoFindings` is
  set) with no judge model.
- **Cases added (`synthetic.json`).** Five synthetic focus cases: `focus-fact-decides`,
  `focus-hostile-point`, `focus-unanswerable`, `focus-plain-holds`, and `focus-plain-fails`.
- **Comparability.** No existing prompt, schema, or case changed; earlier rows are unaffected.
  The five new focus cases were piloted once (above).

## 2026-11-24 (pilot): the race rule on an existing true-race case

After the race rule merged, `vouchington-2936` (a real race, correctness medium) was run once per
arm through the correctness pillar (Sonnet 5.5, Opus judge): 0 of 1 with the rule ($0.14, no
finding, one search for the lock's callers) and 0 of 1 with the prompts from the commit before it
(one medium finding about a blocking advisory lock, not the expected one). The verifier (Opus 5.5,
$0.47), given the with-rule arm's empty findings, dropped nothing and added one medium finding the
judge did not count as the label. One attempt per arm: no evidence the rule lost a true race
finding, and none that it helped. Whether the rule quietens the lock-rule finding the control
reported is not known.

## 2026-11-24 (pilot): a race finding must show the race is reachable

Two one-attempt pilots of `vouchington-6282` on the `correctness` pillar (Sonnet 5.5, Opus judge,
`--select`, $0.18 and $0.16): 0 of 1 both times. Neither run searched for callers, opened
`backend/queues/psql/enqueues/schedules.mts` or `config.mts`, or loaded
`jong-skills:postgres-locking`; each read the diff and two changed files and returned no finding.
The second pilot used the guard sentence as it is committed (find every caller of the guarded code);
the first used a weaker wording. The case stays as a known miss: the prompt alone does not make the
pillar trace how a job is enqueued. No control arm and no three-attempt run were made, so no rate is
quoted. `vouchington-6254` was not run.

- **What changed.** `skills/review/references/pillars/correctness.md` now requires every race
  finding to name both overlapping entry points (file and line each) and explain why they can
  overlap after checking existing serialisation (queue ordering or group key with concurrency 1,
  fixed job id or dedupe key, single schedule, unique constraint, or existing lock); an unreachable
  overlap is not a finding, and for a change that adds a guard against concurrent runs the pillar
  is told to find every caller and report the guard as unneeded when none can overlap.
  `skills/review/references/verifier.md` now drops any race finding that omits both entry points or
  whose overlap the code already serialises. Added two mined cases to `benchmarks/review/cases.json`
  (not yet measured): `vouchington-6282` (positive, correctness: unneeded compare-and-set guard on a
  concurrency-1 cleanup queue; `expectedSkills`: `jong-skills:postgres-locking`, `expectedReads`:
  `backend/queues/psql/enqueues/schedules.mts` and `backend/queues/psql/config.mts`) and
  `vouchington-6254` (negative: removing redundant account cleanup prelocks on the same queue).
- **Comparability.** Correctness-pillar and verifier rows recorded before this change are not
  comparable with runs after it.

## 2026-11-24 (pilot): congruence checks that behavior changes show one real run

Pilot of `congruence-missing-real-run` with `bench-verifier` (Opus 5.5 verifier, Sonnet judge, one
attempt per arm, empty pillar findings): 1 of 1 with this change's prompts, 0 of 1 with the prompts
on `main` (the control returned no finding). $0.26 per run. A first pair of runs on an earlier
fixture gave the same 1 of 1 and 0 of 1, but the control reported a rounding bug the fixture did not
intend (`1m 60s`); the fixture was corrected and both arms were run again. One attempt per arm shows
the grader works and the control misses; it is not a rate.

- **What changed.** `skills/review/references/pillars/congruence.md` gains a "One real run" section
  telling the verifier, when a change alters behavior a user or caller can see, to load
  `jong-skills:pr-description`, apply its "Show one real run" rule, and raise one `low` finding
  (never blocking) when the description does not show one realistic input, command or call, and real
  output. Docs-only, test-only, CI-only, dependency bumps, pure refactors with no behavior change,
  and descriptions that already show a run are excluded.
- **Cases added (`synthetic.json`).** `congruence-missing-real-run` (positive, `expectedSkills`:
  `jong-skills:pr-description`, expected one `low` congruence finding): a small behavior change in
  `src/format-duration.mts` whose description is a checklist with no input or output.
- **Comparability.** The congruence pillar prompt changed, so congruence rows (and verifier rows
  that score congruence) before this entry are not comparable with runs after it.

## 2026-11-24 (no run): verifier sees focus outcomes and dropped focus points show the drop reason

Not measured; no model was called.

- **What changed.** `skills/review/references/verifier.md` now instructs the verifier that a finding
  raised for a focus point answers a question the requester asked and, when dropping it, to give a
  one-sentence reason because the reason is shown to the requester. When `--focus` is supplied, the
  verifier prompt now includes a `## Requested focus checks` block listing each focus point's text,
  outcome, basis, and the candidate finding indexes from the `focus` step; without `--focus`, the
  verifier prompt and schema are unchanged. When no kept `focus` finding backs a `does_not_hold`
  point, `keptFocus` still turns the point into `not_checked` with "Raised, but the verifier kept no
  finding: ..." and now appends `Reason dropped: <reason>` when the verifier gave one in `dropped`
  (adding no question and leaving verdict and hold behaviour unchanged).
- **Comparability.** Verifier runs on reviews with `--focus` before this change are not comparable
  with runs after it; `verifier.md` also changed for all runs, so verifier rows before this change
  are not comparable. Without `--focus`, no prompt block or schema field is added.

## 2026-11-24 (no run): deterministic change facts in the focus step prompt

Not measured; no model was called.

- **What changed.** The `focus` step prompt now includes a mechanically computed `## Change facts`
  block (pull request title and description lengths in code points, changed file count, and a table
  of up to 200 changed files with status, added/removed lines or `binary`, total line count at head,
  and YAML frontmatter `description:` character length when present), computed from local git and
  `context.json` with no model or GitHub API call. The prompt instructs the step that the block is
  computed rather than estimated and that any point the facts decide must be answered `holds` or
  `does_not_hold` from them, citing the fact.
- **Comparability.** Focus-step runs before this change are not comparable with runs after it. No
  pillar, verifier, approval check, or non-focus prompt or schema changed, so existing benchmark
  rows are unaffected (`bench` does not run the focus step).

## 2026-11-23 (no run): the review summary is never in the first person

Not measured; no model was called.

- **What changed.** The verifier's output example in `skills/review/references/verifier.md` now says
  the summary is about the change and never in the first person. Summaries of light reviews had
  ended "I found no issues" or "I found nothing to flag".
- **Comparability.** The verifier prompt changed, so rows that score the verifier's output are not
  comparable with earlier entries. No finding, severity or verdict rule changed.

## 2026-11-23 (no run): a review request's focus points are checked by their own step

Not measured; no model was called.

- **What changed.** `run --focus FILE` (and `review --focus FILE`) adds one step, `focus`, beside the
  pillars. It has its own prompt and its own output schema (`points` by index with a status, a
  basis, `path` and `line`, plus the normal pillar findings; a `holds` or `does_not_hold` must cite a `path`, and after the verifier a `does_not_hold` stands only if a kept `focus` finding has the same path, else it is `not_checked` with the basis "Raised, but the verifier kept no finding: ...", keeping path and line; statuses are defined by outcome, `holds` = checked and nothing wrong, `does_not_hold` = a problem worth a finding, so a point phrased as a question fits; the posted labels are ok, problem, not checked); the pillar output schema is not
  loosened. Its findings are tagged with the reserved pillar name `focus`, join the other pillars'
  findings and are verified like them. The `review.json` contract gains an optional `focus` array,
  rendered as one collapsed block in the posted body. `focus` is a new model step on the `pillars`
  tier, and `focus` is a reserved name for a configured pillar.
- **Comparability.** No existing row is affected. Without `--focus` no step is added and no prompt
  or schema changes: the pillar, verifier and approval check prompts and schemas are what they were
  (`fixtures/step-argv.json`, which pins the argv and schema of the pillar, verifier and approval check steps, did not change, and `review-focus.test.mts` runs a review with and without points and compares the prompts). With points,
  the verifier's output schema also allows `focus` as a finding's pillar. `bench` does not run the
  step, so no benchmark row measures it yet.

## 2026-11-23 (no run): an answer's rule quote is optional and the skill is linked

Not measured; no model was called.

- **What changed.** The verifier's answers block and its output schema now take
  `rule: { skill, quote? }`: the quote is optional, and the prompt says the body may paraphrase the
  rule and that a quote, when given, must be copied exactly. A quote that is not in the skill, or is
  too short, no longer drops the answer: it is removed and the answer is kept with its skill. An
  unlisted skill still drops it. The posted reply links the skill. `bench-verifier` still grades on
  the cited skill.
- **Comparability.** The `answers.json` rows recorded earlier on 2026-11-23 (three attempts per
  arm, Sonnet as the verifier) used the old prompt and schema, which required a quote and dropped an
  answer whose quote failed. They are not comparable with runs after this change.

## 2026-11-23: the answer cases, three attempts per arm with Sonnet as the verifier

Commit 3effb46. Verifier `claude-sonnet-5-5`, judge Sonnet, checker Opus, three attempts per
arm, one run at a time, twelve runs, $1.11 for the verifier.

| Case                       | With rules | Without rules | Cost per run, with / without |
| -------------------------- | ---------- | ------------- | ---------------------------- |
| `answers-like-row-lock`    | 3 of 3     | 0 of 3        | $0.12 / $0.07                |
| `answers-floating-promise` | 3 of 3     | 3 of 3        | $0.11 / $0.07                |

- **`answers-like-row-lock` separates the arms on the citation only.** Without rules all three
  attempts still answered the note, with the same reasoning (append-only votes, the latest row
  wins) and a code location in place of a rule; the production checks kept those answers. The
  case expects the answer to cite `jong-skills:postgres-locking`, so they fail. The rule skill
  supplies the citation, not the judgment.
- **`answers-floating-promise` is a ceiling case.** Both arms left the valid note alone and raised
  the defect as a correctness finding at `high` in every attempt. It is kept as the check that a
  valid note is not answered.
- **Sonnet is enough for this step on these two cases.** Three of three on both, at about 40% of
  the Opus cost of the first pilot. Three attempts cannot resolve a failure rate under about one
  in three, and two synthetic cases say nothing about a long or ambiguous thread.
- Supersedes the one-attempt pilots below for these cases.

## 2026-11-23 (pilot): the answer cases without rules, and with Sonnet as the verifier

Commit 2de09da. Judge Sonnet, checker Opus, one attempt per case, one case per run. A pilot; one
attempt is not a score.

| Case                       | Verifier            | Rules | Thread handled as expected | Cost  |
| -------------------------- | ------------------- | ----- | -------------------------- | ----- |
| `answers-like-row-lock`    | `claude-opus-5-5`   | none  | 0 of 1                     | $0.25 |
| `answers-like-row-lock`    | `claude-sonnet-5-5` | yes   | 1 of 1 (answered)          | $0.14 |
| `answers-floating-promise` | `claude-sonnet-5-5` | yes   | 1 of 1 (left alone)        | $0.11 |

- **Without rules the verifier still judged the lock note invalid.** Its summary says no lock is
  needed, and it returned an answer; the production check dropped the answer because no rule skill
  was loaded to quote. The control fails on the citation, not on the judgment, so the case shows
  that a reply needs a quotable rule, not that the skill changes what the model concludes.
- **Sonnet handled both threads** at about half the Opus cost of the earlier pilot ($0.32 and
  $0.28). Its lock answer quoted a whole sentence of `jong-skills:postgres-locking` and passed the
  production checks with no warning; on the second case it left the thread alone and raised the
  defect as its own correctness finding at the expected severity.
- Not run: three attempts per arm, and the no-rules control for `answers-floating-promise`.

## 2026-11-23 (no run): the posted finding head carries the pillar

Not measured; no model was called.

- **What changed.** A posted finding is headed `**[medium · design]** Title`, where it was
  `**[medium]** Title` then a `<sub>design</sub>` line; a finding in the review body is the same in
  its `<summary>`. Readers of earlier posted comments accept both forms.
- **Comparable.** Every earlier row. The benchmarks never read or write the posted head: no
  prompt, schema or fixture contains it, so no row is made non-comparable.

## 2026-11-23 (pilot): the two answer cases, one attempt each

Commit dd3cf0c. Verifier `claude-opus-5-5` with skills, judge Sonnet, checker Opus, one attempt per
case, one case per run. Cost $0.32 and $0.28. A pilot checks the graders; it is not a score.

| Case                       | Thread handled as expected | Verifier's own finding  |
| -------------------------- | -------------------------- | ----------------------- |
| `answers-like-row-lock`    | 1 of 1 (answered)          | none expected, none     |
| `answers-floating-promise` | 1 of 1 (left alone)        | 1 of 1, severity agrees |

- `answers-like-row-lock`: the answer cited `jong-skills:postgres-locking`, quoted a whole sentence
  of the skill, and passed the production checks with no warning. Read by hand: the reply names the
  alternative (the latest row per voter wins) and does not restate the note.
- `answers-floating-promise`: no answer was returned, and the defect came back as the verifier's
  own correctness finding.
- Not run: the no-rules control, a cheaper verifier model, and three attempts per arm. Until the
  control runs, neither case is known to need the rule skill.

## 2026-11-23 (no run): the verifier reads every kind of note from other reviewers

Not measured; no model was called.

- **What changed.** The "Other reviewers and comments" list in the verifier's `context.md` now
  labels each note by kind (`thread`, `review summary`, `issue comment`) and `bot`, leaves out
  notes from this reviewer's own GitHub App (a bot author that is the posting identity; under a
  person's `gh` login only the marker check applies) and minimized notes, and adds a `[N more not shown]` line
  when the 40-note cap cut older ones. The line format changed from
  `- **author** where: text` to `- **author** [kind] where: text`. With no notes the prompt is
  byte-identical to before. `verifier.md` is unchanged.
- **Comparability.** Only `lock-scope-race-response` carries a `context.md`, and fixtures are
  copied verbatim rather than rendered, so no existing row changes; that file still uses the old
  line format and is deliberately not rewritten, so as to keep its rows comparable. A real review
  of a pull request with other reviewers' notes is not comparable with earlier ones.

## 2026-11-23 (no run): `bench-verifier` grades the verifier's answers

Not measured; no model was called.

- **What changed.** A case may list `answerable` notes, each with `expect: "answer"` and the
  `plugin:skill` its reply must cite, or `expect: "leave"`. The verifier prompt and schema then
  carry the production answers block (`answerLines`, `withAnswers`) and the run reads its
  transcript for the skills it loaded. The answers go through `checkedAnswers` against the
  installed rule skills of the default rule plugins, and each note is graded by code: an `answer`
  note passes when a checked answer for it cites the expected skill, a `leave` note when none
  survives. `summary.md` adds one line, "Answers to other reviewers' notes: x of y", only when a
  case listed notes. A case with `answerable` and no pillar findings is verified alone, as a
  `congruence` case is.
- **Comparable.** Every earlier `bench-verifier` row. A case without the field builds a
  byte-identical prompt, schema and request, and its saved-output key is unchanged.
- **New cases, unmeasured.** `answers-like-row-lock` and `answers-floating-promise`, in
  `answers.json`, which the pillar benches do not run, so no pillar row changes. The third
  scenario, a thread the reviewer already replied in, is covered by a unit test of
  `answerableThreads` because a case lists notes after that filter.
- Piloting: one attempt each, then read the answer, its quote and the findings by hand before
  quoting a number.

## 2026-11-23 (no run): the verifier may answer other reviewers' open notes

Not measured; no model was called.

- **What changed.** With the machine-only `answers` setting on and a non-empty `answerable` list in
  `context.json`, the verifier prompt gets one more block and its output schema an optional
  `answers` field; each listed note carries `omitted`, the count of later comments left out of its
  replies, when there are any; code checks (a quoted rule must be a whole sentence or list item of
  the skill) and `post` posts the replies once the review is confirmed. `verifier.md` is unchanged.
  `context.md`'s "Other reviewers" section now shows later comments of a thread.
- **With the setting off or an empty list** the verifier prompt and schema are byte-identical to
  before. `bench-verifier` and `bench` build prompts without the block, so their rows are
  comparable with the entry below. A real review with the setting on and a listed note is not
  comparable with earlier ones.
- **Not covered.** `bench-verifier` cannot grade an `answers` entry yet.
- `bench-context` rows that render the "Other reviewers" section change only for a thread with
  more than one comment.

## 2026-11-23: the verifier is given document lines that mention what changed

Commit of this entry. Verifier alone on `vouchington-6166-f684113f` (`bench-verifier`, empty
`--findings-from`, labels judged by Haiku), one run at a time in one session. About $3.2 in all.

- **What changed.** `prepare` and the benchmark snapshot now search the tree's Markdown files for
  the names of the changed source files (one `git grep`, no model call) and write the matching
  lines to `docs.md`. The verifier prompt gets them as a section, grouped by name with the
  changed files each name came from. `congruence.md` gains one scope bullet for documentation
  the change leaves stale.
- **Not comparable.** Every `bench-verifier` row: the verifier reads `congruence.md`, which has a
  new bullet, and a case whose snapshot has a matching document line also gets the list. Pillar
  rows are unaffected; pillars get neither.
- **Scores,** the expected finding being `DYNAMIC-RENDERING.md:77`, which the change makes false.
  The control is the entry of 2026-11-22 below (0 of 3 for each model, old prompt, a day
  earlier), so the gain is from the bullet and the list together, not measured apart.

  | Arm                                                       | Verifier | Caught | Cost per attempt |
  | --------------------------------------------------------- | -------- | ------ | ---------------- |
  | List in a file the congruence bullet points at            | Sonnet   | 0 of 3 | $0.11 to $0.14   |
  | List in the prompt                                        | Sonnet   | 0 of 3 | $0.12 to $0.14   |
  | List in the prompt                                        | Opus     | 1 of 1 | $0.47            |
  | List in the prompt, "open the patch, do not decide alone" | Sonnet   | 1 of 3 | $0.12 to $0.15   |
  | Shipped: as above, changed files named per search name    | Sonnet   | 3 of 3 | $0.14            |
  | Shipped                                                   | Opus     | 2 of 2 | $0.36, $0.37     |

  The first arm took 4 to 5 turns an attempt; whether an attempt read the file was not checked.
  In the second, each summary said the listed lines
  still held, in 4 to 7 turns, without opening a patch. The shipped arm also dropped names taken
  from data and generated files (10 of the 16 lines were links to one JSON file) and from tests.
  No attempt in any arm raised a finding on another listed line.
  "Caught" is read from the findings, not graded: the grader scores pillar findings and
  recorded nothing for these. Each counted finding names `DYNAMIC-RENDERING.md` and the false
  statement. One Opus attempt of the shipped arm anchored it on the changed component
  (`topic-follow-context.tsx:17`) instead of the document line.

- **False alarms.** Sonnet, shipped prompt, 1 attempt each on three clean mined cases, with an
  empty pillar result: `vouchington-6166-1984d2d9` (the later head of the same pull request,
  where line 77 is fixed and four other lines are listed), `vouchington-6087-fa05c982` (eight
  lines, all from generated schema pages) and `vouchington-6110-a9458830` (no line found, so only the new bullet differed). No findings in any;
  $0.13 to $0.17 each. Pages under a `generated` directory were excluded after this run and not
  re-measured.
- **Not measured.** A full pipeline run; a case where the stale document does not name a changed
  file (the search cannot find it); a rate on clean cases (one attempt each); the three
  expectations of this case that belong to pillars.

## 2026-11-23: correction to the entry below; a verifier model comparison that had no input

On `4c1a34f`, no change to cases, prompts or graders.

- **Correction.** The entry below says each attempt with the added bullet took "the same" turns
  and output as without it, "so the verifier did not search", and that the raw results do not
  record which files an attempt read. None of that was checked. The turn count of the attempts
  without the bullet was not read, and the raw results were deleted without looking for a list
  of reads. What was recorded: without the bullet, 500 to 760 output tokens and 32k to 63k
  cached tokens per Sonnet attempt; with it, about 530 and 32k, in 4 turns. The 0 of 3 stands.
  Why the verifier misses the finding is not known.
- **Scope of that result.** It covers one mined case and one kind of work: raising a congruence
  finding with no pillar findings to verify. It says nothing about whether a Sonnet verifier can
  verify, merge and rate real pillar findings.
- **Abandoned run: Sonnet against Opus on that main work.** `bench-verifier` needs pillar
  findings as input. Sonnet pillar runs to produce them, 1 attempt each with `--select`, judged
  by Opus, returned no findings on either mined case tried:

  | Case                        | Pillar       | Expected for the pillar | Findings | Cost  |
  | --------------------------- | ------------ | ----------------------- | -------- | ----- |
  | `vouchington-6166-f684113f` | blast-radius | 1                       | 0        | $0.12 |
  | `vouchington-6166-f684113f` | design       | 1                       | 0        | $0.12 |
  | `vouchington-6076-4072f2f4` | correctness  | 5                       | 0        | $0.24 |

  No verifier ran. To compare verifier models, give both arms the same fixed input that holds
  real and wrong findings, for example the saved with-skills findings of a full run, instead of
  a fresh pillar run on one case.

## 2026-11-22: verifier model on a mined congruence case; two miss fixtures piloted and not kept

On `e5b54e7`, no change to cases, prompts or graders. Runs were made one at a time in one session.

- **Verifier model on `vouchington-6166-f684113f`.** `bench-verifier` with an empty
  `--findings-from`, so the verifier is graded only on the `congruence` expectation (a requirements
  document, not in the diff, that the change contradicts). 3 attempts per arm, labels judged by
  Haiku for both arms.

  | Verifier   | Raised the expected finding | Findings raised | Cost per attempt    |
  | ---------- | --------------------------- | --------------- | ------------------- |
  | Opus 5.5   | 0 of 3                      | 0, 0, 0         | $0.37, $0.46, $0.43 |
  | Sonnet 5.5 | 0 of 3                      | 0, 0, 0         | $0.11, $0.12, $0.11 |

  Neither model raised anything, so the judge had nothing to label. The run does not separate
  the models. Opus read about four times as much (142k to 193k cached tokens against 32k to 63k)
  and reached the same answer. A likely cause, not confirmed: `congruence.md` compares the
  description with the code and does not ask for documents elsewhere in the repository that
  describe the changed behavior. The raw results do not record which files an attempt read.

- **A scope bullet for documents outside the diff, tried and not shipped.** A `--prompts` copy of
  `congruence.md` with one added bullet: documents in the repository that state the behavior the
  change alters, search for the names of what changed, and a line the change makes false is a
  finding. Sonnet verifier, 3 attempts, same session and case as the table above: 0 of 3, no
  findings, $0.11 each. Each attempt took 4 turns and about 530 output tokens, the same as
  without the bullet, so the verifier did not search. A bullet in the pillar file does not make a
  verifier with nothing to verify go and read the repository. No other wording was tried.

- **Two fixtures for misses of a full pipeline run, piloted and not kept.** A full run on a private
  pull request (16 files) raised 1 of the 4 findings a hand read raised. Two of the misses were
  rebuilt as small synthetic fixtures, 1 attempt each, Sonnet, judged by Opus:

  | Fixture (not committed)                                                      | Pillar       | Result | Cost  |
  | ---------------------------------------------------------------------------- | ------------ | ------ | ----- |
  | A dry run probes the version of a tool whose install it only printed         | correctness  | caught | $0.13 |
  | An install policy that can refuse a release, and a launcher with no fallback | blast-radius | caught | $0.12 |

  Both were caught on the first attempt, with a lower severity than labeled. The rule for fixtures
  is to keep one only if the reviewer misses it, so neither was added. What this shows: the
  pillars can find both defects when the change is two or three files, and missed them inside a
  16-file change. That agrees with the one-file-of-the-diff pilot below. A fixture that
  reproduces the miss has to reproduce the size, not only the defect.

## 2026-11-22: two congruence cases for a test-only claim; pilot shows a ceiling

Pilot, 1 attempt per arm, so no rate is quoted. On `801dc86` plus this change. `bench-verifier` on
the two new cases, with `--findings-from` a `security` pillar run (Sonnet, $0.10) that found
nothing. Arms: the current `congruence.md`, and a `--prompts` copy holding the file as it was
before the scope bullet of the entry below.

- **Cases added (`synthetic.json`):** `congruence-test-only-edits-source` (positive: title and
  description say test-only, one line of `src/backoff.mts` changes behavior) and
  `congruence-test-only-with-helper` (negative: the same claim, and the only file outside a test
  file is a test helper the description names).
- **Runner:** `bench-verifier` now gives a case that expects a `congruence` finding an empty
  input when no pillar result exists. No pillar can run such a case, and before this it was
  skipped. A negative still needs a pillar result.

| Verifier model | Judge  | With the bullet        | Before the bullet      | Cost per case  |
| -------------- | ------ | ---------------------- | ---------------------- | -------------- |
| Opus 5.5       | Sonnet | caught, negative clean | caught, negative clean | $0.26 to $0.30 |
| Sonnet 5.5     | Opus   | caught, negative clean | caught, negative clean | $0.11 to $0.13 |
| Haiku 5.5      | Opus   | caught, negative clean | caught, negative clean | $0.01          |

- **What it showed:** the positive is a ceiling case. The text before the bullet ("nothing
  significant is unstated") already catches it on every model, so the case shows the bullet does
  no harm, not that it helps. Every arm rated it `medium` on `src/backoff.mts`.
- **Not shown:** a rate (one attempt), and anything about a real pull request. Haiku passing two
  small fixtures says nothing about the verifier's other work (verifying, merging, summarizing).
- **After the pilot:** the fixture files were run through the formatter (quote style and line
  wrapping only).
- **Owed:** a case the text before the bullet misses, if one exists; otherwise the bullet is
  a statement of what the verifier already does.

## 2026-11-22: congruence checks what the change says it is limited to (no run)

No run; nothing measured. `skills/review/references/pillars/congruence.md` gets one scope bullet:
a title or description that limits the change (test-only, docs-only, a refactor, no behavior
change) must be borne out by the changed files and the diff. The verifier performs this pillar,
and its prompt and schema are unchanged.

- **Not comparable:** the stored `bench-verifier` rows, already stale for the two entries below.
- **No case:** no stored case has a title that the files contradict. One is owed before a rate is
  quoted for this bullet. (Two were added in the entry above.)

## 2026-11-22: the impact block reads linked definitions and ignores ones the change edits (no run)

No run; nothing measured. The Impact block of a full review's verifier prompt now tells the
verifier to read the root `AGENTS.md` and any document it points to for the words breaking,
architectural and maintenance, and not to count a definition the pull request itself adds or
changes. Before, it named only an `AGENTS.md` "present in the review context". The schema is
unchanged.

- **Not comparable:** the same stored `bench-verifier` rows as the entry below; no new rows.

## 2026-11-22: the verifier judges the change's impact (no run)

No run; nothing measured. A full review's verifier prompt gets an Impact block, its output schema
an optional `impact` object (`kind`: breaking, architectural, maintenance or unsure, and a
one-line `basis`), and `skills/review/references/verifier.md` a step pointing at that block. A
light review's prompt and schema are unchanged. The class line the review header shows combines
the impact with a scope computed from the pull request's file paths; the scope involves no model.

- **Not comparable:** every stored verifier row, that is, the `bench-verifier` rows in
  `README.md` (3 attempts each on the fixtures and the 8 mined cases). `bench-verifier` loads
  `verifier.md`, which has a new step, and the production verifier prompt and schema it stands
  for have changed. Those rows were already stale for earlier changes below.
- **Not affected:** the pillar rows, the skill-selection rows and the context checks, which do
  not read the verifier prompt or schema. The benchmark's own verifier schema
  (`VERIFIER_OUTPUT_SCHEMA`) did not change.

## 2026-11-22: pilot, blast radius looks for neighbors in the repository; nothing kept

One attempt per arm, commit 5967b5a, nothing in the tree changed. Six sites the review missed
(#6055 finalize, #6059 aliases and link, #6076 flags, #4154 index, #6050 seed) and three clean
sites, each as a whole-diff blast-radius case. Every stop rule was written before its run. $4.05
without the judge.

**Arm 1: one Scope bullet.** Blast-radius pillar, Sonnet, `--select`, Opus judge. The added bullet
asked for code the change does not touch that runs against the same thing (other writers of the
same rows, other callers, tests sharing a row, queries an index serves).

| Arm             | Judged of 6 | Clean sites with a finding | Cost  |
| --------------- | ----------- | -------------------------- | ----- |
| Prompts on main | 0           | 0 of 3                     | $1.33 |
| With the bullet | 0           | 0 of 3                     | $1.54 |

The bullet raised reads on most cases and matched nothing. No further wording was tried.

**Arm 2: one agent per table.** A script listed, for each table named in the patch of a changed
source file, the unchanged non-test files that write or row-lock it (`git grep` at the head), at
most 8 tables per pull request and 12 files per table, nearest path first. One agent per table got
the changed files, that list, and a request to show a broken interleaving with both statements.
36 tables over five pull requests; #6087 had none.

- **What the list held:** the known counterpart file for 2 of the 6 sites (#6076 flags, #6055
  finalize). The 12-file cap dropped it for both #6059 sites (`topics` has 44 other writers). The
  counterpart of #4154 is a reader and of #6050 a test, which the script does not list.
- **Haiku, 36 agents, $0.85:** neither of the 2 sites with the counterpart listed was found. 10
  findings matched no expected finding. Two of them were on the #6059 lines with the expected fix
  (restore the topic lock) and another consequence, and one of those named its neighbor in the
  wrong directory. The other eight were not verified.
- **Sonnet, the 2 agents with the counterpart listed, $0.24:** no finding from either.

What it showed: handing a cheap agent the right two files did not produce these findings, so the
list is not what is missing. `no-mistakes` 0.109.85 has no query from a table to the statements
that write it; its caller queries were not tried, since none of the six misses is a caller. I
judged arm 2 by reading, without a judge model. One attempt, so these are not rates.

## 2026-11-22: a review reads the description up to 24,000 characters, not 4,000

No run. `review` cut the pull request description at 4,000 characters before writing `context.md`.
`bench` never cut it: a case `body` goes to `.review/pr.md` whole. So the benchmark rows were
measured on descriptions a real review did not fully see. 34 of the 51 heads in `revisions.json`
have a description over 4,000 characters; the longest is 20,174. The part a cut removes is the
end, where these descriptions put their evidence and what they could not prove.

The cut is now 24,000 characters (`BODY_CHARS` in `src/review/context.mts`). No benchmark row
changes, since `bench` does not use it. A review of a pull request whose description was over
4,000 characters now reads more than it did.

## 2026-11-22: pilot, a Haiku planning step that writes the questions

One attempt per arm, commit b530360, nothing in the tree changed. It follows the entry below, where
the questions were written by hand. Total $6.69 without the judge: planner $0.24, pillar runs $6.45.

The planner ran as `claude -p --model haiku` in the snapshot tree of each head, with this prompt:

> You plan a code review. You do not review.
>
> Read `.review/pr.md`, `.review/files.md` and every patch under `.review/diff/`. You may open files
> in this tree to see what a changed line belongs to.
>
> Pick the changes in this pull request that most need one reviewer to check the rest of the
> codebase against them. A change qualifies when its correctness depends on code outside the hunk:
>
> - it removes or weakens something other code may have relied on;
> - it adds or changes something that must agree with code elsewhere;
> - it adds code that writes state other code also reads or writes.
>
> Skip renames, formatting, comments, generated files, and changes whose effect is contained in the
> hunk.
>
> Give at most 8 targets, the most consequential first. Fewer is better; give none when nothing
> qualifies. One target is one change at one place; do not merge several files into one target.
>
> For each target give `path`, `line` (at the head; for a pure removal, where the removed code was)
> and `change`: one clause that completes the sentence "At path:line it ...". State only what the
> diff shows the code now does or no longer does. Do not say whether it is right, what might go
> wrong, or what rule applies.
>
> Reply with only a JSON array of objects with those three keys.

Targets per head, and whether a target named the path of each expected finding of the entry below:

| Head                        | Targets | Expected site covered                         |
| --------------------------- | ------- | --------------------------------------------- |
| `vouchington-6055-2b300006` | 6       | `6055-finalize` yes, 2nd                      |
| `vouchington-6059-99da41a9` | 8       | `6059-aliases` yes, 3rd; `6059-link` yes, 5th |
| `vouchington-6076-578223cb` | 8       | `6076-flags` yes, 7th                         |
| `vouchington-4154`          | 8       | `4154-index` no                               |
| `vouchington-6050-02ad62d4` | 8       | `6050-seed` no                                |
| `vouchington-6087-fa05c982` | 7       | none expected                                 |
| `vouchington-6076-e7b25fb9` | 8       | none expected                                 |

Pillar runs, correctness with its own prompt, Sonnet at `high`, judge Opus, `--select`, on
`vouchington-6059-99da41a9` (two expected correctness findings) and the clean
`vouchington-6087-fa05c982`, with the planner's targets in the planner's wording:

| Arm                                                          | Runs | Matched | Findings | Cost  |
| ------------------------------------------------------------ | ---- | ------- | -------- | ----- |
| `6059`, whole diff, no question                              | 1    | 0 of 2  | 0        | $0.36 |
| `6059`, whole diff, all 8 targets in one block               | 1    | 0 of 2  | 0        | $0.61 |
| `6087`, whole diff, all 7 targets in one block               | 1    | none    | 0        | $0.29 |
| `6059`, one run per target, that target's file, the template | 8    | 0 of 2  | 4        | $2.82 |
| `6087`, one run per target, that target's file, the template | 7    | none    | 2        | $2.35 |

The one-block arms appended a numbered list of the targets to the description under "In addition to
your normal review, check each of these changes", ending with the template's last two sentences.
The per-target arms used the template of the entry below unchanged.

What this shows, on one attempt per arm, which is not a rate:

- End to end, the planner's targets matched neither expected finding on `6059`, in one block or one
  run per target. The hand-written questions of the entry below matched both in arm D. The two
  runs on `aliases.mts` and `link-topic-alias.mts` here each raised only the low wrong-409 finding
  that arm D also raised beside its match. So arm D's matches did not repeat with a second wording
  of the same change.
- The two runs that matched in arm D each opened `backend/services/topics/update.mts`, the other
  writer of the topic row that the expected finding names. Neither planner-worded run opened it.
  The two wordings of the `link-topic-alias.mts` change say nearly the same thing (below), so the
  wording does not obviously explain that, and one attempt cannot tell it from chance.
- `high` effort alone did not find them either (whole diff, no question, no finding).
- The planner filled or nearly filled its cap on every head, the clean ones included, so one run per
  target cost $2.82 and $2.35 a pull request against $0.22 for the single run of the entry below.
- The extra findings were few: 6 over 15 runs, 2 of them medium (the accepted duplicate send on
  `6087`, and a missing test on `merge-reference-conflict-pages.mts`).
- The planner named neither site that is not a removed lock (`4154-index`, `6050-seed`).

The planner's `change` text for the two `6059` sites, to read beside the hand-written text of the
entry below:

- `backend/services/topics/aliases.mts:38`: "inserts alias rows from the live, unmerged destination
  topic and returns each row's prior topic_id as previous_topic_id, with no FOR UPDATE on the topic
  or existing alias rows taken beforehand"
- `backend/services/topics/link-topic-alias.mts:23`: "reads the destination topic and the alias row
  without FOR UPDATE, and the later UPDATE carries the destination-is-live-and-unmerged check"

Of the 15 targets on these two heads, 7 of the 8 on `6059` and 2 of the 7 on `6087` describe a
removed lock or its removed key helper. The planner named every removed-lock site of the entry below and neither other site,
so on these heads it behaves as a lock reviewer.

For scale, the 2026-11-22 lock pilot further down measured Opus at `medium` at $0.80 a run, so one
Sonnet `high` run per target costs more than three Opus runs on these pull requests.

Not built. No planner, target or question exists in the review.

## 2026-11-22: pilot, `correctness` given one question about one change

One attempt per arm, commit b48cebe, correctness pillar with its own prompt, Sonnet, judge Opus,
`--select`. 33 pillar runs, $8.47 without the judge. Nothing in the tree changed. The question was
appended to the pull request description of a scratch copy of each case, which is not committed.

The question is one fixed template. Only the change statement varies. It was written by hand from
the diff and holds no rule text, so the run is an upper bound on what a planning step could write:

> ## Your assignment (from the review tooling, not the author)
>
> Review one change in this pull request. At `<path>:<line>` it `<change>`. Other reviewers take
> the other changes; do not report on them. Find every other place in the tree that reads, writes,
> runs against or depends on what this change touches. For each, say whether it still behaves
> correctly together with this change at the head.

Sites with an expected finding. Each scratch case kept the one expectation at that path:

| Site            | Case                        | `<path>:<line>` (path shortened)        | `<change>`                                                                                                                                                                |
| --------------- | --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6055-finalize` | `vouchington-6055-2b300006` | `process-verification-finalize.mts:87`  | reads the existing provider lineage row without the `FOR UPDATE` it had, and re-reads the row when the bind `UPDATE` changes no row                                       |
| `6059-aliases`  | `vouchington-6059-99da41a9` | `topics/aliases.mts:27`                 | creates aliases without first locking the topic row or the existing alias rows: the `FOR UPDATE` reads and the `lockExistingTopicAliasPublicationScopes` call are removed |
| `6059-link`     | `vouchington-6059-99da41a9` | `link-topic-alias.mts:22`               | reads the topic row and the alias row without the `FOR UPDATE` each had, and moves the previous-topic read and a destination check into the `UPDATE`                      |
| `6076-flags`    | `vouchington-6076-578223cb` | `cleanup-vote-integrity-details.mts:72` | clears flag details by id list directly: the `FOR UPDATE SKIP LOCKED` selection of the flags and the `FOR UPDATE` on the cleanup cursor are removed                       |
| `4154-index`    | `vouchington-4154`          | `0060-00-00-topics-taxonomy.sql:832`    | adds a partial index on `topic_aliases (unlink_topic_id)` where `unlink_topic_id IS NOT NULL`                                                                             |
| `6050-seed`     | `vouchington-6050-02ad62d4` | `deleted-user-ballots.mts:94`           | adds `seedTestBallotSweepCursor`, a test helper that deletes and then re-inserts the singleton row of `deleted_user_ballot_cleanup_cursors`                               |

Sites where no final review reported a defect, run with the question only:

| Site               | Case                        | `<path>:<line>` (path shortened)       | `<change>`                                                                                                          |
| ------------------ | --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `6087-advisory`    | `vouchington-6087-fa05c982` | `follower-distributions/create.mts:73` | removes the `pg_advisory_xact_lock` taken before the quota and audience re-read, and adds a sender rate-limit check |
| `6076e-identities` | `vouchington-6076-e7b25fb9` | `cleanup-retained-identities.mts:51`   | reads the cleanup cursor row without the `FOR UPDATE` it had                                                        |
| `6055-expire`      | `vouchington-6055-2b300006` | `expire-elapsed-page.mts:19`           | updates the elapsed membership directly: the `candidates` CTE that selected one row `FOR UPDATE` is removed         |

Judged match on the six expected findings, and findings raised on the three clean sites:

| Arm                                  | `6055-finalize` | `6059-aliases` | `6059-link` | `6076-flags` | `4154-index` | `6050-seed` | Matched | Clean sites with a finding | Cost per run |
| ------------------------------------ | --------------- | -------------- | ----------- | ------------ | ------------ | ----------- | ------- | -------------------------- | ------------ |
| A: whole diff, no question, `medium` | no              | no             | no          | no           | no           | no          | 0 of 6  | not run                    | $0.22        |
| B: whole diff, question, `medium`    | no              | no             | yes         | no           | no           | yes         | 2 of 6  | 2 of 3                     | $0.25        |
| C: one file, question, `medium`      | no              | no             | no          | no           | no           | no          | 0 of 6  | 0 of 3                     | $0.21        |
| D: one file, question, `high`        | no              | yes            | yes         | no           | no           | yes         | 3 of 6  | 1 of 3                     | $0.34        |

What this shows, on one attempt per arm, which is not a rate:

- B against A is the only like-for-like comparison: the same diff and effort, with and without the
  question, 2 of 6 against 0 of 6. One of B's two matches is not a lock.
- D differs from A in three ways at once (the question, one file, `high`), so its 3 of 6 does not
  say which of them helped. The four lock sites have no run without a question on one file or at
  `high`. `4154-index` and `6050-seed` do, in the two entries below, and neither matched there.
- With the question, seeing less did not help at `medium` (C, 0 of 6, against B, 2 of 6). No arm
  ran the whole diff with the question at `high`.
- `4154-index` and `6055-finalize` were matched by no arm. `6076-flags` drew a finding in B, C and
  D, each about the unlocked cursor read, not the expected deadlock on the flag rows.
- The question also produces findings where the final review had none. B and D both reported that
  two identical concurrent sends now reach followers twice at `6087-advisory`, a race the pull
  request accepts, so it is an accepted outcome change and not a false alarm. B also reported a
  stale comment at `6055-expire`. D raised a missing-test finding at `6087-advisory` and at
  `6076-flags`.
- D loaded `jong-skills:postgres-locking` in two of nine runs; no other arm loaded a skill.

The rule written before the run was: a question arm goes on to a planning step if it beats A by two
or more of six without findings on most clean sites. D meets it. B meets the first half only.

## 2026-11-22: pilot, `vouchington-6050-02ad62d4` with only its test files shown

One attempt per arm, commit 428700a (the tree merged as #139), correctness pillar, Sonnet, judge
Opus, `--select`, `--only-path` on the test helper and the test file (2 of the 38 changed files).

| Arm                       | Judged match | Findings | Turns | Cost  | Skills loaded                     |
| ------------------------- | ------------ | -------- | ----- | ----- | --------------------------------- |
| Whole diff, `medium`      | 0 of 1       | 0        | 12    | $0.22 | none                              |
| Test files only, `medium` | 0 of 1       | 0        | 10    | $0.20 | none                              |
| Test files only, `high`   | 0 of 1       | 0        | 36    | $0.40 | `test-authoring`, `testing-rules` |

The whole-diff row is the pilot in the entry below. The `high` run loaded both testing skills and
opened `vitest.config.mts` and the production job that calls the sweep, and still raised nothing.
So this miss is not explained by the size of the diff, by the skill not being loaded, or by the
config not being read. It agrees with the one-file pilot below. One attempt per arm is not a rate.

## 2026-11-22: `vouchington-6050-02ad62d4` added to `revisions.json`

Case added, not yet measured; no score changes. It adds a row, so totals over `revisions.json` are
not comparable with earlier entries (51 cases, 29 pull requests, 66 expected findings).

One pilot attempt checked the grader and the baseline: correctness pillar, Sonnet at medium effort,
`--select`, judge Opus, commit e133433. It raised no finding in 12 turns for $0.22 (0 of 1). It
opened neither the test helper, the test file nor `vitest.config.mts`, and loaded no skill, though
the selection named `no-mistakes-rules:testing-rules` and the pillar prompt says to load it when a
change adds a test. One attempt is not a rate.

Source: `vouchington/vouchington` pull request 6050, merge base
`1dbac5c467f0d919bc0ab97d1e192e690d76d49d`, head `02ad62d4f90b37d43b2c556b05f47ec63ca8610c`. The
full review run at this head did not report the problem; a person reading the tests did. The author
fixed it in `6559acff1c5c8bb9c22da77a34ff21f953310dd4`, so the label is `"confidence": "high"`.

What it checks: `seedTestBallotSweepCursor` replaces the singleton sweep cursor with a `DELETE` and
then an `INSERT`, on a database every test file shares, while files run in parallel. Another file's
sweep between the two statements fails the seed, and one after the seed breaks the exact cursor
assertions. The case passes when a correctness-pillar finding says the new tests can break or be
broken by other test files through that row. The head's second review item, unrelated lockfile
changes, is not an expected finding.

`expectedSkills` names `no-mistakes-rules:testing-rules` ("MUST NOT use fixed identities in a shared
store, or reset shared state broadly"), read against version 0.109.115. It is the first
`revisions.json` case with a skill tag.

## 2026-11-22: pilot, `correctness` shown one file of the diff instead of the whole diff

Question: does the pillar catch more when one copy of it is aimed at the file that holds the defect?
The file was chosen by hand from the case (an oracle), so this is the most a split by file could
catch, not what a real split would catch.

One attempt per arm, commit 05f7912, Sonnet, judge Opus, `--select`. Three cases, four expected
findings. Left out: `vouchington-2936` (1 file, 16 diff lines) and `vouchington-clients-130` (2
files, 50 lines), whose diffs are already the size of a target, so 2 of the 8 expected `correctness`
findings cannot change with a split; and `vouchington-3419` (3 files, 217 lines).

Judged matches per expected finding (target file's share of the diff in lines):

| Expected finding                       | Whole diff, `medium` | One file, `medium` | One file, `high` |
| -------------------------------------- | -------------------- | ------------------ | ---------------- |
| `tooling-154` `resume.mts` (47 of 783) | 1                    | 1                  | 1                |
| `tooling-154` `update.mts` (62 of 783) | 0                    | 1                  | 0                |
| `tooling-187` `action.yml`, first      | 0                    | 0                  | 0                |
| `tooling-187` `action.yml`, second     | 0                    | 0                  | 0                |
| `4154` migration (1 of 54 files)       | 0                    | 0                  | 0                |

`action.yml` is 323 of 1,281 diff lines. A fourth arm on `4154` showed two files together, the
migration and `merge-aliases-page.mts`, which holds the paged query the index serves: no judged
match at `medium` (no finding) or `high` (two findings on other things).

Cost per run: $0.13 to $0.24 whole, $0.14 to $0.15 one file at `medium`, $0.15 to $0.23 at `high`,
$0.14 and $0.33 for the pair. Total for the 13 pillar runs, judge not included: $2.33. The tree at
05f7912 is the tree the runs used (efc351c, before the squash).

What this shows:

- Showing one file did not produce a judged match on `vouchington-tooling-187` or
  `vouchington-4154` at either effort. All three arms returned no finding at all on them.
- The one gain, `update.mts` at `medium`, is the same defect as `resume.mts`. The whole-diff run's
  single finding names both helpers ("Resume/update helpers pin codec defaults"), and one finding
  satisfies one expectation. It did not repeat at `high`.
- `4154` is a missed connection, not a missing file. The whole-diff run opened both the migration's
  part of the diff and the paged query's, and the pair arm was shown only those two; neither
  connected the `ORDER BY id` to the index.
- `187` turns on what the runner does after the job (post-job hooks that resolve the action's
  checkout), which is in no file of the repository. The runs opened `action.yml` and the cleanup
  scripts.

So on these cases showing less of the diff, by file or by related pair, is not what the pillar
lacks. The one earlier pilot where narrowing helped (one removed lock per reviewer, below) also
told the reviewer which lock to judge and used a prompt narrowed to concurrency, so no run yet
shows a gain from a narrow target with the pillar's own prompt. Not tested: three attempts, a diff
larger than 54 files, or a target that carries a question.

## 2026-11-22: `bench --only-path` shows the pillar agent part of the diff (no run)

`bench` gains `--only-path PATH` (repeatable): the pillar agent is shown only the part of the pull
request diff that touches those paths, while the checkout tree stays whole. No prompt, schema, case
or grader changed, and no run was made. Rows made with the flag carry an `onlyPath` label in
`summary.json` and `summary.md` and are not comparable with any other row; rows made without it are
unchanged.

## 2026-11-22: pilot, Claude Code's `/code-review` in place of the `correctness` pillar

One attempt, so a pilot and not a measurement. Commit 9573ff2, `cases.json` (18 cases for
`correctness`: 6 positives expecting 8 findings, 12 negatives). Not run through `bench`: a scratch
script built each case's snapshot with `prepareSnapshot`, ran `claude -p "/code-review medium"
--model sonnet` in it (Claude Code 2.1.330; read-only tools and read-only git; `gh`, web and edits
disallowed) and matched its findings by file and line with the same 10-line tolerance. No judge
model. Every run used Sonnet only.

| Arm                             | Location matches | Findings in all | Negatives with a finding | Cost  |
| ------------------------------- | ---------------- | --------------- | ------------------------ | ----- |
| `/code-review medium` on Sonnet | 7 of 8           | 98              | 12 of 12                 | $3.23 |

The location count overstates it. Read by hand against the expected claims (by the orchestrating
session, not the Opus judge), one of the seven states the expected problem: the missing codec
option at `resume.mts` in `vouchington-tooling-154`, the same finding the pillar's judged matches
come from. The other six sit near the expected lines and state a different problem
(`vouchington-2936`, `vouchington-3419`, `vouchington-clients-130`, both of
`vouchington-tooling-187`, and `update.mts` in `vouchington-tooling-154`). With five findings per
pull request, a location match is close to chance on a small file.

- What this supports: at this level and model it found no expected problem the pillar does not,
  at about the pillar's cost per run ($0.18) and about twenty times its findings (the pillar's
  pilot in "pilot, `correctness` on the mined cases, Codex against Claude": 5 findings, $2.98).
- It also bears on the earlier no-judge rows: an arm with many findings (Codex Sol, 178) gains
  location matches the same way, so only judged counts rank arms.
- Not measured: three attempts, the Opus judge, other levels, and what the verifier keeps of the
  98 findings. The recipe is not pinned and changes with Claude Code releases.

## 2026-11-22: pilot, free OpenCode models on `correctness`

Screen: `code-reviewer models --harness opencode --free --probes 2 --jobs 3` (OpenCode 1.19.6),
six runs per model on the synthetic probes, 180-second limit, no judge.

| Model                                  | Valid | Found | Seconds | Failure                               |
| -------------------------------------- | ----- | ----- | ------- | ------------------------------------- |
| `opencode/beam-free`                   | 0.83  | 0.50  | 74      | one run exited 1                      |
| `opencode/nemotron-3.5-lightning-free` | 0.67  | 0.00  | 141     | timeouts, one reply off schema        |
| `opencode/hy4-flash-free`              | 0.17  | 0.17  | 170     | timeouts                              |
| `opencode/iceman-free`                 | 0.17  | 0.00  | 176     | timeouts                              |
| `opencode/longcat-2.5-free`            | 0.00  | -     | 1       | server error on every run             |
| `opencode/tidepool-alpha-free`         | 0.00  | -     | 153     | a permission rule refused a tool call |
| `opencode/big-pickle`                  | 0.00  | -     | 180     | every run timed out                   |
| `opencode/flint-40b-free`              | 0.00  | -     | 180     | every run timed out                   |
| `opencode/nemotron-3.5-super-vl-free`  | 0.00  | -     | 180     | rate limited on 5 of 6                |
| `opencode/mimo-v2.6-flash-free`        | 0.00  | -     | 180     | rate limited on 5 of 6                |
| `opencode/deepseek-v4.1-flash-free`    | 0.00  | -     | 180     | rate limited on 5 of 6                |

Three probes ran at once, so a timeout may be throttling of the free tier and not the model; the
two were not separated.

Pillar pilot, one attempt: `bench --pillar correctness --harness opencode --model
opencode/beam-free --reads-outside-checkout --jobs 2` on the six positive cases of `cases.json`
(8 expected findings), commit 9573ff2, file and line matching. 0 of 8 matched and no finding was
reported in any run; each run completed (about 8.5 turns, 84,000 input tokens, 324 output
tokens). Not run: the negatives, three attempts, any other free model. Rows from another harness
are not comparable with Claude rows.

What this shows: `beam-free`, the only model that returned valid output reliably on the screen,
found nothing on these six pull requests in one attempt. The other ten never ran on a mined pull
request; they failed the screen, where throttling may explain the timeouts. Not tested: a
narrower job, such as one target per prompt, and the screen at one job at a time.

## 2026-11-22: verifier prompt gains a block for an unposted earlier review, no run

No run. The review's verifier prompt adds one section, "Your earlier review of this pull request,
never posted", only when `prepare` carried an unposted review of an earlier head forward (a
light push re-review of a same-change rebase or base-merge push). No other prompt, schema,
case or grader changes, and the section is absent from every other run.

No benchmark row is non-comparable: the pillar and verifier benchmarks build their own prompts
and never carry an earlier review, so none exercises the new section. It is not measured.

## 2026-11-22: raw results record reads and searches; cases may name `expectedReads`

Each raw result gains `reads` (files the pillar agent opened, relative to the snapshot when inside it) and
`searches` (its Grep and Glob patterns), read from the Claude stream like `skills`; a case may declare
`expectedReads`, and the summary reports how many were opened apart from recall. No prompt, case, grader or
score changes and no run was made, so every earlier row stays comparable; results saved before this have
no reads and report `n/a`.

## 2026-11-22: approval-check prompt and schema gain `reviewSummary`

No run made. `skills/review/references/refute.md` and `APPROVAL_CHECK_SCHEMA` changed: the check
returns `reviewSummary`, the review's summary rewritten, whenever it adds a finding or question.

No benchmark row is affected. No benchmark exercises the approval check: `bench` scores pillars
and the verifier alone (`src/review/benchmark` does not call `applyApprovalCheck`), and
`benchmarks/review/README.md` has no approval-check row.

## 2026-11-22: `vouchington-6174-b1a495fe` added to `revisions.json`

Case added, not yet measured; no score changes. It adds a row, so totals over
`revisions.json` are not comparable with earlier entries (50 cases, 29 pull requests).

One pilot attempt checked the grader and the baseline: correctness pillar, Sonnet at medium effort,
judge Opus, commit `a12d167`. It raised no finding in 6 turns for $0.16 (0 of 1). One attempt is
not a rate.

Source: `vouchington/vouchington` pull request 6174 (the soft-deleted-user purge), base
`1dbac5c467f0d919bc0ab97d1e192e690d76d49d`, head `b1a495fe4a4280ade451df8d06760fc3287c5f50`. The
guard is removed in `258c64ad7` and is still removed at the head; `6ddb9f6596ca382a44dbab5a9d29cfbc333f6849`
restores it, keyed on `membership_lineage_bindings.user_id`.

What it checks: a review told the author the refund guard in the purge `DELETE` was unreachable
because `NOT EXISTS memberships` implied it. An earlier stage of the same transaction
(`cleanup-user-preserved-rows.mts`, "remove membership projections") has already deleted the
memberships rows, so the guard was live. The case passes when a correctness-pillar finding says
the removal is wrong for that reason (the purge can delete a user with a refund pending). It fails
when the review accepts the removal, is silent, or objects only to something else. The expected
claim carries the pass and fail text for the judge; the reviewer never sees it.

Unlike the other cases here, it was not cut from the Opus audit: it records a known miss of the
review pilot, where the orchestrating session made the wrong claim itself. `body` is the description edit current when the head was pushed (edit of
18:40 UTC, before the restoring commit at 19:10), and it carries the author's "removed as
unreachable" claim, so the reviewer has to rebut it. The format has no `expectedReads`, so the
file with the earlier statement is not listed.

## 2026-11-22: pilot, one removed lock per reviewer, by model and effort

Pilot only. No case file, prompt or score in the tree changes; nothing here is a README row.

Question: the review run misses most lock-removal defects in `revisions.json`. Does giving one
reviewer one removed lock, instead of the whole diff, find them, and at what model and effort?

Setup, none of it in the tree: 4 single-site cases cut from heads where an audit found a defect
behind a removed lock (#6055 finalize, #6059 aliases, #6059 link, #6076 flags), each telling the
reviewer which removed lock to judge; a correctness prompt narrowed to concurrency; description
as it read at the head. Correctness pillar, `--select`, judge Opus 5.5, 3 attempts per arm, same
day, commit 955bfa7 (before the subagent change below).

| Arm                                      | Caught   | Cost per site                 | Finding on #6087 |
| ---------------------------------------- | -------- | ----------------------------- | ---------------- |
| Sonnet 5.5, medium (the review's effort) | 4 of 12  | $0.23                         | 1 of 3           |
| Sonnet 5.5, high                         | 8 of 12  | $0.42                         | 2 of 3           |
| Sonnet 5.5, xhigh                        | 11 of 12 | $1.00 on Sonnet, $1.82 billed | 0 of 3           |
| Opus 5.5, medium                         | 11 of 12 | $0.80                         | 3 of 3           |

- Medium caught only the two #6059 sites. High added #6076 flags (2 of 3). No Sonnet arm below
  xhigh caught #6055 finalize (0 of 6).
- The xhigh arm is confounded: 8 of its 15 runs dispatched a built-in subagent on another model
  (entry below). On the 7 positive runs that used only Sonnet it caught 6.
- #6087 was labelled clean but is an accepted outcome change, so a finding there is not a false
  alarm; the column is not a false-positive rate. The medium arm also ran 3 other clean sites, 9
  runs, with no finding. The other arms did not run them.
- Two earlier arms on whole heads, same day: a hand-written list of the other writers of each
  locked row took the focused prompt from 1 of 12 to 8 of 12, but a script-generated list of the
  same kind gave 1 of 12 and findings on clean heads in 2 of 9 runs. A mechanical writers list is
  not worth building.

What it shows: narrowing to one site helps at every setting, and the rest of the gap is reasoning
depth. Sonnet at xhigh matches Opus at medium and costs more. This is pillar recall; the verifier
was not run on these findings. Sample: 12 attempts per arm cannot resolve a difference of one or
two catches.

## 2026-11-22: a pillar dispatches only the `explorer` subagent

No cases change. Pillar runs before this change could dispatch Claude Code's built-in subagents
(`general-purpose` and the rest) through the `Agent` tool, and those run on the user's default
model, not the one the run named. The xhigh pilot (`--model sonnet --effort xhigh`) showed it: 8 of
15 pillar runs spent $1.1 to $2.1 each on another model, read from `usage.byModel`. Costs of
earlier runs whose `byModel` names a model other than the one requested are not comparable with
later runs; the cost is the figure this changes, and the findings may differ too. The run now
passes `--disallowedTools` with `Agent(<type>)` for each built-in type.

## 2026-11-22: `revisions.json` added; a mined case may record its description

No scores change. New case file and one new case field.

What changed:

- `benchmarks/review/revisions.json`: 49 cases from 28 pull requests in `vouchington/vouchington`
  that went through several review rounds. 39 positives with 64 expected findings and 10
  negatives. One case per reviewed head. The expected findings are what a final review (an Opus
  audit, checked by hand before it was sent) reported at that head; a negative is a head that
  review approved with no defect. The full review run (Sonnet pillars) had reported 28 of the 64
  when the head was reviewed; each case's `reason` gives its count.
- A mined case may carry `"body"`, the description as it read at `headSha`. Without it the
  snapshot still fetches the current description. Every `revisions.json` case has one.
  Each is the edit of the description that was current when the head was reviewed, taken from
  the pull request's edit history. The pilots below ran with these cut at 4000 characters, as
  `review` cuts a description; the stored ones are whole.
- No case has `expectedSkills`: the expected findings are defects a review found, not rule
  violations, and none was checked against the rule skills. `bench-selection` skips them.

Why `body`: the first pilot on a concurrency subset (11 heads the review run had missed, 14
expected findings, plus 4 clean heads; correctness pillar, Sonnet 5.5, judge Opus, `--select`, one
attempt) matched 8 of 14. The descriptions had been rewritten after review to describe the fix
that a later head made, so the reviewer was reading the answer. With the description as it read at
the head, the same run matched 1 of 14, which is what the review run had done. Mined cases in
`cases.json` have the same exposure when a description was edited after the reviewed head; they
were not re-checked.

Pilots on that subset, all one attempt, none of them a measurement:

| Description given      | Current prompt                     | Prompt narrowed to concurrency |
| ---------------------- | ---------------------------------- | ------------------------------ |
| As edited after review | 8 of 14                            | 7 of 14                        |
| As it read at the head | 1 of 14                            | 1 of 14                        |
| Withheld               | 2 of 14, 1 finding on a clean head | 2 of 14, 3 on clean heads      |

A second pilot, 3 attempts per arm on three of the missed heads (4 expected findings) and one
clean head, appended a hand-written list of the other statements that write the affected rows to
each positive's description: current prompt 1 of 12, narrowed prompt 8 of 12, no finding on the
clean head in either arm. The list also stated schema facts (a unique index, a trigger), and the
clean head got no list, so this is an upper bound for a generated list, not a result for one. The
narrowed prompt is not in the tree.

What the pilots showed: these cases reproduce the review run's misses. Rewording the prompt alone
and withholding the description alone do not find them. The pillar runs took 8 to 21 turns and
one loaded no skill.

## 2026-11-22: lock rule moves to `jong-skills:postgres-locking`; `lock-scope-*` re-measured

Run from the branch of this change (parent `b496a56`): reviewer Sonnet 5.5, selection Haiku, judge
Opus, 3 attempts with the installed rule skills (`--select`) and 3 without (`--no-rules`), same
session. Rule plugins: `jong-skills` a361cf367bd2 and `no-mistakes-rules` 0.109.113. Reviewer cost
$1.57 (selection and judge calls not counted).

| Case                          | With skills                | Without                    |
| ----------------------------- | -------------------------- | -------------------------- |
| `lock-scope-ancestor-locks`   | 3 of 3                     | 3 of 3                     |
| `lock-scope-race-response`    | 3 of 3                     | 3 of 3                     |
| `lock-scope-written-row-only` | 0 of 3 runs with a finding | 0 of 3 runs with a finding |

What changed:

- `jong-skills` moved its lock rules out of `postgres-schema-design` into a new skill,
  `postgres-locking`, and changed them: a lock is now allowed for an exact quantity or a rare
  legal or irreversible invariant. `pillars/correctness.md` and step 6 of `verifier.md` still named
  the old skill and restated the old rule ("a transaction locks only the rows it writes"), and
  `pillars/rules.md` restated it too. The first two now name `jong-skills:postgres-locking`, the
  third points at the correctness pillar, and none states a rule of its own. "Never recommend a
  wider lock" became "never recommend a lock it does not allow", because the skill allows some.
- `lock-scope-ancestor-locks` and `lock-scope-race-response` gain `expectedSkills` and
  `expectedRules` for `jong-skills:postgres-locking`, and their reasons and claims quote that skill
  instead of the removed sentence. The `lock-scope-race-response` claim no longer says a
  conditional insert closes the race; at Read Committed it narrows it. `vouchington-2936` expects `jong-skills:postgres-locking`
  instead of `postgres-schema-design`. The cases that list `postgres-schema-design` as unwanted
  list `postgres-locking` too.
- `no-mistakes-rules:queue-rules` reworded two rules the cases quote. `rules-skills-sweep-until-empty`
  now quotes "SHOULD NOT run a scheduled sweep over a growing source without a finite bound on
  rows, batches, or time." and `rules-content-only-unordered-pick` quotes "SHOULD NOT select work
  without a stable order when fairness or repeatability matters." The second rule went from MUST
  NOT to SHOULD NOT; the case still expects `high` and was not re-measured.

What the run showed: both positives are still ceiling cases. The control cannot load the skill,
but the prompt's "never recommend a lock it does not allow" is enough for it to fold the check into
the insert and name no lock. All 9 with-skills runs loaded `jong-skills:postgres-locking`.

A first run of the same cases, made before the wording above was settled ($1.66, same models and
attempts), is superseded: the prompt then said only "never recommend a wider lock", and every
control run on `lock-scope-race-response` closed the race with `FOR SHARE` on the parent row
(0 of 3; with skills 3 of 3). The claim wording also changed between the two runs.

Abandoned in the same session, one attempt per arm, so a pilot and not a measurement ($0.5): a
fixture pair for a removed lock. The positive folded away three pre-locks, one of which a
transaction in an untouched file depended on; the negative removed only redundant ones. The
control, the prompt of this change, and a prompt with an added procedure for removed locks (say
what it serialized, search the tree for every other writer, check each) all caught the positive
and stayed silent on the negative. The fixtures and the procedure were not kept: the control
catches the case, so nothing shows the procedure helps. The real miss that prompted it was an
implicit foreign-key lock inside a large change, which no installed skill states.

Also run, no pillar model: `bench-context` on `synthetic.json` (12 tagged cases: 9 skills quoted in
full, 1 in part, 3 not quoted; rule text 10 present, 3 cut, 0 missing; 5,933 of 6,000 characters
from one skill; 5 of 5 history checks) and `bench-selection` on `synthetic.json` (Haiku, 12 cases,
3 attempts, $0.07: expected skill named in 36 of 36; 3 of 30 attempts named an unwanted skill,
`jong-skills:agent-workflow` each time). The three cut rules are in prose skills
(`postgres-locking` twice, `bounded-iteration`), which the shared context never quotes.

Not comparable with earlier entries: the two `lock-scope-*` positives, and any `correctness` or
`bench-verifier` row on a case with a lock. The mined cases were not re-run.

## 2026-11-21: `correctness` on the mined cases: skills forced in, and an Opus pilot

Same session and cases as the entries below, run from the branch that became commit `15c58c7`, with the
pillar prompts of that commit (before the verifier entry above, which does not touch pillar runs). The control is the
single-round Sonnet arm of the "two rounds" entry.

| Arm                   | Attempts | Judge  | Judged matches | Location matches | Findings in all | Negative runs with a finding | Turns per run | Cost   |
| --------------------- | -------- | ------ | -------------- | ---------------- | --------------- | ---------------------------- | ------------- | ------ |
| Sonnet, skills forced | 3        | Opus   | 2 of 24        | 8 of 24          | 30              | 18 of 36                     | 31.5          | $12.95 |
| Sonnet, normal        | 3        | Opus   | 3 of 24        | 4 of 24          | 18              | 11 of 36                     | 9.2           | $8.49  |
| Opus, normal (pilot)  | 1        | Sonnet | 1 of 8         | 2 of 8           | 18              | 9 of 12                      | 17.9          | $11.67 |

- Forced arm: `--select --select-all-pillars`, so the rule skills the selector picks are loaded
  into the pillar run instead of offered. Forcing covers only what the selector picks: on
  `vouchington-2936` it did not pick the expected `postgres-schema-design` skill in any attempt,
  so that case ran without it. Judged matches did not rise, turns tripled, and more negative runs
  carry a finding. On `vouchington-3419` the loaded `typescript-rules` skill states the exact
  defect and Sonnet did not report it in any attempt.
- Opus arm: `--model opus`, one attempt, so it is a pilot and not a measurement. Its judge is
  Sonnet, because the judge must differ from the agent, so its judged count is not like for like
  with the Opus-judged Sonnet rows; the location count is. Its one judged match is
  `vouchington-tooling-154`, the case Sonnet also catches. One negative run
  (`vouchington-886`, $2.48 of the cost) was partly answered by `claude-fable-5-2`; it has no
  expected finding, so it does not affect the match counts.
- What this supports: on the Opus-judged, like-for-like arms (normal, `high` effort, two rounds,
  skills forced), nothing raised Sonnet's judged matches. The Opus pilot and the shell run (scored
  by location only) are weaker evidence in the same direction. The pillar prompt itself is
  untested.

## 2026-11-21: verifier prompt gains a "settle the facts" step (no run)

`skills/review/references/verifier.md` has a new step 3, and the later steps move down by one. The
verifier now settles every fact a finding or a reassurance rests on (a foreign key's delete action,
whether runs of a job can overlap, who calls a function, whether a failed job runs again) by
opening the file that states it. A pillar's "unverified", "assumed" or "likely" is confirmed,
corrected or dropped. When a fact behind a reassurance is false, the verifier works out the
consequence and reports a finding only if the change is then wrong. A fact the tree
cannot settle is a question, as before.

Why: on the first real reviews, the misses sat under facts a reviewer had assumed. One "safe" call
relied on a cleanup job running one at a time, and its lane allowed four. Another relied on every
foreign key on a purge path being restrictive, and 23 of 152 cascade.

The step covers the findings the verifier receives and what its own summary says. A pillar that
dismisses a risk without reporting anything still gives the verifier nothing to check: pillars
return findings only.

The block for other reviewers' unresolved threads now names the step it replaces ("the Other
reviewers step") instead of its number, which the new step shifted.

No run was made. Every `bench-verifier` row measured before this entry is not comparable with one
measured after it. Expect more turns and tokens per verifier run.

## 2026-11-21: `correctness` on the mined cases with two rounds: no gain for Sonnet

Same session and cases as the entries below. Sonnet at the default effort, `--rounds 2`, three
attempts, every attempt scored by location and then with `--score-only --judge opus`. The control
is the single-round Sonnet arm of the entry "Codex Sol, Codex Terra, Claude Sonnet", whose other
two attempts were judged for this entry.

| Arm                | Judged matches | Location matches | Findings in all | Negative runs with a finding | Turns per run | Cost   |
| ------------------ | -------------- | ---------------- | --------------- | ---------------------------- | ------------- | ------ |
| Sonnet, two rounds | 3 of 24        | 7 of 24          | 34              | 16 of 36                     | 17.7          | $16.11 |
| Sonnet, one round  | 3 of 24        | 4 of 24          | 18              | 11 of 36                     | 9.2           | $8.49  |

- A second round found no expected problem. All judged matches in both arms are
  `vouchington-tooling-154`. Round two added 15 findings to round one's 19, at about twice the
  cost, and more negative runs carry a finding.
- With the `high` effort entry below, neither more effort nor a second pass raised Sonnet's judged
  matches. The shell run below is weaker evidence about missing tools: it did not record whether
  Sonnet used the commands it was granted.
- Abandoned attempt, not to be repeated: the first `--rounds 2` run stopped after round one when
  round one found nothing, so only 18 of 54 runs had a second round and the missed cases were
  never looked at again (judged 3 of 24, location 4 of 24, $10.79). The flag now always runs a
  second round, and its block says the list may be empty.

## 2026-11-21: `bench --rounds` added (no run)

Adds `bench --rounds N` (1 to 3), a benchmark-only experiment. Round two and three append one block
to the pillar prompt ("Earlier rounds ... the findings below ... the list may be empty. Review the change again and
look for problems that are NOT in that list. Return only new findings, and return none if there are none.", then the findings so far
as JSON). The block is a benchmark-only prompt addition: a review never builds it, and the pillar
prompt, schemas and review argv are unchanged. Rows run with `--rounds` above 1 are not comparable
with any earlier row. No run was made; no score changed, and the default (1) is unchanged.

## 2026-11-21: `correctness` on the mined cases at `high` effort: Sonnet and Codex Terra

Same session and cases as the three entries below; three attempts per arm, file and line matching,
no judge. `--effort high` on the pillar agent only.

| Arm                             | Expected locations matched | Findings in all | Negative runs with a finding | Turns per run | Input tokens per run | Cost   |
| ------------------------------- | -------------------------- | --------------- | ---------------------------- | ------------- | -------------------- | ------ |
| Sonnet, `high`                  | 8 of 24                    | 48              | 20 of 36                     | 18.9          | about 375,000        | $15.51 |
| Sonnet, `medium` (entry below)  | 4 of 24                    | 18              | 11 of 36                     | about 10      | about 136,000        | $8.49  |
| Codex `gpt-6.1-terra`, `high`   | 11 of 21                   | 73              | 24 of 36                     | not reported  | about 258,000        | -      |
| Codex `gpt-6.1-terra`, `medium` | 12 of 24                   | 67              | 23 of 35                     | not reported  | about 194,000        | -      |

Matches per case over three attempts, `high` (Sonnet / Terra): `vouchington-tooling-154` 3 of 6 /
3 of 4, `vouchington-tooling-187` 1 of 6 / 3 of 6, `vouchington-3419` 2 of 3 / 3 of 3,
`vouchington-2936` 2 of 3 / 2 of 2, `vouchington-4154` 0 / 0, `vouchington-clients-130` 0 / 0.

All three attempts of both `high` arms were then re-scored with `--score-only --judge opus`, which
reads the claims:

| Arm                           | Location matches | Judged matches |
| ----------------------------- | ---------------- | -------------- |
| Sonnet, `high`                | 8 of 24          | 3 of 24        |
| Codex `gpt-6.1-terra`, `high` | 11 of 21         | 7 of 21        |

- Higher effort did not help Sonnet. All three judged matches are `vouchington-tooling-154`, the
  case it already matched at `medium`. Its location matches on `vouchington-3419` and
  `vouchington-2936` state a different problem. It reported in 20 of 36 negative runs against 11,
  and cost about twice as much.
- Terra's judged matches are `vouchington-tooling-154` (3), `vouchington-3419` (2) and
  `vouchington-2936` (2). Two of its runs failed with `max_output_tokens` (`vouchington-2936`,
  `vouchington-tooling-154`), so its denominator is 21. It did not improve on `medium` by location.
- Neither model, at either effort, has a judged match on `vouchington-tooling-187`,
  `vouchington-4154` or `vouchington-clients-130`.
- The `medium` rows have a judge score for one attempt only (entry below), and the findings on
  negative cases were not checked by the verifier. Rows at `high` are not comparable with rows at
  the default effort except as this experiment, and the Codex and Sonnet rows differ in harness as
  well as model.

## 2026-11-21: `bench --effort` (no run)

`bench --effort LEVEL` runs the pillar agent at low, medium, high or xhigh instead of the `medium` a
full review uses; `max` is refused. No prompt, schema, case or grader changed and no model ran. A
run without the flag, or with `--effort medium`, writes what it did before. Raw results, `summary.json`
and `summary.md` of a run at another level record the effort, and those rows are not comparable with
any earlier entry or with rows at the default effort.

## 2026-11-21: `correctness` on the mined cases: Sonnet with shell, and a judged re-score

Follows the entry "Codex Sol, Codex Terra, Claude Sonnet" (same session, same cases).

Sonnet with `--shell` for `git log`, `git show`, `git blame`, `git diff`, `git grep` and `rg`, three
attempts, file and line matching, $7.28:

| Arm                  | Expected locations matched | Findings in all | Negative runs with a finding | Turns per run |
| -------------------- | -------------------------- | --------------- | ---------------------------- | ------------- |
| Sonnet with shell    | 3 of 24                    | 13              | 8 of 36                      | about 6       |
| Sonnet (entry below) | 4 of 24                    | 18              | 11 of 36                     | about 10      |

The shell grant changed nothing: all three matches are `vouchington-tooling-154`, as before.
Whether Sonnet ran any shell command is not recorded. So Codex's shell does not explain the gap.

One attempt of each arm of the entry below, re-scored with `--score-only --judge opus` (claims
read, not only locations):

| Arm                   | Location matches | Judged matches |
| --------------------- | ---------------- | -------------- |
| Codex `gpt-6.2-sol`   | 5 of 8           | 3 of 8         |
| Codex `gpt-6.1-terra` | 4 of 8           | 3 of 8         |
| Claude Sonnet         | 1 of 8           | 1 of 8         |

Some Codex location matches state a different problem (`vouchington-tooling-187` and
`vouchington-3419` for Sol). Both Codex models still describe `vouchington-2936` correctly, which
Sonnet does not report. One attempt per arm, so direction only. The Codex and Sonnet rows differ in
harness as well as model.

## 2026-11-21: `bench --shell` experiment flag (no run)

Adds `--shell PREFIX` (repeatable), which grants the pillar agent on Claude extra read-only shell
prefixes for one run, to test whether Codex's higher `correctness` recall on the mined cases comes
from its shell rather than the model. No prompt, schema or case changed and no run was made. Rows
from a run with the flag record the prefixes and are not comparable with any earlier row: the
pillar has tools a review does not grant. Rows without the flag are unchanged.

## 2026-11-21: `correctness` on the mined cases: Codex Sol, Codex Terra, Claude Sonnet

Three attempts per arm (separate one-attempt runs), same session, commit 8099ad8, `cases.json` (18
cases for this pillar: 6 positives expecting 8 findings, 12 negatives), no judge (file and line
matching). The Sol and Claude first attempts are the pilot in the entry below. Codex arms use
`--harness codex` and report no cost.

| Arm                   | Expected findings matched | Findings in all | Negative runs with a finding | Input tokens per run | Cost  |
| --------------------- | ------------------------- | --------------- | ---------------------------- | -------------------- | ----- |
| Codex `gpt-6.2-sol`   | 15 of 24                  | 178             | 36 of 36                     | about 863,000        | -     |
| Codex `gpt-6.1-terra` | 12 of 24                  | 67              | 23 of 35                     | about 194,000        | -     |
| Claude Sonnet         | 4 of 24                   | 18              | 11 of 36                     | about 136,000        | $8.49 |

Matched per positive case, of three attempts times the findings it expects:

| Case                          | Sol    | Terra  | Sonnet |
| ----------------------------- | ------ | ------ | ------ |
| `vouchington-tooling-154` (2) | 6 of 6 | 3 of 6 | 3 of 6 |
| `vouchington-tooling-187` (2) | 3 of 6 | 3 of 6 | 1 of 6 |
| `vouchington-3419` (1)        | 3 of 3 | 3 of 3 | 0 of 3 |
| `vouchington-2936` (1)        | 3 of 3 | 3 of 3 | 0 of 3 |
| `vouchington-4154` (1)        | 0 of 3 | 0 of 3 | 0 of 3 |
| `vouchington-clients-130` (1) | 0 of 3 | 0 of 3 | 0 of 3 |

The Codex rows are not comparable with the Sonnet row as a model comparison: the harness, its
tools and the absence of a Skill tool change along with the model. Sol and Terra share a harness,
so those two rows compare. Both Codex models matched the expected location of two regressions in every attempt, and Sonnet
in none. A location match does not show the finding states the expected problem: no judge read the
claims. Terra matched
nearly as many as Sol with about a third of the findings and a quarter of the tokens. One Terra run
failed (`vouchington-clients-103`, `max_output_tokens`), so it has 35 negative runs. A negative is
a pull request that was not reverted, not one known to be clean, so the unmatched findings of every
arm are unjudged. Sonnet loaded no skill in any run. Not measured: other pillars, and what the
verifier keeps of each arm's findings.

## 2026-11-21: pilot, `correctness` on the mined cases, Codex against Claude

One attempt per arm, so a pilot and not a measurement. Commit 8099ad8, `cases.json` (18 cases for
this pillar: 6 positives expecting 8 findings, 12 negatives), no judge (file and line matching),
same session. Codex arm: `gpt-6.2-sol`, `--harness codex`. Claude arm: Sonnet, default flags.

| Arm    | Expected findings matched | Findings in all | Negatives with a finding | Input tokens per run | Cost  |
| ------ | ------------------------- | --------------- | ------------------------ | -------------------- | ----- |
| Codex  | 5 of 8                    | 60              | 12 of 12                 | about 937,000        | -     |
| Claude | 1 of 8                    | 5               | 4 of 12                  | about 142,000        | $2.98 |

Codex found more of the known regressions and reported twelve times as many findings (17 high, 36
medium, 7 low). A negative here is a pull request that was not reverted, not one known to be
clean, so the 55 unmatched Codex findings are unjudged: this run cannot say how many are real.
Claude loaded no skill in any run. Next: three attempts, and the verifier over each arm's findings
to see what survives.

## 2026-11-21: `correctness` and `blast-radius` on Codex, three attempts

Commit 9aa3268 plus the `--harness` flag. Pillar agent `gpt-6.2-sol` on Codex (`codex-cli`
0.171.0), `medium` effort, no judge (file and line matching), `synthetic.json`, three separate runs
of one attempt. Codex reports no cost and no loaded skills, and has no Skill tool.

| Pillar       | Positives found | False alarms on negatives | Input tokens per run (cached) |
| ------------ | --------------- | ------------------------- | ----------------------------- |
| correctness  | 9 of 9          | 0 of 21                   | about 165,000 (136,000)       |
| blast-radius | 3 of 3          | 0 of 21                   | about 173,000 (147,000)       |

Same result as Claude Sonnet on these cases today (12 of 12, no false alarms), so the cases are at
the ceiling for both and do not rank the two. It shows the Codex adapter completes real pillar runs
and returns findings the scorer accepts. `rules` was not run: it depends on loaded skills.

## 2026-11-21: `bench --harness` runs the pillar agent on another harness (no run)

`bench` gained `--harness NAME` and `--reads-outside-checkout`, so a pillar can run on Codex. No
prompt, schema, case or grader changed, and Claude runs are unchanged. A row from another harness
has no cost and no loaded skills and uses another model and toolset, so it is not comparable with
any earlier entry; its summary says which harness ran it.

## 2026-11-21: correction to "unwanted selections, re-scored": 6 of 30 is a floor

No model call. The entry below says selection is close to precise on the fixtures. The re-score
does not show that: the labels are conservative, so 6 of 30 is the least over-selection there can
be. From the same raw results, the ten labelled cases average 5.2 skills per attempt: 1.1 expected,
0.2 labelled unwanted and 3.9 neither. The two TypeScript skills on TypeScript diffs are the largest
share of the 3.9 (44 of the 117 selections); the other 73 are skills nobody has judged for these
diffs. The 9.1 over all 22
cases is higher because the mined pull requests select more, and those are not labelled.

## 2026-11-21: unwanted selections, re-scored from the control run of the wording attempt

No model call: the control run of the entry "abandoned: stricter wording in the selection prompt"
(Haiku, three attempts, commit 7a95490) re-scored with `--score-only` after the ten tagged cases of
`synthetic.json` gained `unwantedSkills`. Over those ten cases, 6 of 30 attempts named an unwanted
skill, 6 selections in all, and every one was `jong-skills:agent-workflow` (6 of 30). No other
labelled skill was selected where it was unwanted. So selection is close to precise on the
fixtures, and the 9.1 skills per attempt comes from the mined cases, which are not labelled.

## 2026-11-21: unwanted skills labeled for the selection eval (no run)

A case may declare `unwantedSkills`, and `bench-selection` now reports how often those skills are
selected, overall, per skill and per case. The 10 tagged cases of `synthetic.json` are labeled,
against `jong-skills` 3507dd4aca6f and `no-mistakes-rules` 0.109.109 as installed on the labeling
date: process skills, `documentation` where the diff changes no doc or comment, and skills for
technology absent from the diff (SQL, React, workflows, test code, `package.json` and so on). The
mined cases of `cases.json` are not labeled. No model was called and no score is re-measured: the
hit rate and mean selected of the entries below are unchanged and comparable, and there is no
earlier unwanted-selection number to compare with.

## 2026-11-21: abandoned: stricter wording in the selection prompt

Commit 7a95490. `bench-selection`, Haiku, the 22 tagged cases of `synthetic.json` and `cases.json`,
three attempts, control and variant in the same session. The variant added one sentence to the
selection prompt: a skill matches only when the changed files contain what its rules govern, and a
skill about how work is done is left out unless the change edits the files it governs.

| Arm              | Expected skill named | Skills selected per attempt | Cost  |
| ---------------- | -------------------- | --------------------------- | ----- |
| Control          | 66 of 66             | 9.1                         | $0.17 |
| Stricter wording | 65 of 66             | 8.8                         | $0.19 |

The wording removed about a quarter of a skill per attempt and lost one expected skill, so it was
not kept and the selection prompt is unchanged. In the control, `jong-skills:documentation` was
selected in 41 of 66 attempts and `jong-skills:agent-workflow` in 14. The cases label only the
skill a finding needs, not the skills that should be left out, so over-selection cannot be scored
yet.

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

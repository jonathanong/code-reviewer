# Benchmark history

Newest first. Every measured run and every change to what is measured gets an entry.

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
  reviewed without skills. Not re-measured.
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

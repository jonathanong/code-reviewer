# Benchmark history

Newest first. Every measured run and every change to what is measured gets an entry.

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

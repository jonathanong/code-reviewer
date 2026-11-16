# Benchmark history

Newest first. Every measured run and every change to what is measured gets an entry.

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

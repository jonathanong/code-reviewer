# Code review benchmarks

This suite measures the reviewer's pillar runs, skill selection and verifier on labeled pull
requests. A score answers one question: does the reviewer find the defect a case expects, and
does it find more with the installed rule skills than without them? Clean changes are in the
suite to measure noise.

## Current results

One run: 2026-11-16, at the commit that added this table, reviewer Sonnet 5.5, selection Haiku,
judge Opus, 3 attempts with the installed rule skills (`--select`) and 3 without (`--no-rules`).
Rule plugins: `no-mistakes-rules` 0.109.60 and `skills` 0480fabddb14 (since renamed `jong-skills`;
not re-measured under the new name). Reviewer and selection cost
$23.43 (judge calls not counted). See [HISTORY.md](HISTORY.md) for
every run.

**Every row below is stale.** The pillar contract, the pillar and verifier output schemas, the verifier prompt and the mined-case
snapshots have all changed since this run, so no row is comparable with a run made now. The
"(no run)" entries in [HISTORY.md](HISTORY.md) list each change and the rows it affects.

Mined cases (8 real pull requests from `cases.json`):

| Pillar      | Cases | Expected findings caught, with skills | Without | Runs that loaded every selected skill |
| ----------- | ----- | ------------------------------------- | ------- | ------------------------------------- |
| design      | 4     | 10 of 12                              | 5 of 12 | 11 of 12                              |
| rules       | 1     | 3 of 3                                | 0 of 3  | 3 of 3                                |
| correctness | 3     | 5 of 12                               | 4 of 12 | 9 of 9                                |

- The correctness row is `vouchington-tooling-154` alone: 5 of 6 with skills and 4 of 6 without.
  The correctness prompt catches it, not the skills.
- `vouchington-2936` and `vouchington-4154` were caught 0 of 3 in both arms. On
  `vouchington-2936` every run objects to the advisory lock itself, citing the lock rules, and
  never reviews the lock key the case expects. `vouchington-4154` expects a low-severity index
  note inside a 54-file change.
- `vouchington-2936` was run again on 2026-11-19 with `jong-skills` 8cad1e4eb680 (lock rule
  reworded from "never" to "avoid") and `no-mistakes-rules` 0.109.97, on the snapshots without
  history: still 0 of 3 in both arms. No run objects to the lock existing any more; one of three
  reviews the lock key but not the letter-case defect the case expects. This row is from that
  run, not the 2026-11-16 one.
- `vouchington-1144` is a ceiling case: the control catches it 3 of 3.
- One `vouchington-1146` run had no skills: the Haiku selection call failed, the review ran
  without them, and it missed. The other 23 runs loaded every skill they were told to (4 to 19).
- At 3 attempts a difference of one catch is noise.

Fixture cases (`synthetic.json`, rules and correctness pillars):

| Group                                                | With skills   | Without      |
| ---------------------------------------------------- | ------------- | ------------ |
| Rules positives (10 cases)                           | 30 of 30      | 3 of 30      |
| `rules-repo-orchestration-package` (repository rule) | 3 of 3        | 3 of 3       |
| `links-declared-api-payload` (correctness)           | 3 of 3        | 0 of 3       |
| `lock-scope-*` positives (correctness, 2)            | 6 of 6        | 6 of 6       |
| Expected skill selected and loaded (10 tagged cases) | 30 of 30 runs | n/a          |
| Negatives with a high or blocking finding (7, rules) | 0 of 21 runs  | 0 of 21 runs |
| Negatives with a high or blocking finding (7, corr.) | 0 of 21 runs  | 0 of 21 runs |

- The control's three catches are one each on `rules-content-only-unordered-pick`,
  `rules-manifest-only-duplicate-utility` and `rules-test-only-per-item`.
- The two `lock-scope-*` positives are ceiling cases: the correctness prompt states their rule.
- `rules-repo-orchestration-package` puts its rule in the fixture repository's own `AGENTS.md`.
  `--no-rules` removes the shared skills, not that file, so its control is not a null hypothesis;
  the case checks that a repository rule is applied and cited.
- Negatives drew three low findings in 84 runs and nothing higher.
- Reviewer cost: $0.12 a pillar run with skills on a fixture, $0.23 on a mined case.

Skill selection alone (`bench-selection`, Haiku, 22 tagged cases, 3 attempts, $0.19): the expected
skill was named in 66 of 66 attempts, with 9.1 skills selected on average (2 to 9 on fixtures, 5
to 20 on mined cases).

Verifier (`bench-verifier`, Opus, on the with-skills findings of the run above, 3 attempts, labels
judged by Sonnet, $25.14):

| Set           | Real findings kept | Planted duplicates merged | Severity kept   | Findings per case, before → after |
| ------------- | ------------------ | ------------------------- | --------------- | --------------------------------- |
| Fixtures (21) | 100% in 3 of 3     | 100% in 3 of 3            | 100% in 3 of 3  | 0.9 → 0.9                         |
| Mined (8)     | 100% in 3 of 3     | 100% in 3 of 3            | 86%, 100%, 100% | 2.1 → 2.2                         |

- The verifier lost no real finding and merged every planted duplicate. It removes almost
  nothing, because these pillar runs produce little noise to remove.
- It confirmed all 5 other high or blocking findings it was asked to check, so this run does not
  show whether it would refute a wrong one.
- It costs about $0.24 a fixture case and $0.43 a mined case, more than a pillar run.

Shared context alone (`bench-context`, no model, 10 tagged synthetic cases and 3 history cases;
2026-11-21): is what a case depends on in the context a review builds?

| Check                                           | Result                                        |
| ----------------------------------------------- | --------------------------------------------- |
| Expected skills quoted in full / in part / none | 9 / 1 / 1                                     |
| Expected rule text in the excerpt               | 10 present, 1 cut, 0 missing, 0 not installed |
| Most quoted from one skill                      | 4,857 of 6,000 characters                     |
| History and linked-regression checks            | 5 of 5 found                                  |

- The rule that was cut is in a prose skill (`bounded-iteration`) that is never quoted; its case
  also names `queue-rules`, which holds the sibling rule in full.
- It does not measure whether a pillar uses the excerpt, only that the text is there to use.
  Rule text is checked against the plugin versions installed when it ran.

### How to read the numbers

- Every rate is out of 3 attempts per arm. A difference of one catch is noise.
- The result is the gap between "with skills" and "without". A row where both arms score the
  same is a ceiling case: it shows the skills do no harm, not that they help.
- The `vouchington-2936` note is from a later run than the table; it says so.

### What the suite does not measure

- A whole review. Each pillar is scored alone; evidence, references, the approval check, stacks,
  carried changes and dependencies never run here.
- How a review reads to its author: length, tone, and whether a comment was worth posting.
- Whether a finding that no case expects is real. Negatives count only high or blocking findings.
- Any harness or model other than the ones named above the table.
- Tokens per model. The runner reports them per model and arm (see
  [Tokens per model](../../docs/benchmarks.md#tokens-per-model)), but the table above does not
  carry them until it is re-measured. Cost is dollars per run.

Labeled pull requests for benchmarking the `review` pillar prompts in
`skills/review/references/pillars/`.

## How to run it

```bash
pnpm exec code-reviewer bench \
  --cases benchmarks/review/cases.json \
  --prompts skills/review/references/pillars \
  --out "$TMPDIR/review-bench" \
  --pillar design --jobs 3
```

`bench --select --excerpts alongside|replace` compares loading every selected skill (the `rules` pillar) with skipping
those already quoted in the shared context; see [the benchmarks reference](../../docs/benchmarks.md).

`bench --loads-only --pillar <p> --case <id>` runs a pillar on a case it expects nothing from, with no judge,
only to record the skills it loads.

Other commands: `bench-selection`, `bench-verifier` and `bench-context` (no model); `--score-only` re-scores saved results
without model calls. A run costs dollars and minutes per case, so run only the pillars
whose prompts changed, and read [AGENTS.md](AGENTS.md) first. Raw results land in
`<out>/raw/`, with `summary.json` and `summary.md` beside them, and are not committed.

The cases, run flags, snapshots, verifier, skill selection, metrics and token figures are
described in [docs/benchmarks.md](../../docs/benchmarks.md).

Rules for changing or running this suite are in [AGENTS.md](AGENTS.md).

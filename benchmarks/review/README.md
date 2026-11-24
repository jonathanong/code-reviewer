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

**Every row below is stale.** The pillar contract, the pillar and verifier output schemas, the
verifier prompt (which since 2026-11-23 may carry a list of document lines), the congruence pillar the verifier performs and the mined-case snapshots have
all changed since this run, so no row is comparable with a run made now. The
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
- Not in the table, mined from misses on no-mistakes reviews (see `HISTORY.md`): `no-mistakes-4008`
  (positive, correctness and focus: a failed CI run accepted as the diff base, asked among five
  requester points), `no-mistakes-3963` (positive, correctness: a new lint rule that reports nothing
  for an indirect import its fixtures never use) and `no-mistakes-4006` (focus only, no expected pillar finding: a point
  about a rule that another open pull request also adds). `no-mistakes-4027` (negative, focus: three
  requester points that all hold) checks that asking several points together raises nothing.
- Not in the table (piloted once each way, 0 of 1, see `HISTORY.md`; `vouchington-6254` not run): `vouchington-6282` (positive, correctness: unneeded
  compare-and-set guard for a concurrency-1 cleanup queue) and `vouchington-6254` (negative:
  removing redundant account cleanup prelocks on the same queue), added on 2026-11-24 alongside the
  race-reachability rules in `correctness.md` and `verifier.md`.

Review-round cases (`revisions.json`, 51 heads of 29 pull requests): not measured yet. Each is
one reviewed head of a pull request that took several rounds, with the findings a final review
reported at that head. On the 49 mined heads the full review run had reported 28 of the 64 expected
findings; pilots are in [HISTORY.md](HISTORY.md). Two cases were added by hand, each a known miss:

- `vouchington-6174-b1a495fe`: a guard in the soft-deleted-user purge `DELETE` was removed as
  unreachable, though an earlier statement of the same transaction deletes the rows the remaining
  predicate reads. It passes when the review flags the removal.
- `vouchington-6050-02ad62d4`: new tests replace a singleton cursor row on the shared test database
  while test files run in parallel. It passes when the review says the tests can break each other.

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
- The `lock-scope-*` row is from the 2026-11-22 run (`jong-skills` a361cf367bd2,
  `no-mistakes-rules` 0.109.113), not the 2026-11-16 one. Both positives are ceiling cases: the
  correctness prompt tells the reviewer not to recommend a lock the locking skill does not allow.
- `rules-repo-orchestration-package` puts its rule in the fixture repository's own `AGENTS.md`.
  `--no-rules` removes the shared skills, not that file, so its control is not a null hypothesis;
  the case checks that a repository rule is applied and cited.
- Negatives drew three low findings in 84 runs and nothing higher.
- Reviewer cost: $0.12 a pillar run with skills on a fixture, $0.23 on a mined case.

Skill selection alone (`bench-selection`, Haiku, 22 tagged cases, 3 attempts, $0.19): the expected
skill was named in 66 of 66 attempts, with 9.1 skills selected on average (2 to 9 on fixtures, 5
to 20 on mined cases). **Stale for target selection:** `selectSkills` now also selects built-in
targeted checks; `synthetic.json` includes two target-selection fixtures
(`select-target-concurrency-guard` and `select-target-no-guard`), piloted only (6 of 6 attempts
matched; see `HISTORY.md`, 2026-11-24).

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
- Not in the table: `congruence-test-only-edits-source` and `congruence-test-only-with-helper`
  check a title and description that say test-only against the changed files. They were added
  on 2026-11-22 and only piloted (1 attempt); the positive is a ceiling case, caught with and
  without the scope bullet it was written for.
- Not in the table: `congruence-missing-real-run` checks that a user-visible behavior change whose
  description is a checklist with no realistic input or output raises one `low` congruence finding
  under `jong-skills:pr-description`'s "Show one real run" rule. Added on 2026-11-24; piloted once per
  arm (1 of 1 with the rule, 0 of 1 without), see `HISTORY.md`.
- Not in the table: the stale-document expectation of `vouchington-6166-f684113f` (a requirements
  line outside the diff that the change makes false). Measured on 2026-11-23 with the verifier
  alone, counted by reading the findings: Sonnet 3 of 3 and Opus 2 of 2 with the list of
  document lines in the prompt as shipped, against Sonnet 0 of 3 in the same session with the
  list in a file only.

Shared context alone (`bench-context`, no model, 12 tagged synthetic cases and 3 history cases;
2026-11-22): is what a case depends on in the context a review builds?

| Check                                           | Result                                        |
| ----------------------------------------------- | --------------------------------------------- |
| Expected skills quoted in full / in part / none | 9 / 1 / 3                                     |
| Expected rule text in the excerpt               | 10 present, 3 cut, 0 missing, 0 not installed |
| Most quoted from one skill                      | 5,933 of 6,000 characters                     |
| History and linked-regression checks            | 5 of 5 found                                  |

- The rules that were cut are in prose skills (`postgres-locking` twice, `bounded-iteration`),
  which are never quoted; the `bounded-iteration` case also names `queue-rules`, which holds the
  sibling rule in full.
- It does not measure whether a pillar uses the excerpt, only that the text is there to use.
  Rule text is checked against the plugin versions installed when it ran.

Answer cases (`answers.json`, `bench-verifier` only), not re-measured since the answer's quote became optional (2026-11-23); last measured 2026-11-23, Sonnet as the verifier, three attempts per arm: `answers-like-row-lock` 3 of 3 with rules and 0 of 3 without (the answers without rules lack the rule citation the case expects); `answers-floating-promise` 3 of 3 in both arms, a ceiling case ([history](HISTORY.md)). Each lists another
reviewer's open note, as the verifier prompt renders it, and the outcome expected for that note,
graded by code and reported per thread. The pillar benches do not run this file.

| Case                       | Note                                                                             | Expected                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `answers-like-row-lock`    | asks for `SELECT ... FOR UPDATE` on the parent row of an append-only vote insert | an answer that cites `jong-skills:postgres-locking`                           |
| `answers-floating-promise` | says a try/catch cannot catch a send that is never awaited (true)                | no answer, and the verifier raises the defect itself as a correctness finding |

- Both are not measured. Neither has a control: the first needs the rule skill to pass, so run
  it with and without `--no-rules` to see that.
- A note whose thread already holds a reply from the reviewer is filtered before the prompt
  (`answerableThreads`), so a case file, which lists notes after that filter, cannot express it;
  a unit test covers it instead.

Focus cases (`synthetic.json`, `bench-focus`): **piloted once, 6 of 6 points (2026-11-24); no rate yet.** `bench-focus` runs the real
requester-focus step (`runFocus` with computed `Change facts`) on every case declaring `focus`
points, and grades each point deterministically against its `expectedStatus` (`holds`,
`does_not_hold`, or `not_checked`, plus zero findings when `expectNoFindings` is set).

| Case                        | Points checked                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `focus-fact-decides`        | 240-line added file vs 200-line cap (`does_not_hold`) and 4-line file under 50 (`holds`)           |
| `focus-hostile-point`       | inert instruction telling the reviewer to approve (`not_checked`, 0 findings)                      |
| `focus-unanswerable`        | production p99 latency metric absent from the tree (`not_checked`)                                 |
| `focus-plain-holds`         | `clamp` throws `RangeError` when `min > max` (`holds`)                                             |
| `focus-plain-fails`         | `parseTimeoutMs` rejects zero and negative numbers (`does_not_hold`)                               |
| `focus-target-guard-needed` | The `unneeded-concurrency-guard` target stays quiet when the guard is needed (`holds`, no finding) |

A case may set `focusRefs`, an object from pull request number to a full 40-character commit
(`{ "3963": "236cad49..." }`). When a requester point names another pull request (`#123`, `PR 123`,
`pull request 123`), the real step reads that pull request's changed files from git; `focusRefs`
pins which commit it reads instead of the live `refs/pull/<n>/head`, and `bench-focus` fetches the pin
into the case's cache. Mined case `no-mistakes-4006` uses it (a requester point names 3963, which
changes 16 of the same files); piloted 3 of 3 (see `HISTORY.md`).

Mined case `vouchington-6282` in `cases.json` also declares a target focus entry
(`target: "unneeded-concurrency-guard"`, expected `does_not_hold`); piloted only (2 of 3).

```bash
pnpm exec code-reviewer bench-focus \
  --cases benchmarks/review/synthetic.json \
  --out "$TMPDIR/review-focus"
```

### How to read the numbers

- Every rate is out of 3 attempts per arm. A difference of one catch is noise.
- The result is the gap between "with skills" and "without". A row where both arms score the
  same is a ceiling case: it shows the skills do no harm, not that they help.
- The `vouchington-2936` note and the `lock-scope-*` row are from later runs than the table; each
  says so.

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

Other commands: `bench-selection`, `bench-verifier`, `bench-focus` and `bench-context` (no model); `--score-only` re-scores saved results
without model calls. A run costs dollars and minutes per case, so run only the pillars
whose prompts changed, and read [AGENTS.md](AGENTS.md) first. Raw results land in
`<out>/raw/`, with `summary.json` and `summary.md` beside them, and are not committed.

The cases, run flags, snapshots, verifier, skill selection, metrics and token figures are
described in [docs/benchmarks.md](../../docs/benchmarks.md).

Rules for changing or running this suite are in [AGENTS.md](AGENTS.md).

# Code review benchmarks

This suite measures the reviewer's pillar runs, skill selection and verifier on labeled pull
requests. A score answers one question: does the reviewer find the defect a case expects, and
does it find more with the installed rule skills than without them? Clean changes are in the
suite to measure noise.

## Current results

Two runs. The mined-case table and the notes under it come from 2026-11-16, at the commit that added this table:
reviewer Sonnet 5.5, selection Haiku, judge Opus, 3 attempts with the installed rule skills (`--select`) and 3
without (`--no-rules`). Rule plugins then: `no-mistakes-rules` 0.109.60 and `skills` 0480fabddb14 (since renamed and
split into the `ratchet-*` plugins; not re-measured under the new name). Reviewer and selection cost $23.43 (judge
calls not counted).

The fixture, selection, context, verifier and answers rows come from the targeted run of 2026-11-27 at `7354b0b`
(jongleberry/code-reviewer#233, which skips defects a check the repository runs in CI detects): reviewer and verifier
Sonnet 5.5, selection Haiku, judge and checker Opus, 3 attempts per arm (`--select` and `--no-rules`, same session; each
attempt is its own `bench` run, so a rate is over three runs of every case). Plugins: `no-mistakes-rules` 0.109.123 and
`ratchet-workflows`, `ratchet-github`, `ratchet-backend` and `ratchet-code` from the `ratchet-stack` marketplace build
`960fb7a540e9` (reinstalled as `867832904876` during the run; the skill files are identical). Reviewer, verifier and
selection cost $54.82 (judge calls not counted). See [HISTORY.md](HISTORY.md) for every run.

**Still stale** (not re-measured since the changes listed in [HISTORY.md](HISTORY.md)): the mined-case table and the
notes under it (the pillar contract, the output schemas, the verifier prompt (which also carries the review date in UTC, as every pillar prompt does), the congruence pillar, the verifier's
step 2, the skip of CI-detectable defects and the mined snapshots changed since 2026-11-16); the review-round cases;
`links-declared-api-payload` and the `lock-scope-*` positives; the verifier row on mined cases; the six mined
misses of 2026-11-26 and 2026-11-27 (measured before #233); `vouchington-6282` and `vouchington-6254`; the negative
congruence twins (`bench-verifier` skips a case with no pillar result and no expected finding); and every mined
focus case. Everything else below was measured on 2026-11-27.

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
- `vouchington-2936` was run again on 2026-11-19 with the rule-skills plugin 8cad1e4eb680 (lock rule
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
- Not in the table: three mined misses from no-mistakes pull requests that only a hand check or a Codex shadow
  caught (correctness, added 2026-11-26): `no-mistakes-4102-5a0aca3` (CSP array fragments intersected as
  separate policies), `no-mistakes-4062-ce406a2` (a single `|` loses piped loop input) and
  `no-mistakes-4057-d2fd340` (a loader alias or namespace import escapes the narrowing proof). Run at 2 attempts
  per arm on Sonnet: 0 of 2 with skills and 0 of 2 without on each, so the control misses all three (the reviewer
  never loaded `lint-rule-authoring`); not a rate, see `HISTORY.md`.
- Not in the table: three mined misses where CodeRabbit found a defect on a head our reviewer passed with no findings
  (correctness, added 2026-11-27): `code-reviewer-210-fe45b7e` (two claims: a timeline filter that reads `commit_id`
  for label events, and a stale-hold cleanup that removes a hold placed after the lookup), `supervisor-65-417fd1b`
  (ordering operators on an ordinal classifier output evaluate as string inequality) and `no-mistakes-4604-9d3ea80`
  (nested PostgreSQL option structs without `deny_unknown_fields` in a change that rejects unknown nested fields).
  Run at 3 attempts per arm on Sonnet: 0 of 3 with skills and 0 of 3 without on each, so the control misses all
  three; not a rate, see `HISTORY.md`.
- Not in the table: `no-mistakes-4745-3ff11a1` (negative, rules and correctness pillars and the verifier: a wrong
  `high` finding that a line exceeds rustfmt's `max_width` so CI's `cargo fmt --all -- --check` fails, on a head
  where that CI step ran and succeeded; no `high` or `blocking` finding is expected). Added 2026-11-27 with the skip
  of defects a CI check detects. Measured 2026-11-27, 3 attempts per arm: no `high` or `blocking` finding in 0 of 3
  runs with skills and 0 of 3 without, on the rules pillar and on the correctness pillar; the verifier (Sonnet,
  fed those findings) raised none in 3 of 3. For the pillars it is a ceiling case: with `origin/main`'s prompts,
  which have no CI-skip rule, the rules pillar also made no `high` finding in 3 of 3 runs, so Sonnet does not
  reproduce the wrong claim here and the pillar cannot show that #233 prevents it. The verifier half is measured
  with the false claim planted (`planted-findings/`, below), where `origin/main`'s prompt fails. The guard, a real
  defect no CI check catches that must stay, is the existing `answers-floating-promise` (`answers.json`, verifier
  only), measured below. See `HISTORY.md`.
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

| Group                                                   | With skills   | Without      |
| ------------------------------------------------------- | ------------- | ------------ |
| Rules positives (10 cases)                              | 30 of 30      | 1 of 30      |
| `rules-repo-orchestration-package` (repository rule)    | 3 of 3        | 3 of 3       |
| Correctness positives added since 2026-11-16 (5, below) | 15 of 15      | 15 of 15     |
| Expected skill selected and loaded (10 tagged cases)    | 30 of 30 runs | n/a          |
| Negatives with a high or blocking finding (8, rules)    | 0 of 24 runs  | 0 of 24 runs |
| Negatives with a high or blocking finding (11, corr.)   | 0 of 33 runs  | 1 of 33 runs |
| `links-declared-api-payload` (correctness), 2026-11-16  | 3 of 3        | 0 of 3       |
| `lock-scope-*` positives (correctness, 2), 2026-11-22   | 6 of 6        | 6 of 6       |

The two bottom rows are stale (not re-run on 2026-11-27); every other row is the 2026-11-27 run.

- The control's one catch on the rules positives is `rules-content-only-unordered-pick`, 1 of 3; it caught
  none of the other nine. (The 2026-11-16 control caught three, one each on that case,
  `rules-manifest-only-duplicate-utility` and `rules-test-only-per-item`.) Recall with skills: 33 of 33 over all 11
  rules positives; the #233 prompts and `origin/main`'s give the same 33 of 33 (see `HISTORY.md`).
- The five correctness positives are `correctness-introduced-sibling-gap` (`medium`),
  `correctness-eslint-destructure-crash` (`high`), `correctness-unanalyzable-skip-swallows` (`medium`),
  `correctness-selection-alias-escapes` (`high`) and `correctness-stated-purpose-human-gate` (`high`). All five
  are ceiling cases: the control caught each 3 of 3, so none shows that a skill helps. They check that the
  correctness prompt still fires after #233, and they fail the keep rule in [AGENTS.md](AGENTS.md) (a fixture stays
  only while the control misses it).
- The 11 correctness negatives are the 7 original ones plus `correctness-preexisting-sibling-gap`,
  `correctness-eslint-destructure-guarded`, `correctness-unanalyzable-conditional-skip` and
  `correctness-selection-alias-invalidates`; the 8 rules negatives are the 7 original ones plus
  `rules-rule-effect-absent`. The control's one false alarm was on `correctness-selection-alias-invalidates`, in
  one of three attempts. `correctness-preexisting-sibling-gap`, a severity miss when piloted, drew no `high` or
  `blocking` finding in six runs.
- The `lock-scope-*` row is from the 2026-11-22 run (the rule-skills plugin a361cf367bd2,
  `no-mistakes-rules` 0.109.113), not the 2026-11-16 one. Both positives are ceiling cases: the
  correctness prompt tells the reviewer not to recommend a lock the locking skill does not allow.
- `rules-repo-orchestration-package` puts its rule in the fixture repository's own `AGENTS.md`.
  `--no-rules` removes the shared skills, not that file, so its control is not a null hypothesis;
  the case checks that a repository rule is applied and cited.
- Negatives, 57 runs per arm: with skills 7 low and 11 medium findings, nothing higher; without, 2 low, 11 medium and
  one high (the false alarm above). The medium findings are on the correctness negatives (`preexisting-sibling-gap`,
  `eslint-destructure-guarded`, `unanalyzable-conditional-skip`, `selection-alias-invalidates`), where a finding
  below `high` is allowed.
- Reviewer cost: $0.16 a rules run with skills on a fixture and $0.07 without, $0.12 a correctness run with skills
  and $0.07 without (2026-11-27); $0.23 on a mined case (2026-11-16).

Reply-only re-assessment (`bench-replies`, `replies.json`, 6 synthetic cases and 3 moved-head cases, Sonnet, 3 attempts, 2026-11-27,
$0.16 in all, one pilot run, no control arm): 18 of 18 attempts gave the expected outcome. The cases are a valid
acknowledgement of a breaking change (lowered to `medium`), a reply that gives what the finding asked for
(settled), and four that must stay open: pushback with no evidence, a promise to fix later, a claim about code
the call cannot see, and an instruction hidden in the reply. All are ceiling cases for Sonnet, so this shows the
step works and is not fooled by these shapes, not how much margin it has. It does not measure replies that are
partly right, or threads of several replies. Three moved-head cases (2026-11-27, 3 attempts, $0.08, a second run
with no control arm) add a `sinceDiff` and a reply "Fixed in <sha>": 9 of 9 as expected, a diff that shows the
fix (settled), a diff that changes only a comment (open), and the same diff carrying an instruction (open).
They are ceiling cases for Sonnet: the old prompt, with no rule about `sinceDiff`, also passed all 9, so the
diff as data is enough and the prompt did not change. See [docs/replies.md](../../docs/replies.md).

Skill selection alone (`bench-selection`, Haiku, 30 tagged cases, 3 attempts, 2026-11-27, $0.44): the expected
skill was named in 87 of 90 attempts (97%), with 9.7 skills selected on average. The three misses are one case:
`congruence-missing-real-run` never selected `ratchet-github:pr-description` (0 of 3), the one skill its rule
comes from; the verifier case below still catches the defect without it. Every other case selected its skill 3 of 3. No attempt named a skill from an
`unwantedSkills` label (0 of 30). Target selection (built-in targeted checks, 20 cases): 55 of 60 attempts matched
(92%); the misses are `vouchington-6282` (`unneeded-concurrency-guard`, 2 of 3), `vouchington-6254` (the same
check selected when unwanted, 2 of 3 attempts, and 1 of 3 matched) and `vouchington-6656-12fe22b`
(`sibling-keeps-old-shape`, 1 of 3), all mined; the fixtures `select-target-concurrency-guard` and
`select-target-no-guard` matched 3 of 3 each.

Verifier (`bench-verifier`, 3 attempts; each attempt is its own run over the with-skills findings of the matching
attempt of the fixture runs above):

| Set                                        | Real findings kept | Planted duplicates merged | Severity kept   | Findings per case, before → after |
| ------------------------------------------ | ------------------ | ------------------------- | --------------- | --------------------------------- |
| Fixtures (28), 2026-11-27, Sonnet verifier | 100% in 3 of 3     | 100% in 3 of 3            | 100% in 3 of 3  | 1.0 → 1.0, 0.9 → 0.9, 1.0 → 1.0   |
| Mined (8), 2026-11-16, Opus verifier       | 100% in 3 of 3     | 100% in 3 of 3            | 86%, 100%, 100% | 2.1 → 2.2                         |

Planted false finding (`no-mistakes-4745-3ff11a1` with the `high` rustfmt claim in `planted-findings/`, Sonnet
verifier, 3 attempts per arm, 2026-11-27): the verifier output holds no finding for it in 3 of 3 attempts with #233's
prompts (findings 1.0 → 0.0) and in 0 of 3 with `origin/main`'s (kept every time, downgraded from `high` to `medium`;
1.0 → 1.0). The guard `answers-floating-promise` raised the floating promise in 3 of 3 with both. The planted
finding has no CI result in the snapshot, so a pass is a drop; `bench-verifier` has no pass or fail for a drop, so
read it as the findings-after figure on that case. Run it from a scratch copy of the directory (`cp -r
benchmarks/review/planted-findings "$TMPDIR/planted"`, then `--findings-from "$TMPDIR/planted"`): the command
clones the snapshot cache into that directory. Also run on 2026-11-27, see `HISTORY.md`.

The fixture row is the 28 fixture cases that have pillar findings from the rules and correctness runs (labels
judged by Opus, other high or blocking findings checked by Opus); the mined row is stale.

- The verifier lost no real finding and merged every planted duplicate. It removes almost
  nothing, because these pillar runs produce little noise to remove: no fixture finding was dropped, so this run
  does not show whether it rejects a wrong one.
- It confirmed every other high or blocking finding it was asked to check (4, 1 and 1 over the three attempts; the
  checker agreed each time), so it also does not show whether it would refute a wrong one.
- It costs about $0.15 a fixture case with Sonnet ($13.18 for the three attempts with the checker) and $0.43 a
  mined case with Opus (2026-11-16).
- Congruence cases, verified alone by Sonnet (no pillar findings), 3 attempts per arm, 2026-11-27: the six positives
  `congruence-test-only-edits-source`, `congruence-missing-real-run`, `congruence-description-command-paths-unresolved`,
  `congruence-undocumented-unused-allow-failure`, `congruence-declared-breaking-vague` and
  `congruence-acknowledged-breaking` each raised their expected finding in 3 of 3 attempts (label recall 100%, severity
  agreement 100%, one finding per case). `congruence-missing-real-run` without `ratchet-github:pr-description`
  (`--no-rules`) also raised it 3 of 3, so the 2026-11-24 pilot (0 of 1 without) did not repeat and the case is now a
  ceiling case for Sonnet: the control catches it. The three negatives (`congruence-test-only-with-helper`,
  `congruence-description-command-paths-resolve` and `congruence-documented-unused-allow-failure`) were "not run":
  `bench-verifier` skips a case with no expected finding and no pillar result, so they remain unmeasured.
- Pillar fixtures that moved into the fixture table on 2026-11-27 (rules and correctness runs above, 3 attempts per arm):
  `correctness-preexisting-sibling-gap` and its positive twin `correctness-introduced-sibling-gap`;
  `correctness-eslint-destructure-crash` and `correctness-eslint-destructure-guarded`;
  `correctness-unanalyzable-conditional-skip` and `correctness-unanalyzable-skip-swallows`;
  `correctness-selection-alias-escapes` and `correctness-selection-alias-invalidates`;
  `correctness-stated-purpose-human-gate`; `rules-rule-effect-absent`. Every positive is caught 3 of 3 with skills and 3
  of 3 without, so all five are ceiling cases; no negative drew a `high` or `blocking` finding with skills.
- Not in the table: the stale-document expectation of `vouchington-6166-f684113f` (a requirements
  line outside the diff that the change makes false). Measured on 2026-11-23 with the verifier
  alone, counted by reading the findings: Sonnet 3 of 3 and Opus 2 of 2 with the list of
  document lines in the prompt as shipped, against Sonnet 0 of 3 in the same session with the
  list in a file only.

Shared context alone (`bench-context`, no model, 13 tagged synthetic cases and 3 history cases;
2026-11-27, after the split into the `ratchet-*` plugins): is what a case depends on in the context a review builds?

| Check                                           | Result                                       |
| ----------------------------------------------- | -------------------------------------------- |
| Expected skills quoted in full / in part / none | 8 / 1 / 5                                    |
| Expected rule text in the excerpt               | 9 present, 3 cut, 1 missing, 0 not installed |
| Most quoted from one skill                      | 5,630 of 6,000 characters                    |
| History and linked-regression checks            | 5 of 5 found                                 |

- The rules that were cut are in prose or long skills (`postgres-locking` once, `bounded-iteration`,
  `github-actions-rules`), which are never quoted whole; the `bounded-iteration` case also names `queue-rules`, which
  holds the sibling rule in full.
- **Broken tag:** `lock-scope-ancestor-locks` reports its rule missing. Its `expectedRules` text ends "to serialize
  writers", and the installed `postgres-locking` skill now wraps that line after "serialize", so the verbatim
  substring no longer matches (it was present on 2026-11-22). The rule is still in the skill; the tag needs a shorter
  substring, which this run did not change.
- It does not measure whether a pillar uses the excerpt, only that the text is there to use.
  Rule text is checked against the plugin versions installed when it ran.

Answer cases (`answers.json`, `bench-verifier` only), measured 2026-11-27, Sonnet as the verifier, three attempts: `answers-like-row-lock` 3 of 3 with rules and 0 of 3 without (the answers without rules lack the rule citation the case expects); `answers-floating-promise` 3 of 3 with rules (no answer, and the verifier raised the floating promise itself, 1 finding in each attempt; not run without rules on 2026-11-27, 3 of 3 in both arms on 2026-11-23) ([history](HISTORY.md)). Each lists another
reviewer's open note, as the verifier prompt renders it, and the outcome expected for that note,
graded by code and reported per thread. The pillar benches do not run this file.

| Case                       | Note                                                                             | Expected                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `answers-like-row-lock`    | asks for `SELECT ... FOR UPDATE` on the parent row of an append-only vote insert | an answer that cites `ratchet-backend:postgres-locking`                       |
| `answers-floating-promise` | says a try/catch cannot catch a send that is never awaited (true)                | no answer, and the verifier raises the defect itself as a correctness finding |

- Both are not measured. Neither has a control: the first needs the rule skill to pass, so run
  it with and without `--no-rules` to see that.
- A note whose thread already holds a reply from the reviewer is filtered before the prompt
  (`answerableThreads`), so a case file, which lists notes after that filter, cannot express it;
  a unit test covers it instead.

Follow-up cases (`followups.json`, `bench-verifier` only), measured 2026-11-27, Sonnet as the verifier, three attempts, no control arm and no `main` arm (`main` cannot take the input): 15 of 15 earlier-finding verdicts as expected, and `followup-fixed-new-defect` raised its new defect 3 of 3 ([history](HISTORY.md)). Each case gives the verifier this machine's earlier review, the findings still open as threads, and the since-diff (the fixture's `reviewed/` tree against `head/`), through the builders `review` uses. The verdict on each earlier finding is graded by code from `fixedThreadIds`. The pillar benches do not run this file.

| Case                        | Earlier finding and since-diff                                                                            | Expected                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `followup-fixed`            | `applyDiscount` has no bound on the percentage; the since-diff adds the clamp                             | the thread fixed, nothing raised             |
| `followup-still-present`    | the same finding; the since-diff clamps only in a new display helper and leaves `applyDiscount` as it was | the thread left open, nothing raised         |
| `followup-fixed-new-defect` | the same finding; the since-diff adds the clamp and a cache keyed by the percentage alone                 | the thread fixed and the cache defect raised |
| `followup-mixed`            | two findings (the bound, and an unawaited write); the since-diff fixes only the first                     | the first thread fixed, the second left open |

- All four are ceiling cases for Sonnet. They check that the follow-up input is built and graded, not how much margin the
  verifier has, and a still-present finding is graded only as "not reported fixed". Not covered: findings with no thread,
  an unposted earlier review, held evidence, the pillars' follow-up prompt and mined heads.

Focus cases (`synthetic.json`, `bench-focus`): **measured on the 10 synthetic cases on 2026-11-27 at `7354b0b` (the focus step prefixes `_contract.md`, which #233 changed): 30 of 33 points over three attempts (11, 9 and 10 of 11), Sonnet, $3.23, no control arm.** The misses: `focus-target-untraced-reported` held 1 of 3 (the step answered `does_not_hold` from a shape the case allows, 7 of 9 earlier), and `focus-hostile-point` 2 of 3 (one attempt answered `does_not_hold` instead of `not_checked`). The mined focus cases were not run and are stale. `bench-focus` runs the real
requester-focus step (`runFocus` with computed `Change facts`) on every case declaring `focus`
points, and grades each point deterministically against its `expectedStatus` (`holds`,
`does_not_hold`, or `not_checked`, plus zero findings when `expectNoFindings` is set).

| Case                              | Points checked                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focus-fact-decides`              | 240-line added file vs 200-line cap (`does_not_hold`) and 4-line file under 50 (`holds`)                                                           |
| `focus-hostile-point`             | inert instruction telling the reviewer to approve (`not_checked`, 0 findings)                                                                      |
| `focus-unanswerable`              | production p99 latency metric absent from the tree (`not_checked`)                                                                                 |
| `focus-plain-holds`               | `clamp` throws `RangeError` when `min > max` (`holds`)                                                                                             |
| `focus-plain-fails`               | `parseTimeoutMs` rejects zero and negative numbers (`does_not_hold`)                                                                               |
| `focus-target-guard-needed`       | The `unneeded-concurrency-guard` target stays quiet when the guard is needed (`holds`, no finding)                                                 |
| `focus-target-untraced-reported`  | The `untraced-name-passes` target stays quiet when the check reports what it cannot trace (`holds`, no finding)                                    |
| `focus-target-undecided-skipped`  | The `undecided-input-passes` target finds a new opt-in check that passes a parse failure, an expression value and a missing file (`does_not_hold`) |
| `focus-target-undecided-reported` | The `undecided-input-passes` target stays quiet when the check reports each of them as could-not-analyse (`holds`, no finding)                     |
| `focus-target-sibling-fixed`      | The `sibling-keeps-old-shape` target stays quiet when every query in the export is fixed (`holds`, no finding)                                     |

`focus-target-sibling-fixed` (`sibling-keeps-old-shape`) is the false-alarm check, piloted on Claude Sonnet 2 of 2 attempts, and the mined case below 1 of 1 (see `HISTORY.md`); pilots, not rates.

`focus-target-undecided-skipped` and `focus-target-undecided-reported` (`undecided-input-passes`) were piloted once each on Claude Sonnet (skipped 1 of 1; reported 1 of 5, passing only after fixture repairs, see `HISTORY.md`); they are pilots, not rates. Both fixtures have since pinned `yaml` 2.8.3 on both sides and were not re-run after that edit (see the 2026-11-27 `HISTORY.md` entry).

A case may set `focusRefs`, an object from pull request number to a full 40-character commit
(`{ "3963": "236cad49..." }`). When a requester point names another pull request (`#123`, `PR 123`,
`pull request 123`), the real step reads that pull request's changed files from git; `focusRefs`
pins which commit it reads instead of the live `refs/pull/<n>/head`, and `bench-focus` fetches the pin
into the case's cache. Mined case `no-mistakes-4006` uses it (a requester point names 3963, which
changes 16 of the same files); piloted 3 of 3 (see `HISTORY.md`).

Mined case `vouchington-6656-12fe22b` in `cases.json` (positive, correctness; the first commit of vouchington #6656, which fixed the optional cursor in `processTopicMergeAliasPage` and left `snapshotTopicMergeAliases` in the same flow unfixed) declares `target: "sibling-keeps-old-shape"` (expected `does_not_hold`; 1 of 1). Its `body` is the description as it read at that head (recovered from the pull request's edit history).

Mined case `vouchington-6282` in `cases.json` also declares a target focus entry
(`target: "unneeded-concurrency-guard"`, expected `does_not_hold`); piloted only (2 of 3). `no-mistakes-3963` and
`no-mistakes-3963-f282a5d` declare `target: "untraced-name-passes"` (expected `does_not_hold`; 3 of 3
each, see `HISTORY.md`). The quiet pair `focus-target-untraced-reported` scored 7 of 9. `no-mistakes-3973` and
`no-mistakes-4024` declare `target: "clean-code-newly-reports"` (expected `does_not_hold`; 9 of 10 and
3 of 4 in its own call, see `HISTORY.md`); `no-mistakes-3963` also declares it expecting `holds`. `harness-plugins-103-18656f8` and `harness-plugins-103`
declare `target: "peers-stand-down"` (`does_not_hold` and `holds`; 3 of 3 each). `no-mistakes-4024-19e1e46` and
`no-mistakes-3973-0f1513f` declare `target: "clean-code-newly-reports"` expecting `does_not_hold`
with a `basisPattern`, and are current misses (0 of 4 and 1 of 4). A case with `focusOnly: true` is graded only by its focus points and is left out of every
pillar run. `no-mistakes-3963-eedd0e5` holds three requester points from a follow-up head (two `holds`, one `does_not_hold` with a `basisPattern`; 6 of 9 points over three attempts). `no-mistakes-3973-e0c9a77` holds two requester points on a later head of the same change, both expected `does_not_hold` for one defect the focus step did not find (0 of 6 points over three attempts). `no-mistakes-4024-7a3dc0a` holds one requester point, expected `does_not_hold`: the change newly reports arrays that cannot be empty, and the focus step answered `holds` from the fixtures (0 of 3 points over three attempts).

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

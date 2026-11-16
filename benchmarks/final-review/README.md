# Final review benchmarks

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

This repository is public, so `cases.json` holds only cases from public repositories. Keep cases
from private repositories in a private location and pass that file with `--cases`.

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
`synthetic.json` holds the fixture cases (currently the `lock-scope-*` evals for the correctness
pillar's lock-scope rule). It is separate from `cases.json` so that file keeps its mix of mined
public pull requests and negatives at about a third; run it with `--cases
benchmarks/final-review/synthetic.json`. A fixture must be synthetic: never copy private code.

Labels are written by people or agents from the revert and fix history. Add cases by mining new
reverts and regression fixes, and keep negatives at roughly a third of the set.

### Rule sources

Every run stages rule sources into `.final-review/rules/` with the same code `prepare` uses: the
fixture's `base/` instructions and skills (a mined case's head, since its base is not exported),
the shared rule skills from the clones under `--clones` (default `FINAL_REVIEWER_CLONE_ROOT`; it
needs `no-mistakes` and `skills`, the jonathanong/skills clone), and fixture dependencies from `repos/`. The pillar
prompt points at `rules/INDEX.md`. `--no-rules` stages nothing, for control runs that check a case
needs its rule source to be caught. The rules digest is part of the cache key.

Pillar runs also get the `Skill` tool, so they can load installed plugin rule skills as a review
session can; `--no-rules` withholds it. `--no-shared` stages the repository and dependency rules
but not the shared clones, which measures whether installed skills are found by description
alone. Each raw result records the enabled plugins and their versions (`plugins`) beside the rules
digest, so a score change can be traced to a rule change. Every staged skill's markdown files under
`references/`, at any depth, are staged with it.

The `rules-*` cases in `synthetic.json` test the rules pillar: a shared no-mistakes rule
(`rules-shared-error-text`), a shared `skills` repository skill (`rules-skills-sweep-until-empty`),
a dependency's rules for callers (`rules-dependency-flag-key`), a repository rule that overrides a
shared one (`rules-local-override`, negative), and a compliant dependency call
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
sources as `bench` (`--clones`, `--no-rules`, `--no-shared`, with the same meaning), and the
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

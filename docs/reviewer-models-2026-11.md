# Reviewer models and pipeline misses: field notes, 2026-11-24 to 2026-11-26

A point-in-time record from the second review machine, written up when that machine was shut
down on 2026-11-26. It ran the pipeline on agy (Gemini) models and checked each review against a
hand check and a Codex shadow. Every number here is anecdotal: one or two attempts per pull
request, not a `bench` run. For measured results see
[`benchmarks/review/README.md`](../benchmarks/review/README.md).

## Summary (everyone)

- **The cheap pipeline is right on simple pull requests.** agy pillars with an agy verifier, at
  about $0.005 to $0.01 a review, matched the hand check on test-only, CI-only, docs and pure
  refactor changes.
- **It approves wrongly on dense analysis and rule changes.** On analysis pull requests the
  pipeline's Approve was wrong in 5 of 8 cases. Claude Sonnet as the verifier failed the same
  way. Codex `gpt-6.2-sol` (medium), run by hand as a shadow, caught each miss. The misses needed
  an adversarial input traced into helper code that the diff calls.
- **Severity ran high.** Six of twelve pipeline findings in one batch were lowered or dropped,
  mostly because the verifier did not ask whether the base branch already behaved the same way.
  #195 has since addressed that.
- **Decided 2026-11-27:** analysis and rule pull requests on no-mistakes get an Opus verifier,
  since this machine has no Sol quota. See [Owner decisions](#owner-decisions-2026-11-27).

## Recommendations as of 2026-11-24 (engineering)

| Step                     | Live candidate                 | Fallback                                        | Shadow           | Why                                                                      |
| ------------------------ | ------------------------------ | ----------------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| Pillars, focus           | agy `gemini-4-hydrogen-medium` | Claude Sonnet                                   | Codex Sol medium | Found the planted bug with no false alarm on the bench                   |
| Verifier, approval check | agy `gemini-4-neon-medium`     | Claude Sonnet                                   | Codex Sol medium | agy's strongest tier; the verifier decides the verdict                   |
| History pillar, evidence | Claude Sonnet                  | none                                            | none             | Both need shell, which the agy, Codex, Grok and OpenCode adapters refuse |
| Skill selection          | Claude Haiku                   | none                                            | none             | Already cheap                                                            |
| Per-PR hand check        | Codex Sol medium               | Codex `gpt-6.1-terra` for docs, CI or test-only |                  | Sol alone caught the exit 0 to 2 break on no-mistakes #4015              |

- Don't use agy Hydrogen for the final verdict. On #4015 it saw the exit-code change and called
  it harmless.
- agy pipeline alone is enough for test-only, CI-only, docs and pure refactors. For analysis or
  planner pull requests, run a Sol shadow before posting an Approve.

## Model scorecard (engineering)

| Model                          | Role tested          | Verdict so far                             | Evidence                                                                                                                                                                         |
| ------------------------------ | -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex `gpt-6.2-sol` medium     | Whole-PR shadow      | Strongest non-Claude reviewer              | #4015 exit 0 to 2 break and broken description commands; #4047 unused entries that newly fail; about 6 lexer bugs on #4062; about 12 edge cases on pr-shepherd #832 (8 verified) |
| Codex `gpt-6.1-terra` medium   | Whole-PR shadow      | Mixed                                      | #4015: saw the break and dismissed it. Fine on refactors                                                                                                                         |
| agy `gemini-4-hydrogen-medium` | Pillars              | Good at finding bugs, lenient on judgement | Bench: planted bug found, clean case quiet. #4015 whole-PR: approved the break. Overrates pre-existing gaps (#4118)                                                              |
| agy `gemini-4-neon-medium`     | Verifier             | Matches Sonnet on the one PR compared      | #4015: same findings, severity and verdict as a Sonnet verifier. Once caught a wrong claim from the PR's own benchmark table (#4087)                                             |
| Claude Sonnet                  | Pillars and verifier | Baseline                                   | #4015: approved and missed the exit 0 to 2 break                                                                                                                                 |
| Codex `gpt-6.2-terra`          | —                    | Unavailable                                | Not offered on a ChatGPT account                                                                                                                                                 |
| Grok, OpenCode                 | —                    | Not tried                                  | Adapters refuse web and shell; Grok was out of quota                                                                                                                             |

## Model tracker by step, as of 2026-11-25 (engineering)

| Step                               | Model                  | Usable?                                    | Blocker                                                                                                                           | Use it for                                         |
| ---------------------------------- | ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Skill selection                    | Claude Haiku           | Yes, the default                           | —                                                                                                                                 | Keep                                               |
| Skill selection                    | agy Hydrogen           | Not tried                                  | A `--model` override cannot mark `readsOutsideCheckout`, so agy refuses                                                           | Try once config allows it                          |
| Rules, design, blast-radius, focus | agy Hydrogen medium    | Yes                                        | —                                                                                                                                 | Default for these pillars                          |
| Correctness, security              | agy Hydrogen medium    | Yes on jonathanong; was not on vouchington | vouchington grants a web host (AWS docs), which agy refused; #196 (2026-11-25) allows granted hosts. Not rechecked on vouchington | Default once rechecked                             |
| History                            | Claude Sonnet          | Yes                                        | Pinned to Claude; agy not tried                                                                                                   | Try agy                                            |
| Verifier, approval check           | agy Neon medium        | Same as correctness                        | Same web-host refusal                                                                                                             | Default, with a Sol shadow on analysis or rule PRs |
| Evidence                           | Claude Sonnet          | Yes                                        | Needs shell                                                                                                                       | Sonnet only                                        |
| Shadow                             | Codex Sol medium       | By hand only                               | The Codex adapter refuses web access; quota on one account                                                                        | Analysis or rule PRs before an Approve             |
| Judge (evals)                      | Claude Opus, Codex Sol | Evals only                                 | Cost; owner rule: no large models in reviews                                                                                      | Judge only                                         |

## Where the pipeline missed (engineering)

- **Indirect behaviour changes.** A change that newly reports, or newly fails, through an exit
  code or a config audit (#4015, #4047, #4067). Both verifiers missed these.
- **Adversarial inputs in analysis code.** Planner narrowing with a soundness gap (#4057), a
  malformed npm lockfile that selects nothing (#4051), lexer shapes (#4062), hidden findings
  (#4024). Prompt wording did not fix these: after #185, #4067 still came back Approve.
- **Description commands.** Commands quoted in a description whose paths cannot resolve (#4015).
  The pipeline doesn't run or resolve them. #184 adds the eval case. The synthetic case is
  easier than the real miss, which sat in a long description over a large diff.
- **Sibling call sites.** On vouchington #6656 the fix was reviewed, but the same optional-cursor
  shape in `snapshotTopicMergeAliases` was not.
- **Dependency bumps.** On #6668 a patch bump brought in `@atproto/oauth-types` 0.8.0, a pre-1.0
  release marked breaking. Only a hand diff of the published packages showed it.
- **Silent passes in new rules.** Recall rose to 5 of 6 when the focus quoted the repository's
  own principle ("uncertain inputs follow the unanalyzable policy", `docs/why.md`). #186 added
  the `undecided-input-passes` target for this class.

## Where the pipeline beat the hand check (engineering)

- no-mistakes #4120 (a high), #4062, #4064, #4051, #4137 (a crash on nested destructuring), and
  vouchington-machines #230 (a refusal thrown before the `--agent` filter).
- vouchington #6500: a description still claiming a real-config test after the test switched to
  a fake, and an assertion that could not fail. The congruence check earns its cost on test-only
  pull requests.

## What has shipped since (engineering)

| Journal finding                                                                                       | Change                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| agy refused shell in headless mode                                                                    | #181: agy steps say no shell and report denied actions                                           |
| A model id with an effort suffix plus `--effort` failed every pillar, and a step did not fall back    | #182                                                                                             |
| Description commands with unresolvable paths                                                          | #184, an eval case (easier than the real miss)                                                   |
| Undocumented behaviour changes rated high                                                             | #185: rated medium, four benchmark cases (ceiling cases: the no-rules control also catches them) |
| Silent passes in new analyzers                                                                        | #186: the `undecided-input-passes` target                                                        |
| Verifier keeps highs that main already has, findings about documented limits, false convention claims | #195: verifier step 2 drops documented limits, rates against the base, checks convention claims  |
| agy ran with unrestricted network                                                                     | #196: every agy step gets a host allowlist                                                       |
| No light review of a merge from the base                                                              | Already present since #52 (2026-11-19), but only on top of the same machine's earlier review     |

## Owner decisions, 2026-11-27

Recorded when this page was written. Follow-up work is tracked in pull requests, not here.

| Question                                      | Decision                                                                                                                                   | Change         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| A stronger verifier for analysis and rule PRs | Sol or Opus is fine. This machine has no Sol quota, so the no-mistakes verifier and approval check run on Opus with Sonnet as the fallback | Machine config |
| Explorer model                                | Cheap explorer-level models, such as Haiku                                                                                                 | Machine config |
| Many medium findings                          | High and medium never block; a design question gives Comment                                                                               | None           |
| Undeclared breaking change                    | Request Changes until the PR declares it or the author acknowledges it, then medium                                                        | #216           |
| A gap the base already has                    | Not blocking; the author fixes it or tracks it in an issue                                                                                 | #216           |
| Requester check lists                         | Pass them to the focus step                                                                                                                | #215           |
| Sibling call sites                            | Search near a fix for the old shape                                                                                                        | #217           |
| `--model` and `readsOutsideCheckout`          | Allow it from the flag                                                                                                                     | #212           |

## Process notes for hand checks (on-call)

- Clear a moved head by comparing the PR's own diff against the approved head, not by a full
  re-review. Fetch refs, then check that the old SHA exists with `git cat-file -e`. A short SHA
  passed to `git fetch` breaks silently, and a short SHA with a refspec in one fetch fails the
  whole fetch.
- Check the AST node shape in the pinned parser version before claiming a branch is missed (oxc
  0.159 parses `export { X } from` as `ExportFromDeclaration`).
- In a hand-written `review.json`, omit `path`, `line` and `side` for a finding about the whole
  pull request. An explicit `"path": null` is rejected.
- For stacked PRs, post a gap once on the base PR and point to it from the child.
- Only a push that fixes nits keeps an earlier approval. A low or medium fix needs a fresh one.

## Glossary

- **agy:** the Antigravity CLI harness, running Gemini models.
- **Shadow:** a separate whole-PR review by a stronger model, run by hand and compared with the
  pipeline before posting.
- **Analysis PR:** a change to a rule, analyzer, parser or planner, where correctness depends on
  inputs the fixtures may not cover.
- **Silent pass:** an analyzer path that returns no finding without deciding the input.

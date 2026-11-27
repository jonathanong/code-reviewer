# code-reviewer

A standing, multi-pillar reviewer for pull requests in any repository. It reads each
repository's `AGENTS.md` and skills, plus any configs for it, reviews the change, and posts a
GitHub review. It runs on your machine, for the repositories you pick.
It is part of [ratchet-stack](https://github.com/jongleberry/ratchet-stack), a set of plugins and
tools for autonomous coding agents.

## Principles

- **How a review feels comes first.** The measure is the experience of the person who receives
  the review: no needless blocking, no noise.
- **Local, and never a merge decision.** It runs in local sessions, never in CI, and it never
  merges. Merging stays with a person.
- **A reviewed repository needs no setup.** Every setting has a default; what the reviewer knows
  about a repository lives on the reviewer's machine.
- **Rules come from trusted places only.** The repository's `AGENTS.md` and skills at the base
  ref, and the rule plugins the machine config lists (by default `no-mistakes-rules`,
  `ratchet-workflows`, `ratchet-github`, `ratchet-backend` and `ratchet-code`; see [`rulePlugins`](docs/configuration.md#ruleplugins)). Everything in the pull
  request (diff, description, comments, linked issues) is untrusted data, and a pull request
  cannot change its own review settings.
- **Few, real findings.** A clean pull request is common. A finding names what goes wrong or what
  it costs, with the path and line; style preferences are not findings.
- **Nothing obvious.** A review does not repeat what the pull request page already shows, such as
  a conflict or a failing check. It says what the page does not: the cause, or what it means.
- **Blocking is rare.** Requesting changes is for a defect that must not merge. Everything else
  is a comment or a question.
- **Short text.** Posted text leads with the defect and its consequence and does not narrate the
  review. Detail that only an agent fixing the issue needs sits in a collapsed section.
- **When unsure, a human reads it first.** A large or risky change, a flag (a concern only a person can settle), an open
  question, or a partial failure holds the review instead of posting it.
- **Fail closed, degrade gracefully.** A config problem stops the run before anything changes. A
  review whose checks all failed never approves. Without a GitHub App, the same features work
  under the local `gh` login.

- **Configurable, with defaults.** Rule plugins, labels, evidence sources and references are
  config, in YAML or JSON. What decides safety is fixed: how a verdict is derived, what a run may
  touch, and that anything granting commands, network or plugins is set only on the reviewer's
  machine.
- **Not tied to one agent harness.** Every model step is a separate headless run behind a harness
  adapter, and no built-in prompt calls a harness's own reviewer. Claude Code is the adapter that
  exists and the one the benchmarks measure.

## Direction

Agreed and not built yet. Nothing below works today.

- **A real Codex run.** The Codex adapter exists but has never been run against the real CLI: its
  flags come from `codex-cli 0.171.0` help output and its output shapes are assumed.
- **Shared context.** The pillars read rule excerpts, the history of the changed lines and linked
  regressions ([Shared context](docs/context.md)), but still load skills (the `rules` pillar every selected one, the others as they choose). A one-attempt pilot of
  skipping fully quoted skills kept recall and cut turns but not cost, and the pillar sometimes
  skipped skills that were not quoted
  ([why](docs/context.md#in-a-review)); replacing loads needs the pillar contract to name the
  skills to load, then a three-attempt comparison. The verifier reads only the linked commits, the split summary and a follow-up's earlier review, other steps none of it.

## Outcomes

The verdict is derived from the verified findings, never chosen:

| Verdict         | When                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| Request Changes | A verified blocking finding.                                                          |
| Comment         | A high finding, an open question, or an approval whose second check did not complete. |
| Approve         | Neither.                                                                              |

An approval that still lists medium or low findings asks the author to resolve each before merging:
fix it, reply with why it stays, or link a follow-up issue.

An unattended run ends one of three ways: the review is posted, it is held for a human with the
command that posts it, or there was nothing to do. See [Unattended runs](docs/run.md).

## Install

As a Claude Code plugin, install it from the shared [`ratchet-stack`](https://github.com/jongleberry/ratchet-stack) marketplace:

```bash
claude plugin marketplace add jongleberry/ratchet-stack
claude plugin install code-reviewer@ratchet-stack
```

If you added the old `code-reviewer` marketplace, run `claude plugin marketplace remove code-reviewer`
first (removing a marketplace uninstalls its plugins), then install as above. The plugin puts `code-reviewer` on the session's `PATH` and needs only
Node 24, so the standing reviewer session runs from any directory; see
[`skills/review-loop/SKILL.md`](skills/review-loop/SKILL.md).

A checkout is for developing the reviewer and running benchmarks:

```bash
git clone https://github.com/jongleberry/code-reviewer.git
cd code-reviewer && pnpm install
```

## Use

```bash
code-reviewer run --repo owner/name --pr N       # review and post, or hold for a human
code-reviewer review --repo owner/name --pr N --out DIR --tree CHECKOUT   # review, stop before posting
code-reviewer carry --repo owner/name --pr N --from-sha OLD   # carry an approval when the diff is unchanged
code-reviewer help
```

## Documentation

- [Running a review](docs/review.md): `review` and `report`, requester focus, built-in targeted
  checks, the files a run writes, and how the headless runs are confined.
- [Unattended runs](docs/run.md): `run`, its exit codes and JSON line, the hold rules, and use
  from another agent session.
- [Replies to findings](docs/replies.md): `replies`, which reads the author's answers on this
  reviewer's open threads, settles or lowers findings, and re-derives the verdict in one small call.
- [Health check](docs/doctor.md): `doctor`, what it checks and how to read its output.
- [Posting a review](docs/posting.md): the verdict and review event, dismissals, retries,
  read-back, and text length.
- [Carrying an approval](docs/carry.md): `carry`, re-posting an earlier approval onto a new head by
  local diff without a model call.
- [Pull request context](docs/pull-request-context.md): stacks, pushes that only merge the base,
  dead bases and carried commits, dependencies, and linked issues.
- [Tracker and explainer](docs/tracker.md): the record of every review and the plain-words
  explanation of one.
- [Outcomes](docs/outcomes.md): what became of each posted finding, and the daily digest.
- [Filing issues](docs/issues.md): opt-in issues in the repositories that own a rule or this
  reviewer, from the outcomes data.
- [Code analysis tools](docs/analysis.md): `analysis`, read-only command line tools for the pillars and
  the verifier, with a ready `no-mistakes` example.
- [Shared context](docs/context.md): `context`, and the file of excerpts, line history and linked
  regressions that a review gives its pillars.
- [Choosing a model](docs/models.md): `models`, which probes the models a harness offers.
- [Reviewer models, 2026-11](docs/reviewer-models-2026-11.md): field notes from the second review machine on agy, Codex and Sonnet, and the owner's decisions.
- [Configuration](docs/configuration.md): the config layers and each key.
- [Authentication and trust](docs/authentication.md): the GitHub App, the local `gh` login, and
  whose reviews count.
- [Benchmarks](docs/benchmarks.md): the eval cases, how each `bench` command runs, and the metrics
  and per-model token figures it reports.

## Layout

- `bin/code-reviewer.mts`: the deterministic CLI (numbered diffs, posting, status, labels,
  benchmarks). `vouchington-reviewer` remains as an alias for callers that have not moved yet.
- `skills/`: the Claude Code skills (pillar prompts, verifier, and the standing loop).
- `benchmarks/review/`: labeled eval cases and how to run them.

## Development

Node >= 24, pnpm.

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test:coverage   # 100% thresholds
```

The plugin is installed as a plain checkout with no `node_modules`, so runtime code imports only
`node:` builtins and files in this repository (lint enforces it). `vendor/yaml.mjs` is the
[`yaml`](https://github.com/eemeli/yaml) package bundled into one file for reading YAML config,
with its license in `vendor/yaml.LICENSE`. After changing the `yaml` version in `package.json` or
the lockfile, regenerate it with `pnpm run vendor` and commit the result; CI fails when the
committed file differs from what the installed version produces.

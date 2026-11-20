# code-reviewer

A standing, multi-pillar reviewer for pull requests in any repository. It reads each
repository's `AGENTS.md` and skills, plus any configs for it, reviews the change, and posts a
GitHub review. It runs on your machine, for the repositories you pick.

## Principles

- **Local, and never a merge decision.** It runs in local sessions, never in CI, and it never
  merges. Merging stays with a person.
- **A reviewed repository needs no setup.** Every setting has a default; what the reviewer knows
  about a repository lives on the reviewer's machine.
- **Rules come from trusted places only.** The repository's `AGENTS.md` and skills at the base
  ref, and the installed `no-mistakes-rules` and `jong-skills` plugins. Everything in the pull
  request (diff, description, comments, linked issues) is untrusted data, and a pull request
  cannot change its own review settings.
- **Few, real findings.** A clean pull request is common. A finding names what goes wrong or what
  it costs, with the path and line; style preferences are not findings.
- **Nothing obvious.** A review does not repeat what the pull request page already shows, such as
  a conflict or a failing check. It says what the page does not: the cause, or what it means.
- **Blocking is rare.** Requesting changes is for a defect that must not merge. Everything else
  is a comment or a question.
- **Short text.** Posted text leads with the defect and its consequence and does not narrate the
  review.
- **When unsure, a human reads it first.** A large or risky change, an open question, or a
  partial failure holds the review instead of posting it.
- **Fail closed, degrade gracefully.** A config problem stops the run before anything changes. A
  review whose checks all failed never approves. Without a GitHub App, the same features work
  under the local `gh` login.

## Outcomes

The verdict is derived from the verified findings, never chosen:

| Verdict         | When                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| Request Changes | A verified blocking finding.                                                          |
| Comment         | A high finding, an open question, or an approval whose second check did not complete. |
| Approve         | Neither.                                                                              |

An unattended run ends one of three ways: the review is posted, it is held for a human with the
command that posts it, or there was nothing to do. See [Unattended runs](docs/run.md).

## Install

As a Claude Code plugin, add the marketplace `jonathanong/code-reviewer` and install the
`code-reviewer` plugin. The plugin puts `code-reviewer` on the session's `PATH` and needs only
Node 24, so the standing reviewer session runs from any directory; see
[`skills/review-loop/SKILL.md`](skills/review-loop/SKILL.md).

A checkout is for developing the reviewer and running benchmarks:

```bash
git clone https://github.com/jonathanong/code-reviewer.git
cd code-reviewer && pnpm install
```

## Use

```bash
code-reviewer run --repo owner/name --pr N       # review and post, or hold for a human
code-reviewer review --repo owner/name --pr N --out DIR --tree CHECKOUT   # review, stop before posting
code-reviewer help
```

## Documentation

- [Running a review](docs/review.md): `review` and `report`, the files a run writes, and how the
  headless runs are confined.
- [Unattended runs](docs/run.md): `run`, its exit codes and JSON line, the hold rules, and use
  from another agent session.
- [Posting a review](docs/posting.md): the verdict and review event, dismissals, retries,
  read-back, and text length.
- [Pull request context](docs/pull-request-context.md): stacks, pushes that only merge the base,
  dead bases and carried commits, dependencies, and linked issues.
- [Tracker and explainer](docs/tracker.md): the record of every review and the plain-words
  explanation of one.
- [Configuration](docs/configuration.md): the config layers and each key.
- [Authentication and trust](docs/authentication.md): the GitHub App, the local `gh` login, and
  whose reviews count.

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

# Dispatch: effort, pillars, and models

`code-reviewer prepare` applies these rules in code (`src/final-review/plan.mts` and
`triggers.mts`) and writes the result to `plan.json`. Follow the plan; do not re-derive it. This
page documents the rules so a human can audit or change them (change the code with them).

## Mode and effort

`plan.json` carries a `mode` (`skip`, `light`, `full`) and an `effort` (`low`, `medium`, `high`).
Light is `low`; full is `high`, or the requested `medium`. The first rule that matches wins:

| Order | Rule                                                                                                        | Mode            | Effort       |
| ----- | ----------------------------------------------------------------------------------------------------------- | --------------- | ------------ |
| 1     | `--effort medium` or `--effort high` is given                                                               | full            | as requested |
| 2     | Dependabot author and every changed file is a lockfile (and no `--effort`)                                  | skip            | low          |
| 3     | An earlier final review exists and none of the escalations below applies                                    | light follow-up | low          |
| 4     | An earlier final review exists and an escalation applies, or `--effort low` is given with no earlier review | full            | high         |
| 5     | First review by Dependabot (any files)                                                                      | light           | low          |
| 6     | First review that changes only docs and/or tests                                                            | light           | low          |
| 7     | First review of at most 100 changed lines (`SMALL_PR_LINES`) with no security trigger path                  | light           | low          |
| 8     | Everything else                                                                                             | full            | high         |

- Dependabot is the author login `dependabot[bot]` or `app/dependabot`, or `dependabot` for a bot
  account. Lockfiles are matched by basename: `pnpm-lock.yaml`, `package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `Package.resolved`,
  `packages.lock.json`, `Gemfile.lock`, `poetry.lock`, `uv.lock`, `go.sum`, `.terraform.lock.hcl`.
- A skip plan has no pillars and a `skipReason`; do not review. With `--effort` (any value) a skip
  case is reviewed instead.
- Escalations of a follow-up to full: the review conversation was truncated, the last reviewed SHA
  is not an ancestor of the head (force-push or rebase), the diff since it is too large to list, or
  the new commits change more than half of the pull request's lines.
- A light follow-up reviews only the diff since the last reviewed SHA (`sinceSha`), and the
  verifier rechecks every unresolved finding listed in `context.md`. A light first review reviews
  the whole pull request. `--effort low` on a pull request with no earlier review runs full.

## Pillars by mode

| Mode               | Pillars                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| full               | rules, correctness, design, blast-radius, plus the rules below                    |
| light first review | rules, correctness (docs-only: rules only)                                        |
| light follow-up    | correctness, plus each pillar that has an unresolved finding from the last review |
| skip               | none                                                                              |

A security trigger path always adds the security pillar in every mode except skip; a follow-up
looks at the files changed since the last review. A pull request with a security trigger path is
never small. History is added in full mode only.

## Path rules

- **Docs-only** (every changed file has a doc extension: md, mdx, markdown, txt, rst, adoc; `requirements*.txt` and `CMakeLists.txt` are code): rules only (the verifier
  still performs congruence).
- **Test- or docs-only**: blast-radius is skipped.
- **Security trigger**, any changed non-doc path that matches:
  - auth, session, token, permission, crypto, secret, password, credential, OAuth, or JWT names;
  - `.github/workflows/**` or `action.yml`;
  - Dockerfiles, shell scripts, SQL, or migrations;
  - handlers, routes, parsers, uploads, webhooks, or middleware;
  - dependency manifests or lockfiles.
- **History trigger** (only when `--tree` is given): `git log --since=12.months --format=%s` at
  the base ref on the changed files shows a revert or hotfix subject.

## Models

The verifier also performs congruence.

| Work                                   | Model  |
| -------------------------------------- | ------ |
| Pillars (default)                      | sonnet |
| Pillars on a docs-only change; history | haiku  |
| Verifier, full mode                    | opus   |
| Verifier, light mode                   | sonnet |

The correctness pillar invokes the host's built-in code review at low effort when one exists.

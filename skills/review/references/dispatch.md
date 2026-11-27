# Dispatch: effort, pillars, and models

`code-reviewer prepare` applies these rules in code (`src/review/plan.mts` and
`triggers.mts`) and writes the result to `plan.json`. Follow the plan; do not re-derive it. This
page documents the rules so a human can audit or change them (change the code with them).

## Mode and effort

`plan.json` carries a `mode` (`skip`, `light`, `full`) and an `effort` (`low`, `medium`, `high`).
Light is `low`; full is `high`, or the requested `medium`. The first rule that matches wins:

| Order | Rule                                                                                                                                 | Mode            | Effort       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------ |
| 1     | `--effort medium` or `--effort high` is given                                                                                        | full            | as requested |
| 2     | Dependabot author and every changed file is a lockfile (and no `--effort`)                                                           | skip            | low          |
| 3     | An earlier review exists and none of the escalations below applies                                                                   | light follow-up | low          |
| 3a    | An earlier review exists and the push since it is `base-merges-only` or `rebase-same-change`                                         | light push      | low          |
| 3b    | No posted review, but this machine finished one it never posted, and the push since it is `base-merges-only` or `rebase-same-change` | light push      | low          |
| 4     | An earlier review exists and an escalation applies, or `--effort low` is given with no earlier review                                | full            | high         |
| 5     | First review by Dependabot (any files)                                                                                               | light           | low          |
| 6     | First review that changes only docs and/or tests                                                                                     | light           | low          |
| 7     | First review of at most 100 reviewable lines (`SMALL_PR_LINES`) with no security trigger path                                        | light           | low          |
| 8     | Everything else                                                                                                                      | full            | high         |

- Dependabot is the author login `dependabot[bot]` or `app/dependabot`, or `dependabot` for a bot
  account. Lockfiles are matched by basename: `pnpm-lock.yaml`, `package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `Package.resolved`,
  `packages.lock.json`, `Gemfile.lock`, `poetry.lock`, `uv.lock`, `go.sum`, `.terraform.lock.hcl`.
- Line counts leave out generated files: lockfiles, `*.min.js`, `*.min.css`, `*.map`, `*.snap` and
  `__snapshots__/`, anything under `dist/`, `build/`, `generated/`, `__generated__/`, `vendor/` or
  `node_modules/`, and `*.generated.*`, `*.gen.*`, `*.pb.go`, `*_pb2.py`. The small-pull-request
  threshold and both sides of the follow-up "more than half" comparison use these reviewable lines
  (`context.md` still shows the raw total). A generated file with a security trigger name does not
  make a pull request non-small. A pull request that changes only generated files and is not from
  Dependabot has 0 reviewable lines, so it is reviewed light, not skipped.
- For a Dependabot pull request, manifests, lockfiles and workflow files (`.github/workflows/*.yml`)
  are not security triggers (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`,
  `requirements*.txt`, `Gemfile`, `*.csproj`, `Package.swift`); any other trigger path still adds
  the security pillar.
- A Dependabot pull request that changes only lockfiles is skipped, unless `prepare` staged
  `upgrades/INDEX.md` (the `upgrades` setting is on and a changed package is auth or security or a
  pre-1.0 minor); it is then reviewed light.
- A skip plan has no pillars and a `skipReason`; do not review. With `--effort` (any value) a skip
  case is reviewed instead.
- Escalations of a follow-up to full: the last reviewed SHA
  is not an ancestor of the head (force-push or rebase), the diff since it is too large to list, or
  the new commits change more than half of the pull request's lines.
- A push is classified in `prepare` with git in the `--tree` checkout and written to `push.json`.
  `base-merges-only`: every new first-parent commit since the last reviewed SHA is a merge whose
  other parents are all already in the base. `rebase-same-change`: the reviewed SHA is not an
  ancestor of the head, but the pull request's own change against the base (the diff from the fork
  point, ignoring line numbers and blob ids) is the same before and after. Anything else, and any
  case git cannot answer (no checkout, commit missing, git older than 2.36, more than 20 merges, a
  resolution too large to list), is `substantive` with the reason in `problems`.
- A light push (rule 3a) is exempt from the escalations below: the size of what came in from the
  base and an unreachable reviewed SHA do not make it full. `--effort` still applies. It has two jobs: judge each merge resolution (`git show
  --remerge-diff`, the part of the merge a person had to write) or the range-diff of a rewrite,
  and decide whether what came in from the base breaks the pull request's own change. A clean
  merge with nothing resolved has only the second job. A non-empty resolution is never skipped. It
  reviews no diff since a SHA (`sinceSha` is null); `merges/INDEX.md`, `incoming/INDEX.md` and
  `range-diff.txt` in the run directory carry the material.
- A `substantive` push is routed as before. Its merge resolutions are still written, and the
  correctness pillar and the verifier are told to read them.
- `prepare` also asks local history (in the `--tree` checkout) which commits of the pull request
  already exist in the default branch (same commit, same patch, or the same file contents as a
  squash merge), in a parent of its stack, or in an older open pull request, and whether its base
  branch still exists or was merged. It writes `carried.json` only when it found something. The
  pillars and the verifier get a Carried changes block and raise no finding on carried changes; the
  dead base and the carried commits are reported once as a note in the posted review and the
  report. Anything that cannot be proved is the pull request's own, reviewed in full.
- A light follow-up reviews only the diff since the last reviewed SHA (`sinceSha`), and the
  verifier rechecks every unresolved finding listed in `context.md`. A light first review reviews
  the whole pull request. `--effort low` on a pull request with no earlier review runs full.

## Pillars by mode

| Mode               | Pillars                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| full               | rules, correctness, design, blast-radius, plus the rules below                     |
| light first review | rules, correctness (docs-only: rules only)                                         |
| light follow-up    | correctness, plus each pillar that has an unresolved finding from the last review  |
| light push         | correctness; security only when a merge resolution touched a security trigger path |
| skip               | none                                                                               |

A security trigger path always adds the security pillar in every mode except skip; a follow-up
looks at the files changed since the last review. A pull request with a security trigger path is
never small. History is added in full mode only.

## Path rules

- **Docs-only** (every changed file has a doc extension: md, mdx, markdown, txt, rst, adoc; `requirements*.txt`, `CMakeLists.txt` and agent instruction files are code): rules only (the verifier
  still performs congruence). An instruction file is `SKILL.md`, `AGENTS.md`, `CLAUDE.md`, or an `.md` under a `skills/`, `agents/`, `plugins/` or `.claude/` directory at any depth: it changes what an agent does, so it is reviewed as code. It never triggers the security pillar by its name.
- **Follow-up that changes source**: when the new commits change hand-written source (not tests, docs or generated files) in more than `plan.followUpSourceLines` lines (default 40), the follow-up is a full review at high effort, not a light one.
- **SQL**: a small pull request that changes a `.sql` file, a path under `migrations/`, or a path matching `plan.sqlPaths` is a full review, not a light one.
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

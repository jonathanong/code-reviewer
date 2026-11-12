# Dispatch: effort, pillars, and models

`vouchington-reviewer prepare` applies these rules in code (`src/final-review/plan.mts` and
`triggers.mts`) and writes the result to `plan.json`. Follow the plan; do not re-derive it. This
page documents the rules so a human can audit or change them (change the code with them).

## Effort

| Effort           | When                                                  | Diff reviewed               | Pillars                                                                           |
| ---------------- | ----------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| `high` (default) | First review of a pull request, or the requester asks | Full pull request           | Every pillar the rules below select                                               |
| `medium`         | Requester asks                                        | Full pull request           | Same selection as high                                                            |
| `low`            | Default for a follow-up after a final review          | Since the last reviewed SHA | correctness, plus each pillar that has an unresolved finding from the last review |

`low` falls back to `high` when there is no earlier final review, when the last reviewed SHA is
not an ancestor of the head (force-push or rebase), or when the new commits change more than half
of the pull request's lines. At `low`, the path rules below apply to the files changed since the
last review, and the verifier rechecks every unresolved finding listed in `context.md`.

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

| Work                                                             | Model  |
| ---------------------------------------------------------------- | ------ |
| Pillars (default)                                                | sonnet |
| Pillars on a docs-only change; history                           | haiku  |
| Verifier                                                         | opus   |
| Verifier for a low-effort follow-up of at most 300 changed lines | sonnet |

The correctness pillar invokes the host's built-in code review at low effort when one exists.

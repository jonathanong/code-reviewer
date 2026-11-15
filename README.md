# vouchington-reviewer

A standing, multi-pillar final reviewer for pull requests, extracted from
[vouchington-tooling](https://github.com/vouchington/vouchington-tooling) (`final-review`).

- `bin/vouchington-reviewer.mts`: the deterministic CLI (numbered diffs, posting, status, labels,
  benchmarks). Run `pnpm exec vouchington-reviewer help`.
- `skills/`: the Claude Code skills (pillar prompts, verifier, and the standing loop).
- `benchmarks/final-review/`: labeled eval cases and how to run them.

## Repository config: `.code-reviewer.json`

A reviewed repository can hold a `.code-reviewer.json` at its root with what the reviewer cannot
work out from the diff. It is read at the pull request's base, so a pull request cannot change
its own review scope.

```json
{
  "consumes": [{ "repo": "acme/api", "via": "HTTP API", "paths": ["src/routes/**"] }]
}
```

- `consumes`: repositories this one depends on without a package import. `repo` is `owner/name`.
  `via` (optional) says how in a few words. `paths` (optional) are globs in the consumed
  repository that this one depends on; without it, any change there counts.

Only the consumer declares the link. `prepare` uses it in both directions, for repositories
cloned under the clone root (matched by their `origin` URL, or by directory name without one):

- A pull request in the consumer stages the consumed repository's instructions, skills, and code
  location as a dependency, ahead of dependencies found by import.
- A pull request in the consumed repository that touches `paths` stages the consumer under
  "Consumers" in `rules/INDEX.md`, for the blast-radius pillar.

A malformed file, an unknown key, or a declared repository with no clone is listed under
"Missing" in `rules/INDEX.md` and in `prepare`'s output; none of them stops the review.

## Authentication and trust

Calls use a GitHub App when `FINAL_REVIEWER_APP_ID` is set (with `FINAL_REVIEWER_APP_PRIVATE_KEY`
or `FINAL_REVIEWER_APP_PRIVATE_KEY_PATH`), otherwise the local `gh` login.

`claim` and `status` trust a `<!-- final-review ... -->` marker only from the identity that posts
final reviews, so a review forged by someone else cannot decline a head or report approval. That
identity is the authenticated GraphQL `viewer` plus the comma-separated logins in
`FINAL_REVIEWER_TRUSTED_AUTHORS`. An App installation token cannot query `viewer`, so under App
auth set `FINAL_REVIEWER_TRUSTED_AUTHORS=<app-slug>[bot]`; with neither, no marker is trusted and
every head is re-reviewed (status never reports approval).

Under local `gh` auth the reviewer posts as you, so the pull request author shares the trusted
identity when they are the same person. Use a GitHub App to separate the two.

## Development

Node >= 24, pnpm.

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test:coverage   # 100% thresholds
```

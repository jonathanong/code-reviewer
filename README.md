# vouchington-reviewer

A standing, multi-pillar final reviewer for pull requests, extracted from
[vouchington-tooling](https://github.com/vouchington/vouchington-tooling) (`final-review`).

- `bin/vouchington-reviewer.mts`: the deterministic CLI (numbered diffs, posting, status, labels,
  benchmarks). Run `pnpm exec vouchington-reviewer help`.
- `skills/`: the Claude Code skills (pillar prompts, verifier, and the standing loop).
- `benchmarks/final-review/`: labeled eval cases and how to run them.

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

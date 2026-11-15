# code-reviewer

A standing, multi-pillar reviewer for pull requests in any repository. It reads each
repository's `AGENTS.md` and skills, plus the per-repository configs kept here, reviews the
change, and posts a GitHub review.

- `bin/code-reviewer.mts`: the deterministic CLI (numbered diffs, posting, status, labels,
  benchmarks). Run `pnpm exec code-reviewer help`. `vouchington-reviewer` remains as an alias
  for callers that have not moved yet.
- `skills/`: the Claude Code skills (pillar prompts, verifier, and the standing loop).
- `repos/`: what the reviewer knows about each reviewed repository.
- `benchmarks/final-review/`: labeled eval cases and how to run them.

## Install

```bash
git clone https://github.com/jonathanong/code-reviewer.git
cd code-reviewer && pnpm install
```

As a Claude Code plugin, add the marketplace `jonathanong/code-reviewer` and install the
`code-reviewer` plugin. The standing reviewer session runs in this checkout; see
[`skills/final-reviewer/SKILL.md`](skills/final-reviewer/SKILL.md).

## Repository configs: `repos/<owner>/<name>.json`

Reviewed repositories carry no reviewer config. What the reviewer cannot work out from a diff
lives here, one file per repository, so any repository can be reviewed as it is.

```json
{
  "consumes": [{ "repo": "acme/api", "via": "HTTP API", "paths": ["src/routes/**"] }]
}
```

- `consumes`: repositories this one depends on without a package import. `repo` is `owner/name`.
  `via` (optional) says how in a few words. `paths` (optional) are globs in the consumed
  repository that this one depends on; without it, any change there counts.

Only the consumer's file declares the link. `prepare` uses it in both directions, for
repositories cloned under the clone root (matched by their `origin` URL, or by directory name
without one):

- A pull request in the consumer stages the consumed repository's instructions, skills, and code
  location as a dependency, ahead of dependencies found by import.
- A pull request in the consumed repository that touches `paths` stages the consumer under
  "Consumers" in `rules/INDEX.md`, for the blast-radius pillar.

A malformed file, an unknown key, or a configured repository with no clone is listed under
"Missing" in `rules/INDEX.md` and in `prepare`'s output; none of them stops the review. Set
`FINAL_REVIEWER_CONFIG_DIR` to read the configs from another directory.

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

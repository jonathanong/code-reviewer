# code-reviewer

A standing, multi-pillar reviewer for pull requests in any repository. It reads each
repository's `AGENTS.md` and skills, plus the per-repository configs kept here, reviews the
change, and posts a GitHub review.

- `bin/code-reviewer.mts`: the deterministic CLI (numbered diffs, posting, status, labels,
  benchmarks). Run `pnpm exec code-reviewer help`. `vouchington-reviewer` remains as an alias
  for callers that have not moved yet.
- `skills/`: the Claude Code skills (pillar prompts, verifier, and the standing loop).
- `repos/`: what the reviewer knows about each reviewed repository.
- `benchmarks/review/`: labeled eval cases and how to run them.

## Install

```bash
git clone https://github.com/jonathanong/code-reviewer.git
cd code-reviewer && pnpm install
```

As a Claude Code plugin, add the marketplace `jonathanong/code-reviewer` and install the
`code-reviewer` plugin. The standing reviewer session runs in this checkout; see
[`skills/review-loop/SKILL.md`](skills/review-loop/SKILL.md).

## Running a review

```bash
code-reviewer review --repo owner/name --pr N --out DIR --tree CHECKOUT [--jobs N] [--clones DIR] [--effort low|medium|high] [--force]
code-reviewer report --out DIR
```

`review` runs one pull request end to end with headless `claude -p` calls and stops before
posting, so you can read the result first. `--tree` is a checkout at the pull request head and
`--out` receives the run files; both become absolute paths. It claims the pull request (a head the
newest review already covers is declined unless `--force`), runs `prepare`, asks Haiku to pick
rule skills for the changed files, runs the pillars the plan chose (`--jobs` at a time, default 3,
each retried once), runs the verifier, and writes:

- `review.json`: the input `post` accepts. Post it after reading `preview.md`:
  `code-reviewer post --repo owner/name --pr N --head-sha SHA --input DIR/review.json`.
- `preview.md`: the reviews `post --dry-run` would send.
- `report.md` and `report.json`: the pull request, mode and effort, what it does, the verdict, the
  verified findings, and, per pillar, the model, skills loaded, cost, turns, and every raw finding
  with whether the verifier kept or dropped it and why, the total cost, and a "Tokens by model"
  table for selection, pillars (failed attempts included), and verifier. `report.md` is rendered from
  `report.json`; `code-reviewer report --out DIR` renders it again, for a running document.
- `skills.json`, `pillars/<pillar>.json`, `verifier.json`: the intermediate results.

The run prints one JSON line with the mode, verdict, finding counts, total cost, and file paths.
Labels stay at processing. A `skip` plan closes the pull request through `skip` (a short skip
review on the head, then the labels) and writes a short report. If anything fails after the claim, the claim is dropped without a requeue and the
command exits 1. A pillar that fails twice is posted as skipped with a short reason. If every
pillar fails, the review fails closed instead of approving unchecked code.

Every headless run passes `--strict-mcp-config --setting-sources user` and
`--settings '{"enabledPlugins":{...}}'` listing each enabled plugin, true only for the rule
plugins (`no-mistakes-rules`, `skills`). That keeps fixed context near 17k tokens instead of
about 139k. Pillar runs also get a read-only Haiku `explorer` subagent. The same flags apply to
`bench`, where `--no-rules` sets every plugin false.

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
`CODE_REVIEWER_CONFIG_DIR` to read the configs from another directory.

## Per-repository settings

Label names and an optional GitHub check run are set here too, per organization in
`repos/<owner>.json` (a file beside the `repos/<owner>/` directory) and per repository in
`repos/<owner>/<name>.json`. A repository's keys override its organization's.

```json
{
  "labels": {
    "requested": "final-review:requested",
    "processing": "final-review:in-progress",
    "completed": "final-review:complete",
    "approval": "final approval"
  },
  "checkRun": { "name": "Code review" }
}
```

- `labels`: each key is optional and defaults to the value shown. `requested` asks for a review,
  `processing` marks one running, `completed` marks it posted or skipped, `approval` marks an
  approved head.
- `checkRun`: absent means no check run. When set, and calls use the GitHub App, `claim` opens a
  check run at the head, `post` completes it from the verdict, and `abort` and `skip` cancel or
  skip it. Under the local `gh` login the same states are written as a commit status whose
  context is the configured name (`via` in the result says which).
- `consumes` is valid only in a repository file.

`code-reviewer settings --repo owner/name` (or `--owner LOGIN`) prints the resolved settings.
`code-reviewer skip` closes out a pull request the plan will not review: it posts one COMMENT
review on the head with a `verdict=Skipped` marker, then swaps the labels. `status` exits 0 for
a skipped head while its completed label stands (it never counts as approval and the approval label is not added), `claim`
declines it like any reviewed head unless `--force`, and a later review treats it as a first
review.

## Authentication and trust

Calls use a GitHub App when `CODE_REVIEWER_APP_ID` is set (with `CODE_REVIEWER_APP_PRIVATE_KEY`
or `CODE_REVIEWER_APP_PRIVATE_KEY_PATH`), otherwise the local `gh` login.

`claim` and `status` trust a `<!-- final-review ... -->` marker only from the identity that posts
reviews, so a review forged by someone else cannot decline a head or report approval. That
identity is the authenticated GraphQL `viewer` plus the comma-separated logins in
`CODE_REVIEWER_TRUSTED_AUTHORS`. An App installation token cannot query `viewer`, so under App
auth set `CODE_REVIEWER_TRUSTED_AUTHORS=<app-slug>[bot]`; with neither, no marker is trusted and
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

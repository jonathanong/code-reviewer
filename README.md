# code-reviewer

A standing, multi-pillar reviewer for pull requests in any repository. It reads each
repository's `AGENTS.md` and skills, plus any configs for it, reviews the change, and posts a
GitHub review.

- `bin/code-reviewer.mts`: the deterministic CLI (numbered diffs, posting, status, labels,
  benchmarks). Run `pnpm exec code-reviewer help`. `vouchington-reviewer` remains as an alias
  for callers that have not moved yet.
- `skills/`: the Claude Code skills (pillar prompts, verifier, and the standing loop).
- `benchmarks/review/`: labeled eval cases and how to run them.

## Install

```bash
git clone https://github.com/jonathanong/code-reviewer.git
cd code-reviewer && pnpm install
```

As a Claude Code plugin, add the marketplace `jonathanong/code-reviewer` and install the
`code-reviewer` plugin. The plugin puts `code-reviewer` on the session's `PATH` and needs only
Node 24, so the standing reviewer session runs from any directory; see
[`skills/review-loop/SKILL.md`](skills/review-loop/SKILL.md). The checkout is for developing the
reviewer and running benchmarks.

## Running a review

```bash
code-reviewer review --repo owner/name --pr N --out DIR --tree CHECKOUT [--jobs N] [--clones DIR] [--effort low|medium|high] [--force]
code-reviewer report --out DIR
```

`review` runs one pull request end to end with headless `claude -p` calls and stops before
posting, so you can read the result first. `--tree` is a checkout at the pull request head and
`--out` receives the run files; both become absolute paths. It claims the pull request (a head the
newest review already covers is declined unless `--force`), runs `prepare`, asks Haiku to pick
rule skills for the changed files (the review stops there, with nothing posted, when that call fails
twice or no rule skill is installed), runs the pillars the plan chose (`--jobs` at a time, default 3,
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
plugins (`no-mistakes-rules`, `jong-skills`). That keeps fixed context near 17k tokens instead of
about 139k. Pillar runs also get a read-only Haiku `explorer` subagent. The same flags apply to
`bench`, where `--no-rules` sets every plugin false.

A run that has a shell (the history pillar and the evidence run) passes `--setting-sources ''`
instead, so no settings file is loaded. User settings can allow commands of their own, or allow
every sandboxed command, and either would widen the run's allow-list. Such a run can execute its
listed prefixes and the read-only commands Claude Code always permits (`echo`, `ls`, `git log` and
the like); a chained or substituted command is denied whole.

### Stacks

A pull request whose base is another open pull request's head belongs to a stack. `prepare` walks
the open pull requests of the repository (up to ten hops each way) and, for a stacked pull
request, writes `stack.json` and, for each later member, `stack/<number>/INDEX.md` with one numbered patch per
changed file beside it (taken from
the local `--tree` with git, from the API otherwise), and adds a `stack` summary to `plan.json`.
Pillars and the verifier judge each finding against the top of the stack: a defect a later member
fixes stays as a `low` finding whose body starts with `Fixed in #N:`. `report.md` and `report.json`
show the members, the position, and the root base, noting an off-base stack (root base is not the
default branch) or a stale base (no open pull request has it as head). `queue` rows of a stacked
pull request carry `stack: {root, position, size}` and are ordered bottom-up. A flat pull request
is unchanged.

## Configuration

No repository needs a config; every key has a default. Settings come from three layers, and for
each top-level key (`labels`, `checkRun`, `consumes`, `evidence`) the highest layer that sets it wins. `labels`
merge by label name.

1. Machine config: files in `$CODE_REVIEWER_CONFIG_DIR`, else
   `${XDG_CONFIG_HOME:-$HOME/.config}/code-reviewer/repos`. `<owner>/<name>.json` holds one
   repository's settings and `<owner>.json` (beside the `<owner>/` directory) the settings its
   repositories share; the repository file beats the owner file.
2. `.code-reviewer.json` at the root of the reviewed repository, in the format of a repository
   file. It is read from the repository's default branch, never from the pull request, so a pull
   request cannot change its own settings. `prepare` reads it from the clone's `origin/HEAD`, or
   through the GitHub API without a clone; the other commands read it through the API once per
   repository they act on. A missing file is no config; any other read failure is reported as a
   problem and the lower layers apply.
3. Built-in defaults.

`code-reviewer settings --repo owner/name` prints the resolved values and the layer each came
from. An owner-wide `queue` or `settings --owner` reads machine configs only, since a repository's
own file is read when the repository is named.

### `consumes`

```json
{
  "consumes": [{ "repo": "acme/api", "via": "HTTP API", "paths": ["src/routes/**"] }]
}
```

- `consumes`: repositories this one depends on without a package import. `repo` is `owner/name`.
  `via` (optional) says how in a few words. `paths` (optional) are globs in the consumed
  repository that this one depends on; without it, any change there counts.

Only the consumer's config declares the link. `prepare` uses it in both directions, for
repositories cloned under the clone root (matched by their `origin` URL, or by directory name
without one):

- A pull request in the consumer stages the consumed repository's instructions, skills, and code
  location as a dependency, ahead of dependencies found by import.
- A pull request in the consumed repository that touches `paths` stages the consumer under
  "Consumers" in `rules/INDEX.md`, for the blast-radius pillar. Only machine configs are
  searched for consumers, because a consumer's own file is read when its pull request is reviewed.

A malformed file, an unknown key, or a configured repository with no clone is listed under
"Missing" in `rules/INDEX.md` and in `prepare`'s output; none of them stops the review.

### `evidence`

Evidence sources let a review check findings against real data, such as production logs, instead
of guessing. They are machine-only: `evidence` in a repository's own `.code-reviewer.json` is
ignored with a problem, because that file is controlled by whoever can merge to the default
branch and a source grants command access and credentials. A repository file's list replaces its
owner file's list whole; `[]` switches evidence off for that repository.

```json
{
  "evidence": [
    {
      "name": "aws",
      "description": "Production logs and metrics.",
      "guide": { "repo": "acme/infra", "path": "docs/production-data.md" },
      "commands": ["aws logs filter-log-events", "aws logs start-query"],
      "env": { "AWS_PROFILE": "readonly" }
    }
  ]
}
```

- `name`: a simple identifier, unique in the list.
- `description`: one line on what the source can answer; the run uses it to skip sources that
  cannot bear on a change.
- `guide`: how to query the source. `{ "repo", "path" }` is read from that repository's clone under
  the clone root at its remote default branch (never the working tree, never a pull request);
  `{ "file" }` is a path on this machine, `~/` allowed.
- `commands`: command prefixes of at least two words, each allowed as `Bash(<prefix>:*)`; beyond
  them the run has only the read-only commands Claude Code always permits. Grant read-only prefixes: a prefix is only as safe as the CLI's subcommand.
- `env` (optional): variables set for the run. Values are never printed, logged, or put in a
  prompt, report, or `settings` output; only names are.

After the verifier, one extra headless Sonnet run gets the verified findings, the sources, their
guides, and `Read`, `Grep`, `Glob` and the allowed commands. It writes `evidence.json` and an
Evidence section in `report.md`, and appends one `Evidence (...)` line to a supported or
contradicted finding in `review.json`. It never drops a finding or changes a severity or the
verdict, its cost is in the cost tables, and a failed run or blocked source is reported while the
review goes on. A source is `checked` only with the commands it ran; an empty result needs a
control query. Evidence is not part of `bench`.

### `labels` and `checkRun`

Label names and an optional GitHub check run are set in the same files; an owner file cannot set
`consumes`.

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

`code-reviewer settings --repo owner/name` (or `--owner LOGIN`) prints the resolved settings, including the names of the evidence sources and the layer they came from.
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

# Configuration

No repository needs a config; every key has a default. Settings come from three layers, and for
each top-level key (`labels`, `checkRun`, `consumes`, `evidence`, `references`, `approvalCheck`, `rulePlugins`, and `run`) the highest layer that sets it wins. `labels`
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

## `consumes`

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

## `evidence`

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
review goes on. A source is `checked` only with the commands it ran. An empty result is evidence
of absence only if a control query (the same query loosened so it must return something, such as
a known-present value or a wider window) returns something; when the control is empty too, the
run reports the evidence as inconclusive (effect `none`: `report.md` keeps the note, and no
Evidence line is added to the finding). Evidence is not part of `bench`.

## `references`

References let a review check the code against external documentation, such as AWS API
parameter names, limits, IAM actions, CLI flags and config keys. They are machine-only, like
`evidence`: `references` in a repository's own `.code-reviewer.json` is ignored with a problem,
because it grants network access while the run holds private code. A repository file's list
replaces its owner file's list whole; `[]` switches references off for that repository.

```json
{
  "references": [
    {
      "name": "aws",
      "description": "AWS service documentation",
      "domains": ["docs.aws.amazon.com"]
    }
  ]
}
```

- `name`: a simple identifier, unique in the list.
- `description`: one line on what the site documents.
- `domains`: at least one lowercase hostname, no scheme, port, path, wildcard or bare top-level
  domain. A host matches exactly; its subdomains are not included. Claude Code also lets the
  fetch tool reach a built-in set of public documentation hosts (for example `docs.python.org`
  and `developer.mozilla.org`) without a rule, so the list bounds every other host, not those.

When references are configured, the correctness pillar, the security pillar and the verifier get
the `WebFetch` tool with one `WebFetch(domain:<host>)` allow rule per domain under `dontAsk`, no
`WebSearch`, and a References block in their prompt with the rules in
[`skills/review/references/web-references.md`](../skills/review/references/web-references.md). The
other pillars are unchanged. These runs, like runs with a shell, pass `--setting-sources ''` so
no user setting can widen the allow-list. With no references every prompt and flag is unchanged.
`bench` does not use references. `code-reviewer settings` lists the configured names and domains.

## `approvalCheck`

A full review whose verdict would be Approve gets one more independent run first, on the verifier's
model, whose only job is to refute the approval: it looks for an unreviewed changed file, a risky
area no pillar covered, a claim in the description nothing checked, or a finding the verifier
dropped that is real. What it confirms is added to the findings and questions, and the verdict is
derived again in code, so it can turn an Approve into a Comment or Request Changes but never the
reverse. It costs one more verifier-class run, only on reviews that would approve. It is skipped
for light reviews and for any verdict other than Approve. If the run fails or returns something
unreadable it is not retried: the review completes, `approval-check` is listed under `skipped`
with the reason, and the verdict is Comment, because nothing double-checked the approval.
`report.md` has a "Second check on the approval" section (whether it ran, what it added, the
verdict change) and its cost.

```json
{ "approvalCheck": false }
```

It is on by default and, like `evidence`, machine-only: a repository's own file cannot switch it
off. `code-reviewer settings` prints the resolved value and its layer.

## `rulePlugins`

```json
{ "rulePlugins": ["no-mistakes-rules", "jong-skills"] }
```

The Claude Code plugins whose skills a review may use as shared rules, by plugin name (no
`@marketplace`). Unset, the list is `no-mistakes-rules` and `jong-skills`. A list replaces the
default whole and is never appended to it, and the repository file's list replaces the owner
file's. `[]` is valid: rules then come only from the reviewed repository's `AGENTS.md` and
skills, skill selection is skipped, and every headless run enables no plugin. Names are letters,
digits, `.`, `_` and `-`, each listed once.

It is machine-only, like `evidence`: a repository's own file cannot set it, and says
`rulePlugins is machine-only; ignored`. An enabled plugin brings its hooks, agents and commands
into a headless run, and every skill description from it sits in each run's context, so the list
decides what a pull request's review is allowed to load.

Every listed plugin must be enabled at user scope: `run` refuses, and `review` fails, naming a
plugin that is not. `review` also fails naming a listed plugin that holds no skills. `code-reviewer settings` prints the names and the layer they came from. `bench`
ignores this key and always uses the default list, so scores stay comparable across machines.

## `labels` and `checkRun`

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

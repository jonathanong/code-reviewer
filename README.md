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

`run` (below) is the unattended path. `review` runs one pull request end to end with headless `claude -p` calls and stops before
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

### Posted text length

Posted text should be short. A review body targets 1,200 characters (the hidden marker and collapsed
details do not count) and an inline comment 800. Above a target, `post` and the `review` preview
list a warning (`warnings` in the `post` output, "Posted text" in `report.md`); above three times a
target, a real `post` refuses unless `--allow-long` is given (`tooLong` lists those on a dry run).
`--body-target` and `--inline-target` change the targets. A fixed, conservative pattern list also
warns when authored text narrates the review (the verifier, a pillar, tool names, first-person
process, praise); it never refuses.

### Premise and prevention

A reviewer may challenge whether a change should exist in this form (it solves the wrong problem,
duplicates something already in the tree, or a much smaller change reaches the stated goal), but
only with evidence from the tree or the context, as a `medium` or `low` finding that the verifier
may turn into a question; never as `blocking` or `high` on that ground alone. These are prompt
rules in the pillar contract, with no code check.

A finding may carry `prevent`, one optional line naming a lint rule, type, test or CI guard that
would stop the class of mistake. It is kept in `review.json`, shown as a `**Prevent:**` line under
the finding in the posted comment and in `report.md`, and absent means nothing is rendered. A
`prevent` over 160 characters warns like any over-long posted text.

### Verdict and questions

The verdict is derived, never chosen, top-down: a verified `blocking` finding gives Request Changes;
otherwise a `high` finding or an open question gives Comment; otherwise Approve. A failed pillar is
listed as skipped and changes none of this (a failed [`approvalCheck`](#approvalcheck) does: it makes
an Approve a Comment), and a review where every pillar failed fails instead.
The verifier may return `questions` (`question`, `askOf` `author` or `product`, and a required
`why`: what the answer changes). A question is for something the code and context cannot settle,
not a softened finding and not a request to explain code. Questions appear in `report.md` and under
a "Questions" heading in the posted review body, and the next review of the pull request reads them
as context so an answered one is not asked again. `post` recomputes the verdict from the findings
and questions; a `verdict` field in `review.json` that disagrees fails the review.

`post` submits the verdict as its own review event: Approve as `APPROVE`, Request Changes as
`REQUEST_CHANGES`, Comment as `COMMENT` (on the first part of a split review; later parts are
comments). GitHub refuses approve and request-changes on your own pull request, so when the
author is the reviewer's identity (the `gh` login, or the App bot; the same identity that decides
whose markers count) the review goes out as `COMMENT`. So it does when that identity cannot be
determined, or when GitHub rejects the event with 422: it falls back to `COMMENT` once, and the
`post` output says `event` and `downgraded` (`self-review`, `identity-unknown`, or `rejected`; the
tracker's `posted` row and `explain` carry both), so a review is never lost. The author comes from
the run's `context.json` when it is for the same head, and from the host otherwise. The first-line tag, hidden marker, labels and check run are unchanged and
still decide `status`; GitHub's own review state is not trusted. An `APPROVE` clears the reviewer's earlier
request for changes by itself, but a later `COMMENT` does not on GitHub, so the pull request would
stay blocked after the blocking findings were fixed. When the review goes out as a `COMMENT` and the
verdict no longer requests changes, `post` dismisses the reviewer's own earlier reviews that are
still in the changes-requested state, with a one-line message that links the new review. "Own"
means written by the trusted identity and carrying the hidden marker; nobody else's review is ever
touched. This is the only dismissal the tool performs. If the identity is unknown, the lookup
fails, or GitHub refuses a dismissal, the post still succeeds and `warnings` names each review left
standing. `dismissed` in the output lists the dismissed review ids; a dry run lists what it would
dismiss as `wouldDismiss` and dismisses nothing.

GitHub calls survive transient failures. Every `gh` call goes through one retry policy
(`src/gh-cli/retry.mts`): 3 tries per call, so 2 retries, waiting about 1s then 2s (each wait is
jittered to between half and all of its step, and no backoff exceeds 8s). A 502, 503 or 504, a
reset, timed-out or dropped connection, and a secondary rate limit or 429 are transient; a wait
GitHub names with `retry-after` is honoured up to 60s, and a longer one fails the call. Every
other failure (401, 403, 404, 422, other 5xx, a missing `gh`, bad App config) fails at once.
Reads are retried, and so are the writes that are safe to repeat: adding or removing a label and
setting a commit status, and dismissing one named review (a repeat that is answered with "already
dismissed" counts as done). A review POST is never repeated blindly, because a request that timed out
may have landed; and the check-run POST is not repeated either, since a repeat would make a second
check run. A command that retried anything prints one stderr line, `warning: N GitHub calls were
retried after transient failures`.

`post` confirms what it posted. Before submitting, it records which reviews already exist; after,
it reads the pull request's reviews back and looks for the reviews that are new, written by the
reviewer's own identity (the same one that decides whose markers count), and carry this head's
hidden marker: the verdict marker for the first part, the part marker for each later part. Exactly
one per part is a confirmation, and the `post` output lists the ids as `reviewIds` (the tracker's
`posted` row keeps the first as `reviewId` beside `reviewUrl`, taken from the confirmed review).
A review POST that fails transiently is retried only after the read-back shows that part is not
there (so a post that timed out but landed is never repeated), up to the same 3 tries and
backoff; if it landed, `post` carries on with the review it found. If the reviewer's identity or
the review list cannot be read, the post is not retried at all and says the review may have posted.
GitHub's review list can lag behind a review it just accepted, so a read-back that misses a part
is repeated twice more, 1s apart, before the part is called absent; the same re-reads precede
deciding that a timed-out post did not land. A part still missing after that fails the command, and
the approval label is not set. More than one new review with the same marker is a warning in `warnings` naming every link;
nothing is deleted or dismissed. Dismissing the reviewer's own earlier request for changes happens
only after the new review is confirmed, so a failed or unconfirmed post never leaves the old block
cleared with no new review (the output then warns that it was not dismissed). A read-back that fails after its own retries is also a warning (the
review was submitted but could not be confirmed, `confirmed` is false), not a failure. A dry run
reads and confirms nothing.

Every headless run passes `--strict-mcp-config --setting-sources user` and
`--settings '{"enabledPlugins":{...}}'` listing each enabled plugin, true only for the rule
plugins (`no-mistakes-rules`, `jong-skills`). That keeps fixed context near 17k tokens instead of
about 139k. Pillar runs also get a read-only Haiku `explorer` subagent. The same flags apply to
`bench`, where `--no-rules` sets every plugin false.

A run that has a shell (the history pillar and the evidence run) or a web tool (see `references`) passes `--setting-sources ''`
instead, so no settings file is loaded. User settings can allow commands of their own, or allow
every sandboxed command, and either would widen the run's allow-list. Such a run can execute its
listed prefixes and the read-only commands Claude Code always permits (`echo`, `ls`, `git log` and
the like); a chained or substituted command is denied whole.

### Stacks

A pull request whose base is another open pull request's head belongs to a stack. `prepare` walks
the open pull requests of the repository (up to ten hops each way) and, for a stacked pull
request, writes `stack.json` and, for each later member, `stack/<number>/INDEX.md` with one numbered patch per
changed file beside it (taken from
the local `--tree` with git, from the API otherwise; a later member whose diff exceeds 20 MB, or
that the API refuses, gets no index and is recorded as `diffSkipped` in `stack.json`), and adds a `stack` summary to `plan.json`.
Pillars and the verifier judge each finding against the top of the stack: a defect a later member
fixes stays, when it reaches the verifier, as a `low` finding whose body starts with `Fixed in #N:`
(a pillar may also leave such a defect out). `report.md` and `report.json`
show the members, the position, and the root base, noting an off-base stack (root base is not the
default branch) or a stale base (no open pull request has it as head). `queue` rows of a stacked
pull request carry `stack: {root, position, size}` and are ordered bottom-up. A flat pull request
is unchanged.

### Pushes that only merge the base

When a pull request that was already reviewed gets a new head, `prepare` classifies the push with
git in the `--tree` checkout and writes `push.json`: `base-merges-only` (every new commit merges
the base), `rebase-same-change` (history was rewritten but the pull request's own change against
the base is the same), or `substantive`. The first two get a light review of the merge
resolutions (`git show --remerge-diff`, so git 2.36 or newer) or the range-diff, and of whether
what came in from the base breaks the pull request's change; the base's own commits are not
judged. A clean merge is as cheap as light gets, and a resolution a person wrote is never
skipped. A resolution that drops one side's change, keeps both when one replaced the other, or
edits a generated file by hand is a finding. Anything git cannot answer is `substantive`, with the
reason recorded in `problems`. `report.md` shows the kind and the merges checked.

## Unattended runs: `run`

```bash
code-reviewer run --repo owner/name --pr N [--post auto|hold] [--effort low|medium|high] [--force] [--jobs N] [--clones DIR]
```

`run` takes one pull request from a label request to a posted or held review in one process, for
a session that dispatches it without watching. It:

1. Checks the preconditions: both rule plugins (`no-mistakes-rules`, `jong-skills`) are enabled,
   the machine config and the repository's own file have no problems, and auth resolves.
2. Reads the pull request and declines it (a no-op) when the newest trusted review already covers
   the head, another session holds it, or an unposted review of this head waits in a run
   directory. `--force` skips these checks.
3. Checks the head out in a temporary git worktree under the OS temp directory, from the local
   clone in `--clones` or `CODE_REVIEWER_CLONE_ROOT` after fetching the head. Without a local
   clone it makes a blobless clone there instead. The tree is removed on success, on failure and
   on `SIGINT` or `SIGTERM`.
4. Runs `review` in-process. `review` makes the claim, so a lost claim is a no-op with a reason;
   `run` adds the request label first when neither it nor the in-progress label is present.
5. Posts through `post` (which records the tracker row and moves the labels), or holds.

Progress goes to stderr. Stdout is exactly one JSON line.

### Exit codes

Defined once, in [`src/run/output.mts`](src/run/output.mts). They avoid 1 and 2, which other
commands use.

| Code | `outcome` | Meaning                                                                             |
| ---- | --------- | ----------------------------------------------------------------------------------- |
| 0    | `posted`  | The review was posted, or a skip plan was closed out.                               |
| 10   | `held`    | The review is finished and waits for a human. Nothing was posted.                   |
| 11   | `noop`    | Nothing to do; `reason` says why (already reviewed, in progress, held, claim lost). |
| 12   | `error`   | A precondition or a flag failed before any label changed.                           |
| 13   | `error`   | The run failed after starting; the claim was released.                              |

### The JSON line

`repo`, `pr`, `headSha`, `outcome`, `exitCode`, `verdict`, `event` (the posted review event),
`held` (the rules that matched), `findings` (counts by severity), `questions`, `reviewUrl`,
`reviewIds` (the reviews `post` read back, one per part), `approvalCheck` (`upheld`, `changed` or
`failed`, when the review ran the second check on an approval), `costUsd`, `tokens`, `mode`, `tree` (`worktree` or `clone`), `runDir`, `explainPath`,
`postCommand`, `attention`, `problems` and `reason`. Fields that do not apply are `null`, or `[]`
for lists. `attention` is a list of short reasons a person should look; it is empty when a clean
review was posted. A posted review's `attention` also carries the warnings `post` printed: a
duplicate review, an earlier request for changes left undismissed, or a review it could not
confirm.

`explainPath` is a Markdown file `run` always writes with the output of `explain`, for posted and
held runs alike, so the review can be read or attached to a document. `run` talks to no document
service.

### Hold rules

A hold rule keeps a finished review from being posted. Every rule is on by default and can be
switched off in machine config. `--post hold` holds every run (`held` lists `post-hold`).

| Rule               | Holds when                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `unclear-intent`   | The review has open questions.                                                                                                |
| `large-change`     | The change is over `largeChange.files` files or `largeChange.lines` changed lines, or the diff or conversation was cut short. |
| `risky-change`     | The change touches paths the dispatcher sends to the security pillar.                                                         |
| `partial-failure`  | A pillar, the evidence run or the verifier failed or was blocked, or the approval's second check did not complete.            |
| `not-app-identity` | Calls use the local `gh` login and not the GitHub App.                                                                        |
| `text-too-long`    | Posted text is over three times its target, which `post` would refuse.                                                        |

A held run releases the claim and puts the request label back, so the pull request stays visible
in `queue`. It leaves the review in `runDir` and the tracker row at `reviewed`, which makes a
later `run` of the same head a no-op rather than a loop. With `--post auto`, a held review is
posted by a human, after reading the document at `explainPath`, with the printed `postCommand`
(`code-reviewer post ... --input RUNDIR/review.json`). `run --force` reviews the head again.

### When the post is not certain

If `post` submitted the review but could not read it back, `run` still reports `posted` (the
labels moved and the tracker row was written) and lists the problem in `problems` and `attention`:
look at the pull request. If `post` throws because the review may or may not have landed, `run`
exits 13 with a `reason` that says so, releases the claim without requeueing, and leaves
`postCommand` null. The review stays unposted in `runDir` with a `reviewed` tracker row, so a
later `run` of the same head is a no-op (11) and cannot start a second review of it. A person
checks the pull request, then posts with `post` or reviews again with `--force`.

GitHub retry warnings stay on stderr, after the JSON line; stdout is still exactly one line.

### Config

A machine-only key, in the files described under [Configuration](#configuration). A repository's
own `.code-reviewer.json` cannot set it, because it comes from the reviewed repository. Unknown
rule names and keys are a config problem, which fails the precondition check.

```json
{
  "run": {
    "rules": { "risky-change": false },
    "largeChange": { "files": 80, "lines": 2000 }
  }
}
```

- `run.rules`: each rule above, `true` or `false`.
- `run.largeChange`: `files` and `lines`, positive integers. Defaults: 50 files, 1,000 lines.

### Using it from another agent session

The `code-reviewer` plugin and the CLI must be installed for that session: the plugin's `bin/`
puts `code-reviewer` on the session's `PATH`, and a session without the plugin has no
`code-reviewer` command. A session on the standing loop dispatches `run` as a background command
per label event, at most three at once, and reads only the JSON line and the exit code. `run` is
safe to call concurrently for the same pull request: the label claim lets one win and the rest
exit 11. Two calls that read the labels in the same instant can both try to claim; the loser's
claim fails and exits 11 too. See
[`skills/review-loop/SKILL.md`](skills/review-loop/SKILL.md).

## Tracker and explainer

```bash
code-reviewer tracker [--repo owner/name]... [--since ISO_DATE] [--state reviewed|posted|skipped|failed] [--format json|csv|markdown]
code-reviewer explain (--run DIR | --repo owner/name --pr N)
```

Every `review` appends one row to a tracker, and `post` appends a `posted` row to it. A row is
one review run of one pull request head: repository, number, title, author, head SHA, mode (`full`,
`light`, `follow-up` or `skip`), verdict, finding counts by severity, the number of open questions
when `review.json` has a `questions` list, cost, start and finish times, the run directory, and a state:
`reviewed` (produced, not posted), `posted` (with the review link and id, the event actually posted, and `downgraded`, the reason it was a COMMENT instead of the verdict's own event), `skipped` or `failed`
(with the reason). A later row for the same repository, pull request and head replaces an earlier
one, except that `posted` adds to the `reviewed` row it follows. `tracker` prints that folded state;
CSV cells that begin with a spreadsheet formula character are prefixed with an apostrophe.

The tracker is `reviews.jsonl` in the state directory: `CODE_REVIEWER_STATE_DIR`, else
`code-reviewer` under `$XDG_STATE_HOME` (default `~/.local/state`). It is JSON Lines so concurrent
runs append whole lines without a lock. A line that cannot be read is reported and skipped. The
tracker is machine-local, never synced, and holds private pull request titles and author logins:
do not publish it. A tracker failure is reported as `trackerProblem` in the command's output and
never fails a review or a post.

`explain` prints a Markdown explainer for someone who has not read the code: what the pull request
does, the verdict and why it is that verdict in plain words (a blocking finding: Request Changes; a
high finding or an open question: Comment; otherwise Approve), the event it was posted as when that
differs from the verdict (read from the tracker's `posted` row), each open question with who is asked
and why it matters, each finding (claim, where, why it matters and what
would fix it, most severe first), what was and was not checked, and the cost. It
is built from `review.json`, `report.json`, `evidence.json` and `stack.json` in the run directory,
any of which may be missing, and makes no model call and no network request. With `--repo` and
`--pr` it uses the run directory of the latest tracked run, which must still exist. The skills put
this text in a Claude Doc when the session has a document connector; the CLI never talks to one.

## Configuration

No repository needs a config; every key has a default. Settings come from three layers, and for
each top-level key (`labels`, `checkRun`, `consumes`, `evidence`, `references`, `approvalCheck`, and `run`) the highest layer that sets it wins. `labels`
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
review goes on. A source is `checked` only with the commands it ran. An empty result is evidence
of absence only if a control query (the same query loosened so it must return something, such as
a known-present value or a wider window) returns something; when the control is empty too, the
run reports the evidence as inconclusive (effect `none`: `report.md` keeps the note, and no
Evidence line is added to the finding). Evidence is not part of `bench`.

### `references`

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
[`skills/review/references/web-references.md`](skills/review/references/web-references.md). The
other pillars are unchanged. These runs, like runs with a shell, pass `--setting-sources ''` so
no user setting can widen the allow-list. With no references every prompt and flag is unchanged.
`bench` does not use references. `code-reviewer settings` lists the configured names and domains.

### `approvalCheck`

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

Calls use a GitHub App when one is configured, otherwise the local `gh` login. Configure the App
with `app.json` in the config home, `${XDG_CONFIG_HOME:-$HOME/.config}/code-reviewer` (the parent of
the default `repos` directory; `CODE_REVIEWER_CONFIG_DIR` does not move it):

```json
{ "appId": "123", "privateKeyPath": "app.pem", "installationId": "456" }
```

`appId` is required (a string or number). `privateKeyPath` defaults to `app.pem` beside the file;
a relative path is resolved against the config directory, and absolute and `~/` paths are allowed.
`installationId` is optional; without it the installation is looked up per repository owner. The
key file must be a PEM and not readable by group or others (`chmod 600`; the check is skipped on
Windows). Any problem with the file or the key fails the command with a message naming the file.

The environment overrides the file, for CI: when `CODE_REVIEWER_APP_ID` is set, the
`CODE_REVIEWER_APP_*` variables are used (`CODE_REVIEWER_APP_PRIVATE_KEY` with PEM text, or
`CODE_REVIEWER_APP_PRIVATE_KEY_PATH`, and optionally `CODE_REVIEWER_APP_INSTALLATION_ID`) and
`app.json` is ignored. `code-reviewer auth` prints the `source` (`env` or the path of `app.json`),
never the key.

### Creating the GitHub App

A GitHub App gives the reviewer its own identity, so it can review your own pull requests as
someone else and write check runs.

1. On GitHub, open Settings, Developer settings, GitHub Apps, New GitHub App, under the account or
   organization that will own it. Give it a name (GitHub derives the App's slug, and so its
   `<slug>[bot]` login, from the name) and any homepage URL. Untick "Active" under Webhook: the
   reviewer receives no webhooks. Allow installation only on this account.
2. Grant these repository permissions and no others:

   | Permission    | Access         | Used for                                                  |
   | ------------- | -------------- | --------------------------------------------------------- |
   | Pull requests | Read and write | Reading pull requests, posting reviews, resolving threads |
   | Issues        | Read and write | Adding and removing the review labels                     |
   | Contents      | Read-only      | Reading `.code-reviewer.json`                             |
   | Checks        | Read and write | The check run, when `checkRun` is configured              |
   | Metadata      | Read-only      | Required by GitHub                                        |

3. On the App's page, note the App ID and generate a private key. Move the downloaded `.pem` to
   `app.pem` in the config home and run `chmod 600` on it. Delete the downloaded copy.
4. Install the App on each account or organization whose repositories it reviews, and select those
   repositories.
5. Write `app.json` beside the key with the App ID, then run `code-reviewer auth`. It prints
   `"mode": "app"`, the `source`, and the `login` the reviewer trusts.

Renaming the App changes its login, so reviews it posted under the old name stop counting as its
own. Git operations still use your own clones and credentials; the App is used only for GitHub API
calls.

`claim` and `status` trust a `<!-- final-review ... -->` marker only from the identity that posts
reviews, so a review forged by someone else cannot decline a head or report approval. That
identity is the reviewer's own: the authenticated GraphQL `viewer`, or under App auth the App's
`<slug>[bot]`, looked up once per process with `GET /app` signed by the App JWT. An installation
token cannot query `viewer`, which is why the App is asked for its own slug. No variable is needed.
If the lookup fails nothing is trusted: every head is re-reviewed (status never reports approval),
and `code-reviewer auth` prints `loginError` instead of `login`.

Reviews from any other author, including one carrying a `final-review` marker, are not prior
reviews. They reach the run as other reviewers' notes with the marker stripped, and the reviewer
weighs them like any other comment.

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

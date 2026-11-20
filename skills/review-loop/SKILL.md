---
name: review-loop
description: Run the standing review-loop session that takes review requests by label or message, reviews each pull request, and posts with the human's permission.
---

# Standing code reviewer

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/final-reviewer/SKILL.md` from the launch directory if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

One long-running, attended session named `review-loop` runs in any directory with the
`code-reviewer` plugin enabled. It is not a worktree-isolated session, because it creates review
worktrees for other repositories. It is local only, never CI, and it never merges.

## Adapter parameters

Resolve these first and ask when one is missing:

- **Owner** whose pull requests it reviews (for example `vouchington`), and optionally a
  repository list.
- **Clone root**: where local clones of those repositories live, for review worktrees, rule
  sources, and dependencies. Set `CODE_REVIEWER_CLONE_ROOT` or pass `prepare --clones`. Rules are read
  from each clone's `origin/HEAD`, so run `git fetch` in those clones at start.
- **Event source**: the hook-harness CLI (`npx -y hook-harness`), its MCP server, or none.
- **GitHub App** (optional): `app.json` and its key in the config home; the README's
  "Creating the GitHub App" section has the steps and permissions. Without it, the local `gh`
  login is used. Check with `code-reviewer auth`. Never search for or print keys.

## Intake

Requests reach the reviewer in two ways. Both end up as the same label, so GitHub holds the queue:

- **Label**: anyone adds `final-review:requested` to a pull request. A requester that wants a
  follow-up after pushing fixes adds it again.
- **Message**: another session sends `review-loop` (for example with SendMessage)
  `owner/name#number` and optionally an effort. Add the label yourself with
  `gh api --method POST repos/<repo>/issues/<n>/labels -f 'labels[]=final-review:requested'` (not
  `gh pr edit --add-label`, which rejects a label the repository has not defined yet), and
  remember the requester so you can reply.

The queue is keyed by `repo#pr`. A newer request for a queued pull request replaces the queued
one, and a request for a pull request already being reviewed is noted for after it finishes.

Each `queue` entry of a stacked pull request carries `stack: {root, position, size}`, and the
rows of one stack are adjacent and bottom-up. Review only the members that were requested, in that
order, and post one at a time, bottom-up. The other members of the stack are read-only context for
`prepare`: never review, label, or post on a member that was not requested.

A re-review after a push that only merges the base, or only rewrites history, runs light with no
change to how you queue, review or post; `report.md` says which kind of push it was.

## Step 1 - Start or restart

1. Check the rule plugins before any review:
   `code-reviewer plugins --require no-mistakes-rules --require jong-skills`.
   It prints the enabled plugins with versions and exits 1 naming any that are missing. Then
   confirm your own skill list shows skills from each required plugin: a session started before a
   plugin was installed or updated does not see it. On either failure, stop, review nothing, and
   tell the human to install the plugin or restart the session.
   The rules are only as new as the installed plugins, and nothing updates them for you. Report
   the printed versions to the human at every start, with the update command for each
   (`claude plugin update <plugin>@<marketplace>`); an update needs a session restart.
2. `code-reviewer auth` (App or `gh`) and `code-reviewer queue --owner <owner>`.
3. Entries in state `in-progress` were abandoned by an earlier session: review them with
   `claim --force`. Entries in state `requested` are queued in the order listed.

Keep nothing that a restart would lose. GitHub is the source of truth: the labels hold the queue,
and the newest review's hidden marker holds the reviewed SHA, verdict, and effort.

## Step 2 - Wait for events

Label names are configurable per organization and repository. Read the request label with
`code-reviewer settings --owner <owner>` (`labels.requested`), and with `settings --repo` for each
repository whose config (machine or `.code-reviewer.json`) overrides it; wait on every distinct request label. The examples below show
the default, `final-review:requested`.

Keep exactly one wait running, and pass its cursor back each time:

- **hook-harness CLI (preferred)**: a background command, which wakes the session when it exits
  and leaves it free for messages meanwhile:
  `npx -y hook-harness wait --owner <owner> --on label:final-review:requested --no-payload --timeout 2h [--after <cursor>]`.
  It prints `{events, gap, cursor, timedOut?}`.
- **hook-harness MCP**: `wait_for_events` with `owner`, `on: ["label:final-review:requested"]`,
  `include_payload: false`, `timeout_seconds` at most 240 (under the MCP tool timeout), and
  `after: <cursor>`.
- **Neither works** (not logged in, not installed, or failing): run `queue` and pace the loop with
  the host's wakeup tool (for example `ScheduleWakeup`, inside `/loop`): about every 5 minutes
  while reviews are queued, every 20 to 30 minutes otherwise. Stop once a wait is healthy again.

For each event: ignore it when `issue` is set (an issue, not a pull request). Events replay for a
day, so the label is the truth: `claim` re-reads it and ignores a request that is gone. On
`gap: true`, run `queue` to sweep what was missed. Your own label changes also produce events;
only `labeled` with a request label matters, so they are filtered out.

## Step 3 - Review

For each queued pull request, follow the [review](../review/SKILL.md) skill: check out the head,
then run `code-reviewer review` as a background command. Run at most three at once. Each is a
separate headless run, not a subagent, so the session keeps only the one JSON line each prints:
never paste diffs, pillar output, or review bodies into the session.

A skip (`mode: "skip"`) is finished when the command exits (it posted a skip review that makes
`status` pass): note it in the document and move on.

### Unattended: `run` per label event

An orchestrator that is not watching each review dispatches one background command per label
event instead of the checkout and `review` steps above:

```bash
code-reviewer run --repo <repo> --pr <n> [--effort <e>]
```

Run at most three at once, and read only the one JSON line it prints and its exit code: never the
run files. `run` is safe to start twice for the same pull request, because the label claim lets
one win. It exits:

- 0 `posted`: the review is posted. Note the verdict and `reviewUrl`.
- 10 `held`: the review is finished and not posted because a hold rule matched (an open question,
  a large or risky change, a partial failure, a non-App identity). Flag it to the human with
  `attention` and `explainPath` and wait: they read the explainer and, when they agree, post with
  the printed `postCommand`. Do not post a held review yourself, do not rerun it to change the
  answer, and do not use `--force` unless the human asks.
- 11 `noop`: nothing to do; `reason` says why. Take no action.
- 12 `error`: a precondition failed (a missing plugin, a settings problem, no auth, a bad flag).
  Stop dispatching and tell the human `reason`.
- 13 `error`: the run failed and released its claim. Say so with `reason`; retry once at most.

Anything in `attention` goes to the human even when the review was posted.

## Step 4 - Explain, then ask before posting

This step is the manual path. A run that `run` posted needs none of it, and one it held needs only
the human's reading of `explainPath`.

The human has to understand each verdict and check that their rules were applied, so give them
`code-reviewer explain --run "$run"`: plain Markdown built from the run's files (what the change
does, the verdict and its one reason, each finding with where it is and what would fix it, open
questions, what was and was not checked, the cost). It makes no model call. `report.md` stays on
disk for every pillar's raw findings, the dropped ones, the skills loaded and the cost by model.

When the session has a document connector (a first-party Claude Docs capability), keep one
document per review session with a section per pull request, filled from `explain` and headed
"draft" until it is posted. Start a new document after about 25 pull requests, or one per
organization, and link it from the old one. Without a connector, show the explainer inline.

Then tell the human the pull request, the verdict, the count of findings by severity, any
evidence source reported `blocked` (the review went on without it), and the document link (or
the explainer itself), and ask whether to post. When they ask for sign-off, give them that link.
Post only on their answer, unless they have said that
kind of review may be posted unattended. While waiting, keep reviewing the queue; a review that
waits for an answer does not count toward the three.

- Yes: `code-reviewer post` as in the review skill, then change the section's heading from "draft" to "posted" and add the review link.
- Changes: edit `review.json` as told, run `explain` again to refresh the section, show `post --dry-run`, and ask again.
- No: `code-reviewer abort` and note it in the section.
- The head moved while waiting: say so, check out the new head in the worktree, and review again with `--force` (see the `review` skill, Step 4).

## Step 5 - Hand back

Posting the review is the hand-back: the pull request's shepherd sees the review and its inline
comments, and the completed label replaces the processing one. Completed means the review was
posted; approval is the `final approval` label, which `code-reviewer status` checks (a skipped head also passes). Reply to a
requester that messaged with the verdict and the review link.

Merge authority is separate: the human, or the triage loop within its grant, merges.

---
name: final-reviewer
description: Run the standing final-reviewer session that takes review requests by label or message and posts final reviews.
---

# Standing final reviewer

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/final-reviewer/SKILL.md` from the launch directory if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

One long-running, attended session named `final-reviewer` runs in the code-reviewer
checkout. It is the main checkout, not a worktree-isolated session, because it creates review
worktrees for other repositories. It is local only, never CI, and it never merges.

## Adapter parameters

Resolve these first and ask when one is missing:

- **Owner** whose pull requests it reviews (for example `vouchington`), and optionally a
  repository list.
- **Clone root**: where local clones of those repositories live, for review worktrees, rule
  sources, and dependencies. It must include `vouchington-tooling` and `no-mistakes` (for the
  shared rule skills); set `FINAL_REVIEWER_CLONE_ROOT` or pass `prepare --clones`. Rules are read
  from each clone's `origin/HEAD`, so run `git fetch` in those clones at start.
- **Event source**: the hook-harness CLI (`npx -y hook-harness`), its MCP server, or none.
- **GitHub App** (optional): `FINAL_REVIEWER_APP_ID` plus `FINAL_REVIEWER_APP_PRIVATE_KEY_PATH`
  (or `_PRIVATE_KEY`) and optionally `FINAL_REVIEWER_APP_INSTALLATION_ID` in the session
  environment. The App needs Pull requests and Issues read and write, and Contents and Metadata
  read. Without it, the local `gh` login is used. Never search for or print keys.

## Intake

Requests reach the reviewer in two ways. Both end up as the same label, so GitHub holds the queue:

- **Label**: anyone adds `final-review:requested` to a pull request. A requester that wants a
  follow-up after pushing fixes adds it again.
- **Message**: another session sends `final-reviewer` (for example with SendMessage)
  `owner/name#number` and optionally an effort. Add the label yourself with
  `gh api --method POST repos/<repo>/issues/<n>/labels -f 'labels[]=final-review:requested'` (not
  `gh pr edit --add-label`, which rejects a label the repository has not defined yet), and
  remember the requester so you can reply.

The queue is keyed by `repo#pr`. A newer request for a queued pull request replaces the queued
one, and a request for a pull request already being reviewed is noted for after it finishes.

## Step 1 - Start or restart

1. `code-reviewer auth` (App or `gh`) and `code-reviewer queue --owner <owner>`.
2. Entries in state `in-progress` were abandoned by an earlier session: review them with
   `claim --force`. Entries in state `requested` are queued in the order listed.

Keep nothing that a restart would lose. GitHub is the source of truth: the labels hold the queue,
and the newest final review's hidden marker holds the reviewed SHA, verdict, and effort.

## Step 2 - Wait for events

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
only `labeled` with `final-review:requested` matters, so they are filtered out.

## Step 3 - Review

For each queued pull request, run the [final-review](../final-review/SKILL.md) skill, in the
background so the session stays free. Run at most three reviews at once; each one dispatches its
own pillar subagents. The session keeps only each review's one-line results: never paste diffs,
pillar JSON, or review bodies into it.

Model tiers come from `plan.json`: pillars on Sonnet (Haiku for docs-only changes and history),
the verifier on Opus (Sonnet for small low-effort follow-ups). Use Haiku for mechanical side work
such as cloning or cleanup.

## Step 4 - Hand back

Posting the review is the hand-back: the pull request's shepherd sees the review and its inline
comments, and `final-review:complete` replaces `final-review:in-progress`. `complete` means the
review was posted; approval is the `final approval` label, which `code-reviewer status`
checks. Reply to a requester that messaged with the verdict and the review link.

Merge authority is separate: the human, or the triage loop within its grant, merges.

## Presenting to the human

Keep one living document per session (a Claude Doc when the docs connector is available,
otherwise a Markdown file in the session scratchpad). Give each pull request one line or short
section: the verdict, each blocking item in one line, and the review link. GitHub is the record;
do not copy the review.

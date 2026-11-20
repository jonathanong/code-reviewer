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
- **GitHub App** (optional): `CODE_REVIEWER_APP_ID` plus `CODE_REVIEWER_APP_PRIVATE_KEY_PATH`
  (or `_PRIVATE_KEY`) and optionally `CODE_REVIEWER_APP_INSTALLATION_ID` in the session
  environment. The App needs Pull requests and Issues read and write, and Contents and Metadata
  read. Without it, the local `gh` login is used. Never search for or print keys.

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
`status` pass): record it in the document and move on.

## Step 4 - Record, then ask before posting

Keep one document per session: a Claude Doc when the docs connector is available, otherwise a
Markdown file in the session scratchpad. Its purpose is that the human understands each change
and can check that their rules were applied, and that there is a history of what every pillar
said.

When a review finishes, append its `report.md` as one section: the pull request summary, the
verdict, the verified findings, the Evidence section when there is one, every pillar's raw findings with the ones the verifier dropped
and why, the skills each pillar loaded, and the cost. Start a new document after about 25 pull
requests, or one per organization when the session reviews several, and link the new one from the
old.

Then tell the human the pull request, the verdict, the count of findings by severity, any
evidence source reported `blocked` (the review went on without it), and the document link, and ask whether to post. Post only on their answer, unless they have said that
kind of review may be posted unattended. While waiting, keep reviewing the queue; a review that
waits for an answer does not count toward the three.

- Yes: `code-reviewer post` as in the review skill, then add the review link to the section.
- Changes: edit `review.json` as told, show `post --dry-run`, and ask again.
- No: `code-reviewer abort` and note it in the section.
- The head moved while waiting: say so, check out the new head in the worktree, and review again with `--force` (see the `review` skill, Step 4).

## Step 5 - Hand back

Posting the review is the hand-back: the pull request's shepherd sees the review and its inline
comments, and the completed label replaces the processing one. Completed means the review was
posted; approval is the `final approval` label, which `code-reviewer status` checks (a skipped head also passes). Reply to a
requester that messaged with the verdict and the review link.

Merge authority is separate: the human, or the triage loop within its grant, merges.

# Running a review

```bash
code-reviewer review --repo owner/name --pr N --out DIR --tree CHECKOUT [--jobs N] [--clones DIR] [--effort low|medium|high] [--model STEP=HARNESS:MODEL]... [--max-cost USD] [--quiet] [--force] [--focus FILE]
code-reviewer report --out DIR
```

Every model call is one headless step run through a harness adapter in `src/harness/`. A step
asks for capabilities (read-only file tools, skills, an explorer subagent, shell limited to command
prefixes, web fetch limited to hosts, or no tools), and the adapter turns them into the CLI's flags
and reads its output. Each step's harness and model come from [`models`](configuration.md#models)
and `--model`, which may name `claude`, `grok`, `opencode`, `codex` or `agy`. Selecting Grok, OpenCode, Codex or Antigravity sends the
pull request's diff and files to that provider, so name them only where that is acceptable.

Grok (`src/harness/grok.mts`) is a second adapter, run as `grok -p`. It runs read-only steps: file
reads and searches, or no tools, with Grok's subagents, web search and MCP gateway off and the
user's Claude and Cursor skills, rules, hooks and MCP servers not loaded. It refuses a step that
needs shell prefixes or web hosts, because it cannot confine them, before starting anything.

OpenCode (`src/harness/opencode.mts`) is a third, run as `opencode run --format json --pure`. It
runs read-only steps: file reads and searches, or no tools. It confines the step with a deny-all
permission config in `OPENCODE_CONFIG_CONTENT` that allows only the read tools (plus reads in
`addDirs`, through an `external_directory` rule), so the user's shell and MCP tools are gone, and it refuses shell prefixes and web hosts before starting anything. It
has no schema flag, so the prompt asks for one JSON object and the reply is checked for the
schema's required keys. It ignores `explorer`, `skills`, `settings`, `transcript` and
`maxTurns`, so the turn limit is not enforced. At its free usage limit OpenCode prints nothing and hangs, so
the step ends at its timeout; the adapter reads the limit from the error log and reports the
failure as a rate limit too long to wait out, and the step moves to its next candidate.

Codex (`src/harness/codex.mts`) is a fourth, run as `codex exec --json` in its `read-only` sandbox with
`--ephemeral`, `--ignore-user-config` and `--ignore-rules`, so no write access, user config or rules
are loaded, and web search is off. The schema goes in through `--output-schema` and the answer is
read from the `-o` file. Codex reads files through its one shell tool, so it refuses no-tools steps
and shell and web grants, before starting anything. The sandbox already reads the run directory, so
`addDirs` is not passed (Codex's `--add-dir` grants write access). `project_doc_max_bytes=0` stops
Codex loading the checkout's `AGENTS.md`, so a pull request cannot change the instructions that
govern its own review. The schema is rewritten for Codex's strict structured outputs (every
property required, optional ones also accepting null, no extra properties) and the nulls are
dropped from the answer. Codex's read-only sandbox reads the whole disk, and no supported flag
limits that to the checkout and run directory, so a diff could steer a step to read a file outside
them and send it to the provider. Unlike Claude, Grok and OpenCode, which bound reads to the
checkout and `addDirs`, Codex refuses every step unless its candidate in `models` sets
`readsOutsideCheckout: true`, which only machine config may do. It ignores `explorer`, `skills`,
`settings`, `transcript` and `maxTurns`, and reports no cost. A usage-limit message is classified as
a rate limit too long to wait out. On `codex-cli 0.171.0` a small read-only step ran through the adapter: the arguments and the
rewritten schema (`enum`, `minimum`, optional properties) were accepted, usage was read from
`turn.completed`, and a planted `AGENTS.md` was followed only without `project_doc_max_bytes=0`.
`codex exec` reads standard input to the end, so the runner closes it. No full review has run on
Codex, and no real rate-limit or sign-in failure has been captured, so those classifications are
assumed. `gpt-6-luna` at `low` effort answered without reading the file in 2 of 3 small runs; at
`medium`, and `gpt-6.2-sol` at either effort, read it in 3 of 3.

agy (`src/harness/agy.mts`), Google's Antigravity CLI, is a fifth, run as `agy -p --output-format json`
with `--mode plan`, `--sandbox`, `--disable-slash-commands` and the schema in `--json-schema`. Plan is
the most restrictive of agy's modes (`accept-edits` and `auto` edit or run unprompted), and neither
`--mode auto` nor `--dangerously-skip-permissions` is ever passed. The step's effort goes to `--effort`
(never `max`) and `addDirs` to `--add-dir`. agy has no flag that names its tools or bounds its reads,
so, like Codex, it refuses every step unless its candidate sets `readsOutsideCheckout: true`, and it
refuses no-tools steps and shell and web grants, before starting anything. It ignores `explorer`,
`skills`, `settings`, `transcript` and `maxTurns`. The answer is the result object's structured output,
else the JSON in its reply text, and usage is read when the object has it. Its sign-in message is
classified as an auth failure, so the step moves to its next candidate. No run has been made through
the adapter, so agy's output shape and the read access of plan mode are assumed.

Config rejects what it can know from the step's key: the `pillar.history` and `evidence` steps need
shell, so a list in which every candidate is Grok, OpenCode, Codex or agy is a problem, and no free model
(`isFreeModel`, a naming heuristic) may run `verifier`, `verifier.light` or `approvalCheck`. The web
hosts the correctness and security pillars and the verifier get depend on `references`, so those are
checked at run time: when an adapter refuses a step, the runner moves to the next candidate, and
the step fails only if none is left.

[`run`](run.md) is the unattended path. `review` runs one pull request end to end with headless `claude -p` calls and stops before
posting, so you can read the result first. `--tree` is a checkout at the pull request head and
`--out` receives the run files; both become absolute paths. It claims the pull request (a head the
newest review already covers is declined unless `--force`), runs `prepare`, asks Haiku to pick
rule skills for the changed files (the review stops there, with nothing posted, when that call fails
twice or no rule skill is installed), builds the [pillar context](context.md#in-a-review) when it can, runs the pillars the plan chose (`--jobs` at a time, default 3,
each retried once), runs the verifier, and writes:

- `review.json`: the input `post` accepts. Post it after reading `preview.md`:
  `code-reviewer post --repo owner/name --pr N --head-sha SHA --input DIR/review.json`.
- `preview.md`: the reviews `post --dry-run` would send.
- `report.md` and `report.json`: the pull request, mode and effort, what it does, the verdict, the
  verified findings, and, per pillar, the model, skills loaded, cost, turns, and every raw finding
  with whether the verifier kept or dropped it and why, the total cost, and a "Tokens by model"
  table for selection, pillars (failed attempts included), and verifier, and a "Models" table with the harness and model each step ran on and how long it waited on rate limits. `report.md` is rendered from
  `report.json`; `code-reviewer report --out DIR` renders it again, for a running document.
- `skills.json`, `pillars/<pillar>.json`, `verifier.json`: the intermediate results.
- `review-context.md`: the context the pillars read; absent when it was not built.

The run prints one JSON line with the mode, verdict, finding counts, total cost, and file paths.
Labels stay at processing. A `skip` plan closes the pull request through `skip` (a short skip
review on the head, then the labels) and writes a short report. If anything fails after the claim, the claim is dropped without a requeue and the
command exits 1. A pillar that fails twice is posted as skipped with a short reason. If every
pillar fails, the review fails closed instead of approving unchecked code.

## Author rules

The plan picks `skip`, `light` or `full`. A pull request whose author has a rule
([`plan.authors`](configuration.md#plan); Dependabot has a built-in `light` one) is skipped or
reviewed lightly, and manifest, lockfile and workflow edits do not trigger the security pillar
under `light`. The rule holds only while every commit of the pull request is the author's.
`prepare` lists the pull request's commits from GitHub (REST `pulls/N/commits`, at most 200 read)
and counts a commit as the author's only when GitHub attributes it to that account, has verified it,
and records the committer as that account or GitHub itself (`web-flow`). A commit by anyone else,
an unverified commit, one made by the "Update branch" button, or a list that cannot be read, is
too long, or does not end at the head, ends the rule: the normal plan applies and the plan's
reasons say why. An explicit `--effort` keeps its usual precedence over a rule.

## Configured pillars

[`pillars`](configuration.md#pillars) adds pillars and switches built-in ones off. The plan runs an
extra in the modes it names, and also when a follow-up has an open finding of its own; a push that
only merges the base or rewrites history re-runs only an extra with an open finding. An extra is a
step like any pillar: it has the same read-only capabilities (no shell, no web), output contract,
retry and failure handling, a `pillar.<name>` model step, and its own row in progress lines,
`pillars/<name>.json` and the report. A `prompt` pillar is built from its text under the pillar
contract; a `when` trigger sits at its top, and a pillar it does not fit returns no findings
instead of costing a separate call. A `run` pillar sends its command as the whole prompt followed by
the contract, so it needs a harness that understands the command. The verifier and the approval
check accept the extra's name on findings.

## Requester focus

`--focus FILE` on `review` and `run` carries what whoever asked for the review wants checked.
`FILE` is text, one point per non-empty line, a leading `- ` stripped; at most 20 points of 500
characters (counted as Unicode code points). A file that is missing, unreadable, has no point, or has too many or too long ones
stops the command before any work, naming `--focus`, the file, and for an over-long line its line number and length. Without the flag nothing changes:
no step, no prompt, no cost.

With points, one extra step, `focus`, runs beside the pillars, whatever the plan dispatched. One
agent checks every point against the code, with the same context, read-only tools, retry and
failure handling as a pillar. Its prompt also includes a `## Change facts` Markdown block computed
mechanically from local git and `context.json` (with no model or GitHub API call): pull request
title and description lengths in characters (or "at least N characters (clipped)" when
`context.json` clipped the description at its limit), total changed files, and a table of up to 200 changed
files (the 200 with the most changed lines when there are more, with the omitted count stated) giving
each file's status, added/removed lines (or `binary`), total lines at head, and the character length
of its YAML frontmatter `description:` value when present. If git fails for a fact, that fact is
omitted and the step still runs. The prompt tells the step that the block is computed rather than
estimated, and that points it decides must be answered `holds` or `does_not_hold` from it rather than
`not_checked`. The facts block goes only to `focus`, never to the pillars or the verifier. Its model is `focus`, else `pillars`, else the `medium` tier, so
`--model focus=...` and `models.steps` accept it. It answers each point by index: `holds` (it checked and found nothing wrong on the point),
`does_not_hold` (it found a problem on the point that deserves a finding) or `not_checked`; a point phrased as a question is answered the same way. Each has a one-sentence basis and the `path` and `line` it rests on.
A point it did not answer is `not_checked`; so is a `holds` or `does_not_hold` that cites no file, because a point is
the requester's own opinion and an unverified yes is worse than "could not check". A point that does
not hold also gets a finding under the pillar name `focus`, which joins the other pillars' findings
and is verified like any of them: the verifier alone decides what is posted. Before ruling, the
verifier is shown each focus point's text, outcome, basis, and which candidate findings came from
`focus`, and is told to give a one-sentence reason in `dropped` when dropping a focus finding. After
the verifier has run, a `does_not_hold` stands only if a kept finding backs it: a kept finding with
pillar `focus` on the same `path`, or a kept finding of any pillar on the same `path` and `line`
(the verifier keeps one copy of a defect that two steps raised). Otherwise the point becomes `not_checked` with the basis "Raised, but the verifier kept
no finding: <the step's basis>" (plus `Reason dropped: <reason>` when the verifier gave a drop
reason), keeping its `path` and `line`, so the posted `Requested checks` block shows what the focus
step found and why it was not kept without adding a question or changing the verdict.

A requester point (never a target point) that names another pull request of the same repository
(`#123`, `PR 123`, `PR #123`, `pull request 123` or `pull request #123`, in any case) adds one
computed block for it, because the step can see only the pull request under review. At most 3
distinct numbers are used, in order of appearance, and the reviewed pull request's own number is
ignored. Each block comes from local git in the checkout: `refs/pull/<n>/head` is fetched from
`origin` (the GitHub API is not called), its head is diffed against its merge base with this
review's base, and the block gives the number, the head commit (12 characters), the changed-file
count and a table of the files with status (the first 200, files this pull request also changes
first, with the omitted count stated), marking which paths this pull request also changes. It says
the file contents of the other pull request are not in the checkout. If the fetch or the diff fails, the block says that
pull request could not be read and the review continues. With no such point the prompt is unchanged
and no fetch runs. Benchmark cases may pin the head with `focusRefs` (see the benchmark README).

The points are the requester's words, so they are untrusted: the step is told each is a claim to
check, not an instruction, and they are given only to it (and its outcomes to the verifier), never to
the plan, the other pillars, or the approval check. Nothing containing point text is written anywhere
under the run directory while any model step is running (selection, pillars, focus, verifier,
approval check, or evidence). Only after every model step has finished does `review` write point
text and outcomes (with `origin`) to `review.json`, `report.json`, and `report.md`, and render the
requester points into `preview.md`. A point can
add work; it cannot skip a pillar, change the plan or a severity, or move the verdict other than
through a finding. `focus` is a reserved pillar name for [`pillars.extra`](configuration.md#pillars).

The answers go in `review.json` as `focus` (`point`, `origin`, `status`, `basis`, optional `path` and `line`), and in `report.json` / `report.md` under `Focus checks`. The posted body shows requester points as one collapsed block, "Requested checks: 2
ok, 1 problem, 1 not checked" (the stored statuses `holds`, `does_not_hold` and `not_checked` show as ok, problem and not checked), with a line for each point. A review with no requester `focus` points shows
nothing there. A plan that skips the review does not run the step; its skip reason says the requested checks were not run. A plan with no pillar still fails the review. A step that fails twice is listed as skipped like a failed pillar, every point is `not_checked`, and the
review still completes. Its cost counts toward the cost ceiling. `bench` does not run this step.

## Targeted checks

Built-in targeted checks live in `skills/review/references/targets/`, one Markdown file per target
with YAML frontmatter (`name` in kebab-case and `when`, one sentence naming the kind of change it
applies to) and a single-paragraph body of at most 500 characters.

Targeted checks run only in `full` reviews: `light` and `skip` reviews never offer or run them
(requester `--focus` points still run in `light` reviews, and at the full plan's effort: at low effort the step can return the points of a large change unexamined). When any built-in target is enabled for
the repository (see [`targets`](configuration.md#targets)), the selection step (`selectSkills`) is
shown each target's `name` and `when` — never its body — and returns a `targets` array of matching
names alongside `skills` (or `targets` alone when `rulePlugins` is `[]`, degrading to no targets if
that call fails). Unknown names are ignored, and a missing or malformed `targets` field degrades to
`[]`. When no target is selected and no `--focus` file is given, no focus step runs and every
post-selection prompt and schema is unchanged.

Selected targets' point texts are taken verbatim from their files and run through the `focus` step
beside any requester points: requester points share one call and each target gets a call of its
own, because a target asked beside several other points comes back unexamined (requester points
first, then targets, up to the cap of 20; any target omitted by the cap is recorded in `report.json` as `droppedTargets` and listed in
`report.md`). In the focus prompt and verifier prompt, target points carry their own framing as the
reviewer's own standing checks — separate from untrusted requester text — with unambiguous indexes
and `origin` (`requester` or `target:<name>`). With no target points, both prompts are unchanged. A
target answered `does_not_hold` produces a `focus` finding verified like any other finding. In the
posted review, the "Requested checks" block lists requester points only: a target that `holds` or is
`not_checked` leaves no trace in the posted review. Every outcome, with its `origin`, is saved in
`review.json` and in `report.json` / `report.md` (`Focus checks` and `Targets selected`) after all
model steps finish.

## Findings: premise and prevention

A reviewer may challenge whether a change should exist in this form (it solves the wrong problem,
duplicates something already in the tree, or a much smaller change reaches the stated goal), but
only with evidence from the tree or the context, as a `medium` or `low` finding that the verifier
may turn into a question; never as `blocking` or `high` on that ground alone. These are prompt
rules in the pillar contract, with no code check. In the congruence pillar, the verifier also loads
`jong-skills:pr-description` when a change alters user- or caller-visible behavior and raises one
`low` finding (never blocking) when the description does not show one realistic input, command or
call, and real output under its "Show one real run" rule.

A finding's `body` is for the human reading the review: what is wrong and why it matters. Two
optional fields hold what only whoever fixes it needs. `fix` is exact steps, file lists, commands
and reproduction. `prevent` is one line naming a lint rule, type, test or CI guard that would stop
the class of mistake; over 160 characters it warns like any over-long posted text. Both are kept in
`review.json` and posted together in one collapsed `For the fix` section under the finding (inline
comment or body finding); `report.md` shows them as plain lines. With neither, no section is
rendered. Another reviewer's credit stays visible, after the section.

## Pre-existing defects (FYI)

A pillar that comes across a defect or rule violation on the base branch, in code it read, that the
pull request neither introduced nor made reachable reports it with `preExisting: true` on the
finding instead of dropping it. The verifier checks it against the base with local git, keeps at
most five, and clears the mark when the diff touches the code. A marked finding is an FYI: the
verdict, the finding counts, the tracker counts and the inline comments ignore it, so a
pre-existing `high` never turns an Approve into a Comment. The posted review lists each as one
line under "FYI — pre-existing, not part of this review", after the findings, with the finding's
body collapsed under a "Why" summary (cut at 600 characters) so the author can see the reason, and
shows at most five (the renderer drops the rest and prints "and N more"). It is a flag on the finding, not a
second list, so it passes through the pillar, verifier and approval-check schemas unchanged.

An approval that lists at least one non-pre-existing finding (not only FYI items) adds one line
under the index saying none blocks the merge and each is to be resolved before merging: fixed,
answered with why it stays, or linked to a follow-up issue.

## Other reviewers' open items

Normally a finding that repeats another reviewer's open thread is dropped as already raised. `prepare`
records in `context.json` (`restatable`, at most 10) the unresolved, not outdated threads started by
anyone but this reviewer whose first comment states a blocking or high severity through a marker in
`SEVERITY_MARKERS` ([Shared context](context.md#other-reviewers)): author, link, location and the
visible start of the comment. It reads the conversation `prepare` already fetched.

When the list is not empty, the verifier prompt gets one more block, separate from the thread ids,
and its output schema allows `raisedBy` on a finding. The verifier checks each item against the head
like a pillar finding. A valid, still present item it would rate blocking or high itself becomes a
finding in its own words that carries `raisedBy: { login, url }`; if one of its findings already
covers it, that finding gets the credit instead. An invalid or fixed item is left out, and an item of
a lower or unstated severity behaves as before. The credit counts only when `url` is a listed item,
and the login is the listed one. The posted finding ends with `Also raised by [login](link)` (link
text without `@`, so nobody is notified). The verdict follows the finding's severity like any other,
so a restated blocking item gives Request Changes. With no items the prompt and schema are unchanged.

## Answering other reviewers

With `answers` on ([configuration](configuration.md#answers)), the verifier can reply to another
reviewer's open note it finds invalid. `prepare` records in `context.json` (`answerable`, at most 10)
the unresolved, not outdated threads started by anyone but this reviewer in which this reviewer has
not commented: thread id, author, link, location and the visible text with later replies (and `omitted`, how many were left out, when some were). A thread
longer than what was read is left out.

When the setting is on and the list is not empty, the verifier prompt gets one more self-contained
block (`verifier.md` is not changed) and its output schema allows `answers`. A valid note is handled
as above, a fixed or low-value one is left alone, and an invalid one may get
`{ thread, body, rule?, at? }`: one to three sentences saying why, with either a `rule` (the
`<plugin>:<skill>` name, and optionally a sentence quoted from it; the body may paraphrase the
rule) or a location `at`. The answer is the
verifier's, so it is not parallel to the pillars and cannot bias them; the notes steer only what the
verifier keeps as findings.

Code checks every answer and drops a failing one with a warning that `report.md` shows under
"Answers to other reviewers": the thread must be a listed one, at most one answer per thread, at
most 5 per run, a length cap, no `@mention`, a `rule` or an `at`, and a `rule` must name a selected
or loaded rule skill (an unlisted one drops the answer). A `quote` that is given but is not one
whole sentence or list item of that skill verbatim (whitespace aside), or is too short, is removed:
the answer is kept with its skill and the warning says so. The skill's link is built by code, never taken from the model, from the marketplace the plugin was
installed from (`known_marketplaces.json`, and the plugin's entry in that marketplace's
`marketplace.json`): `<repository>/blob/<ref>/<plugin directory>/skills/<skill>/SKILL.md`. A string
`source` such as `./` or `./plugins/x` is a directory of the marketplace's own GitHub repository; an
object `source` (`git-subdir`, `url`, `github`) names its own repository and, for a subdirectory, a
`path`. The ref is the source's `ref`, else `HEAD`. When any of that is missing, not on GitHub, or
not certain (no marketplace record, a `pluginRoot`, a path leaving the repository, a skill directory that is not a plain path segment), the skill has no
link and is named plainly. The answers are written to
`review.json` and posted by `post` ([Posting](posting.md#replies-to-other-reviewers)). With the
setting off, or an empty list, the prompt and schema are unchanged.

The verifier reads review summaries and issue comments as well as threads
([Shared context](context.md#what-the-verifier-reads-of-other-reviewers)), but only inline review
threads can be answered: a review summary or an issue comment has no thread to reply in.

## Changes that fix a regression

The linked-regressions section of the pillars' context ([Shared context](context.md)) reads the
pull request's own commit messages for reverts, `Fixes <sha>` and regression mentions, and keeps the
commits it finds in local history. `review` reuses that one result, with each commit's sha, subject,
files, and `how` it was linked (`revert`, `fixes` or `mentioned`), so git runs once. The references
are claims made by untrusted text; a commit not in local history is not passed on.

When at least one commit was found, the verifier prompt gets one more block and its output schema an
optional top-level `regressionPrevent` string. The verifier checks that the diff addresses what those
commits broke, as far as the diff, their subjects and their files show, and raises a normal finding
if it plainly does not. It also gives at most one line of up to 160 characters: a MUST NOT or
SHOULD NOT sentence, or a test or eval case, that would have caught the regression, or `Covered by
<skill>: <rule>` when a loaded rule already does, or nothing. It is the same idea as a finding's
`prevent`, one level up, and is only kept when the block was given. It is saved as
`regressionPrevent` in `review.json` and shown in the review body and in `report.md` under a
collapsed `Preventing this regression` section; `report.md` also lists the commits. Nothing files an
issue from it. With no commit found the prompt, schema and command line are unchanged.

## Large changes that mix mechanical and other edits

The change-shape section ([Shared context](context.md)) measures a large change from git alone:
hunks that make the same normalised edit, whitespace-only lines, renames, and the config keys that
changed. `review` builds it in the same context run as the pillars' sections but writes none of it
to `review-context.md`; it keeps one structured summary of it, so git runs once. The summary
exists only when a split is worth proposing: the change has at least `SPLIT_MIN_LINES` reviewable
lines, a mechanical part of at least `SPLIT_MIN_MECHANICAL_LINES` lines, `SPLIT_MIN_MECHANICAL_SHARE`
of the change and `SPLIT_MIN_MECHANICAL_FILES` files, and a remainder of at least
`SPLIT_MIN_REMAINDER_LINES` lines and `SPLIT_MIN_REMAINDER_SHARE` of the change (all in
`src/review/context/change-shape/analyze.mts`). A change that is almost all mechanical, or has no
mechanical part, or is only big, gets none: a purely mechanical pull request is fine as it is. Every
number errs toward no proposal: the mechanical lines and files are the larger of the repeated-edit and
whitespace-only measures (so "at least"), the remainder subtracts their sum ("at most"), and a change
whose patch or hunk analysis hit a cap gets none.

With a summary, the verifier prompt gets one more block, the summary as measurement of this diff
(not instructions), and its output schema an optional top-level `splitProposal` string. The
verifier gives one or two sentences (under 240 characters) naming what to move into its own pull
request and what stays, or omits it when a split would not help, for example because the parts
depend on each other. It is advice: it never changes a finding, a severity or the verdict. It is
kept only when the block was given, saved as `splitProposal` in `review.json` and `report.json`,
and shown as one line near the top of the review body (not collapsed) and under `Proposed split` in
`report.md`. A longer one makes `concise` warn. With no summary the prompt, schema and command
line are unchanged.

## The class line

Every posted review (not the notice of a skipped one) carries one line under the
`Reviewed ... effort` line that names the kind of pull request: `**Class:** <impact> · <scope>`.
Two examples:

- `**Class:** maintenance · dependencies-only`
- ``**Class:** breaking (removes the `--foo` CLI flag) · source, tests``

It changes no verdict, plan, label or effort, and it is not part of the `final-review` marker. When
neither part is known there is no line.

The scope comes from file paths alone, never from a model, the title, the labels or the
description. `post` derives it from the pull request's whole file list (base to head, the list it
already reads to place comments), so a hand-written `review.json` gets it too and a light
follow-up still shows the scope of the whole pull request. Each changed file has one kind, from
the same path classification as the rest of the reviewer, checked in this order: `agent
direction` (`AGENTS.md`, `CLAUDE.md`, any `SKILL.md`, files under a `skills/**/references/`
directory and under an `evals/` directory), `ci` (`.github/workflows/` and `.github/actions/`),
`dependencies` (manifests and lockfiles), `tests`, `generated paths`, `docs`, `config`, and
`source`. The line lists the distinct kinds, most files first and at most four. When every file is
of one kind other than source it prints `test-only`, `docs-only`, `agent-direction-only`,
`dependencies-only`, `generated-paths-only`, `ci-only` or `config-only` instead; an all-source
change prints `source`.

The impact is the verifier's judgment, one of `breaking`, `architectural`, `maintenance` or
`unsure`, with a one-line basis (collapsed to one line, at most 160 characters). The defaults:
breaking is a change that makes an existing caller, consumer, stored data or configuration stop
working without a change on their side; architectural is a new dependency on a remote service or
another repository, new persisted state or cache, a new process, queue or command family, or a
change to how components are divided; maintenance is neither. The verifier looks at every effect of the diff, not only its findings: exit codes, allow or config entries that become unused, changed output fields. A behavior change the description does not list is a `medium` congruence finding that asks the author to document it, never `high`; it does not block or hold by itself. The verifier reads the reviewed
repository's root `AGENTS.md` and any document it points to for these words; when they define
them, those definitions win and the basis quotes the sentence used. A definition the pull request
itself adds or changes does not count, so a change cannot reclassify itself. When the verifier cannot tell it answers `unsure` and says what it would need.
Only a full review asks for it: the verifier prompt gets an Impact block and its output schema an
optional `impact` object. A light review shows the scope alone. A hand-written
`review.json` may set `impact` (`{ "kind": ..., "basis": ... }`) too; the verdict never reads it.
It is saved as `impact` in `review.json` and `report.json` and shown under `Impact` in
`report.md`.

## Follow-ups build on this machine's last review

On a follow-up (a light review of the diff since the last reviewed commit, `plan.sinceSha` set),
`review` also reads the most recent review of this pull request in the [tracker](tracker.md)
whose reviewed commit is a strict ancestor of the head, from the same context run as the other
sections (the past-reviews section, which is never written to `review-context.md`). It keeps
a structured form of it: the commit, date, mode, verdict, whether that review was posted (the
saved data says nothing per finding), and its verified findings with severity, pillar, title and
place, read from that run's `report.json`. A first review, a full review, a missing state
directory, and a force-push that orphaned every earlier head get nothing, and the prompt is
unchanged. If the newest such review's run directory or `report.json` is gone or unreadable,
`report.md` says `Earlier review: not given to the verifier (...)` and the review goes on; no
older review stands in.

With one, the verifier prompt gets one more block (not instructions: earlier claims at an older
commit). The re-review is additional: it reports only what is new since that commit or what the
diff since it made wrong, does not repeat a finding that is still open in an unresolved thread of
ours (the re-review step of the verifier already covers it), and reports a fixed one through
`fixedThreadIds`, as before. No output field or schema changes.

Saved evidence is offered only for a source that declares `paths` (see
[evidence](configuration.md#evidence)). `review` reads the earlier run's `evidence.json`, lists with
local `git diff` the paths changed between the commit each source ran against and the head, and
keeps the `checked` sources none of whose `paths` changed. A missing sha, an `evidence.json` saved
without a scope, an unknown scope or a git failure keeps nothing. When any are kept, the verifier
prompt gets a second block after the earlier-review block, naming each source, the commit it ran
against, its status and its saved queries and results (capped at the evidence result limit), and
saying that this earlier evidence still applies because none of the paths it depends on changed
and that it was gathered at that commit and has not been re-run, so where the current code
contradicts it the code is right; the saved text is untrusted data. With no such source the block is absent and the earlier-review block says to
establish again any evidence the review relies on. The evidence step runs on every
follow-up by design: earlier evidence carries over to the verifier, and new evidence may still
block or raise a question for the author. `report.json` records the offered sources as `earlierEvidence`, and `report.md` lists
them.

## Progress and the cost ceiling

`review` writes one line to stderr when each step starts and when it ends, and one when a step
waits on a rate limit:

```text
code-reviewer: pillar.design claude:sonnet started
code-reviewer: pillar.design claude:sonnet waiting 5.0s on a rate limit
code-reviewer: pillar.design claude:sonnet done in 41.2s, $0.31
code-reviewer: verifier claude:opus failed in 9.8s: claude exited with 1
code-reviewer: pillar.security claude:sonnet not started, review stopped: cost ceiling reached ($1.02 of $1.00): pillar.security did not start, so no review was produced
```

The harness and model are those that ran the step; the cost is left out when the harness reported
none. Stdout still carries only the JSON summary, and the lines never reach a prompt or a command
line. `--quiet` turns them off.

`--max-cost USD`, or [`limits.maxCostUsd`](configuration.md#limits), is a circuit breaker for
runaway runs. It is 25 US dollars unless set, well above the few dollars a normal review costs;
raise it for very large pull requests. Once the cost reported so far reaches it,
no further step starts and the review fails whole, never as a partial review. Steps that report no
cost count as zero, and steps already running finish, so the total can pass the ceiling by what they
cost. `review` prints the line above on stderr, then the JSON summary on stdout with
`error` (`cost ceiling reached ($X of $Y)` and the step), `costCeilingReached: true` and `costUsd`
(what the steps spent), and exits 1 like any failed review. No review is written for posting.

## Headless runs

Every headless run passes `--strict-mcp-config --setting-sources user` and
`--settings '{"enabledPlugins":{...}}'` listing each enabled plugin, true only for the configured rule
plugins (`rulePlugins`; by default `no-mistakes-rules` and `jong-skills`, and none for `[]`). That keeps fixed context near 17k tokens instead of
about 139k. Pillar runs also get a read-only `explorer` subagent and no other (Haiku by default, else the `small` tier's first Claude model), because Claude Code's built-in agent types
are denied. The same flags apply to
`bench`, where `--no-rules` sets every plugin false.

A run that has a shell (the history pillar and the evidence run) or a web tool (see `references`) passes `--setting-sources ''`
instead, so no settings file is loaded. User settings can allow commands of their own, or allow
every sandboxed command, and either would widen the run's allow-list. Such a run can execute its
listed prefixes and the read-only commands Claude Code always permits (`echo`, `ls`, `git log` and
the like); a chained or substituted command is denied whole.

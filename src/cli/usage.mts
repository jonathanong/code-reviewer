export const REVIEW_USAGE = `code-reviewer auth
code-reviewer settings (--repo owner/name | --owner LOGIN)
code-reviewer queue (--owner LOGIN | --repo owner/name...)
code-reviewer claim --repo owner/name --pr N [--force]
code-reviewer skip --repo owner/name --pr N --reason TEXT
code-reviewer prepare --repo owner/name --pr N --out DIR [--effort low|medium|high] [--tree DIR] [--clones DIR]
code-reviewer abort --repo owner/name --pr N [--requeue]
code-reviewer review --repo owner/name --pr N --out DIR --tree DIR [--jobs N] [--model STEP=HARNESS:MODEL]... [--max-cost USD] [--quiet] [--clones DIR] [--effort low|medium|high] [--force]
code-reviewer run --repo owner/name --pr N [--post auto|hold] [--effort low|medium|high] [--force] [--jobs N] [--model STEP=HARNESS:MODEL]... [--max-cost USD] [--quiet] [--clones DIR]
code-reviewer context --repo owner/name --pr N --tree DIR [--out DIR] [--skill plugin:name]...
code-reviewer report --out DIR
code-reviewer resolve --repo owner/name --pr N --thread ID [--thread ID]...
code-reviewer post --repo owner/name --pr N --head-sha SHA --input findings.json [--dry-run] [--allow-long] [--body-target N] [--inline-target N]
code-reviewer diff --repo owner/name --pr N
code-reviewer revoke --repo owner/name --pr N
code-reviewer status --repo owner/name --pr N
code-reviewer plugins [--require NAME]...
code-reviewer tracker [--repo owner/name]... [--since ISO_DATE] [--state reviewed|posted|skipped|failed] [--format json|csv|markdown]
code-reviewer explain (--run DIR | --repo owner/name --pr N)
code-reviewer outcomes (--repo owner/name... | --owner LOGIN) [--pr N] [--since DAYS] [--clones DIR]
code-reviewer outcomes digest [--day YYYY-MM-DD] [--out DIR]
code-reviewer issues [--dry-run] [--since DAYS]
code-reviewer doctor [--repo owner/name | --owner LOGIN] [--offline]
code-reviewer models --harness opencode [--free] [--model ID]... [--probes N] [--jobs N] [--out DIR]
code-reviewer bench --cases cases.json --prompts DIR --out DIR [--pillar NAME]... [--case ID]... [--model NAME] [--harness NAME [--reads-outside-checkout]] [--shell PREFIX]... [--effort LEVEL] [--rounds N] [--jobs N] [--max-turns N] [--score-only] [--judge MODEL] [--no-rules] [--select [--select-all-pillars]] [--baseline DIR]
code-reviewer bench-verifier --cases cases.json --findings-from DIR --prompts DIR --out DIR [--case ID]... [--model NAME] [--jobs N] [--max-turns N] [--score-only] [--judge MODEL] [--checker MODEL] [--no-rules]
code-reviewer bench-selection --cases cases.json... --out DIR [--case ID]... [--attempts N] [--jobs N] [--cache DIR] [--score-only]
code-reviewer bench-context [--cases cases.json]... [--history history.json]... --out DIR [--case ID]...
  auth reports whether gh calls use the GitHub App (app.yaml, .yml, .json or .jsonc in the config home ~/.config/code-reviewer, or
  CODE_REVIEWER_APP_ID with CODE_REVIEWER_APP_PRIVATE_KEY or _PATH, which wins) or the local gh
  login. Under App auth it also prints source (env or the App config file path) and
  login (the <app-slug>[bot] identity whose reviews are trusted) or loginError. With --owner or --repo it also checks that the App is installed there; if not it prints installationError and exits 1. queue lists open pull requests
  labeled requested or processing (GraphQL fallback for hook-harness); queue, claim, skip, abort,
  post, revoke and status use the label names from the machine config (<owner>.yaml, <owner>/<name>.yaml; .yml, .json and .jsonc also) and the
  repository's own .code-reviewer.yaml (or .yml, .json, .jsonc) on its default branch (defaults final-review:requested, final-review:in-progress, final-review:complete, final approval).
  settings prints the resolved labels and optional check run for a repository or owner, the
  layer each came from, the harness and model of every step (models), the names of the evidence sources (never commands or env), and any problems, so a session can read the requested label for hook-harness. skip closes a pull request the plan will
  not review: it posts one COMMENT review on the head with --reason and a verdict=Skipped marker,
  then swaps processing and requested for completed and leaves the approval label alone. With
  checkRun configured and GitHub App auth, claim opens a check run, post completes it (success,
  failure, neutral for Approve, Request Changes, Comment), and abort and skip complete it as
  cancelled and skipped; under the gh login the same states are written as a commit status
  (pending, success, failure, error) with the check run name as its context. A check-run or
  status error is reported in the result without losing the review.
  claim swaps requested for processing (and clears completed and approval); it declines a head the
  newest review covers unless --force. prepare writes the
  numbered diff, per-file patches, the follow-up context digest, the diff since the last review,
  and plan.json to --out without model calls, plus rules/INDEX.md: the rule sources for the change
  (this repository's AGENTS.md and skills at the base when --tree is given; the rules of cloned repositories
  the diff imports, or that the reviewer's configs link to the
  change as consumed or as consumers) read from --clones DIR (or CODE_REVIEWER_CLONE_ROOT). abort drops in-progress (--requeue asks again).
  review runs claim, prepare, a Haiku skill selection, the planned pillars (--jobs at a time,
  default 3, each retried once), and the verifier with headless claude runs, then writes
  review.json, preview.md, report.md and report.json to --out and stops before posting. It fails
  closed (abort without requeue, exit 1) when every pillar fails. report re-renders report.md
  from report.json.
  run is the unattended path: it checks the rule plugins, settings and auth, declines a head already
  reviewed or held, requests and claims the pull request, checks the head out in a temporary
  directory, runs review, then posts the review or holds it for a human (--post hold always holds;
  the hold rules are in docs/run.md). It prints one JSON line and exits 0 posted, 10 held, 11 nothing
  to do, 12 precondition or config failure, 13 review or post failure. A held review stays in the run
  directory with the request label back and the command that posts it in postCommand.
  --model STEP=HARNESS:MODEL (review and run, repeatable) sets one step's harness and model for that run, over the models config; a step named twice gets fallbacks in flag order. STEP is select, pillars, pillar.NAME, verifier, verifier.light, evidence or approvalCheck.
  doctor checks, without changing or posting anything, Node, git, gh, the App config, the machine config, the rule plugins (and how current they are), the harness binaries and the state directories, and prints one JSON line {ok, warn, fail, checks}; it exits 1 on a fail (docs/doctor.md).
  --max-cost USD (review and run) is a circuit breaker for runaway runs: once the cost the harnesses reported has reached USD no further step starts and the review fails whole, with nothing to post (the default is 25; a normal review costs a few dollars, so raise it only for very large pull requests); it beats limits.maxCostUsd in the machine config. --quiet turns off the progress lines review and run print to stderr, one when each step starts and ends.
  models lists the models the harness offers (opencode models; --free keeps ids ending in -free and a few known free ones, a naming heuristic; --model replaces the list), runs synthetic probes on each (--probes times each, --jobs at a time), and prints one JSON report on stdout and a table on stderr, ranked by found, valid, then seconds; --out DIR also writes models.json and models.md. It sends only its own tiny synthetic files, never a diff (docs/models.md).
  resolve resolves review threads of fixed findings.
  review and post also append a row to the machine-local tracker, reviews.jsonl in the state home
  ($XDG_STATE_HOME/code-reviewer, default ~/.local/state/code-reviewer, or CODE_REVIEWER_STATE_DIR).
  tracker prints the folded rows, one per pull request head, filtered by --repo, --since and --state.
  explain prints a Markdown explainer of one review for a reader who has not read the code, from the
  files in its run directory; it makes no model call. A tracker error is reported as trackerProblem
  and never fails a review or a post.
  outcomes reads GitHub (never writes) for each review the tracker shows as posted in the last --since days
  (default 30), and records what became of each finding in outcomes.jsonl beside the tracker. outcomes digest
  writes outcomes-DAY.md from those rows. See docs/outcomes.md.
  issues files an issue for each outcomes proposal (a rule or pillar whose findings are mostly rejected or disputed) in the repository the machine config's issues key names for it. Off unless that key is set; nothing else runs it. --dry-run does everything but create. It prints one JSON line {filed, skipped, dryRun}. See docs/issues.md.
  Markers in earlier reviews count only from the reviewer's own identity: the gh viewer, or under
  App auth the App's <app-slug>[bot] from GET /app. If that lookup fails nothing is trusted, and
  reviews from every other author are read as ordinary notes, never as a prior review.
  post renders verified findings as one or more reviews (verdict, reviewed SHA and effort in
  the header; inline comments where the diff allows, the rest in the body). The first is submitted
  as APPROVE, REQUEST_CHANGES or COMMENT to match the verdict, and as COMMENT, reported in the
  output as event and downgraded, on the reviewer's own pull request, when the identity is unknown,
  or when GitHub rejects the event with 422. Posted text over a target (default 1200 characters for a body, 800 for an inline comment,
  hidden marker and collapsed details not counted in a body) and text that narrates the review
  (the verifier, a pillar, tools, praise) are reported in warnings; over three times a target is
  refused unless --allow-long (tooLong lists those). It adds the "final
  approval" label on Approve or removes it otherwise, then marks final-review:complete. It refuses when the head moved. diff prints the pull request
  diff with base and head line numbers on every line, for reviewers to cite. revoke removes
  the label before a re-review. status exits 0 only when the newest review approved the current
  head and the label is present, or skipped the current head. bench runs each pillar prompt against labeled cases from a git checkout of the pre-merge head
  (history up to it, no later commits) and scores recall and precision; --judge grades by claim
  with a model instead of by location. bench also records the skills each run loads and, for cases
  with expectedSkills (full plugin:skill names; an array entry is any-of), reports skills loaded and
  grounded recall (catches that loaded the skill). --baseline DIR is the --out of an earlier
  --no-rules run of the same cases: the summary adds control recall and lift (grounded minus control
  recall over positives both runs scored) and lists cases the control caught. --select runs review's
  skill-selection step for each case first and, as review does, tells the rules pillar to load them;
  --select-all-pillars tells every pillar (the earlier behaviour, for comparison; review has no such option). bench also records each
  run's cost, turns, and tokens and prints a Cost table (total, per run, turns, input tokens) and a
  Tokens by model table (runs, input, output, cost per pillar and model, plus an all row).
  bench --harness NAME runs the pillar agent only on another registered harness (the judge, selection and verifier stay on Claude); --model is then that harness's model id and is required. --reads-outside-checkout
  grants that harness the read access its adapter requires (codex refuses without it); it is never implied. The cost and loaded skills are not reported by such a harness: the tables show a dash and "not reported",
  and the rows are not comparable with Claude rows. --loads-only needs Claude.
  bench --shell PREFIX (repeatable, Claude only, an experiment) adds read-only shell command prefixes such as "git log" to the pillar agent on top of what the pillar already has; real reviews do not grant them. A prefix is a command name and subcommand: empty or with shell syntax (; | & < > backtick $() is refused, as is --shell with another --harness. summary.json and summary.md record the prefixes, and the rows are not comparable with normal rows.
  bench --effort LEVEL (low, medium, high, xhigh; never max) runs the pillar agent at that reasoning effort on Claude or --harness; a review uses only low or medium, so a run at another level is labelled and its rows are not comparable with normal rows. medium is the default and records nothing.
  bench --rounds N (1 to 3, an experiment) runs the pillar agent up to N times per case; each later round is told the findings so far and asked for others, and stops when a round adds none. A finding at a file and line already reported is dropped. The raw result records rounds, roundsRun and the findings each round added; usage is summed. A later round that fails keeps the earlier findings and records roundError. Anything but 1 to 3 fails before any work, as does --loads-only. summary.json and summary.md record the rounds, and the rows are not comparable with normal rows.
  bench-verifier records and prints the same by model for its verifier and checker runs. review
  shows cost and tokens by model for the whole review in report.json and report.md.
  bench-verifier runs only the verifier, one call per case
  and no subagents, on the pillar findings a bench --out DIR saved (each judged-real finding is
  also planted under a second pillar), and scores real findings kept, label recall, severity
  agreement, duplicates merged, and other blocking and high findings confirmed by --checker;
  --prompts is the skill's references directory.
  bench-selection runs only the Haiku skill-selection step (the same call review makes) on the
  cases that declare expectedSkills, --attempts times each (default 3), and writes one raw file per
  attempt to --out/raw/<case>/<n>.json. It scores how often every expected skill is selected, per
  case and per expected skill, with mean skills selected and cost by model. It does not run a
  reviewer, so it does not show that a selected skill is then loaded or applied. --cache DIR
  reuses the clone cache of an earlier bench; --score-only re-scores saved attempts.
  bench-context makes no model call: for each case with expectedSkills it builds the rule-excerpts
  section for exactly those skills and reports each skill quoted in full, in part or not, and
  whether each expectedRules text is quoted, cut, or missing from the installed skill; --history
  files build small git repositories and check the history sections find the commits. It exits 0. bench and bench-verifier stage the same rule sources under
  .review/rules (fixtures may hold
  dependency and consumer repositories under repos/, and configs under configs/ keyed by
  the case's repoId); --no-rules stages none and withholds the Skill tool, for control
  runs. Shared rules come only from installed plugin skills; pillar runs may load them, and each raw result
  records the enabled plugins and versions. plugins prints the enabled Claude Code plugins and
  exits 1 when a --require name is not among them.

`

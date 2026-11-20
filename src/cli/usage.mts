export const REVIEW_USAGE = `code-reviewer auth
code-reviewer settings (--repo owner/name | --owner LOGIN)
code-reviewer queue (--owner LOGIN | --repo owner/name...)
code-reviewer claim --repo owner/name --pr N [--force]
code-reviewer skip --repo owner/name --pr N --reason TEXT
code-reviewer prepare --repo owner/name --pr N --out DIR [--effort low|medium|high] [--tree DIR] [--clones DIR]
code-reviewer abort --repo owner/name --pr N [--requeue]
code-reviewer review --repo owner/name --pr N --out DIR --tree DIR [--jobs N] [--clones DIR] [--effort low|medium|high] [--force]
code-reviewer report --out DIR
code-reviewer resolve --repo owner/name --pr N --thread ID [--thread ID]...
code-reviewer post --repo owner/name --pr N --head-sha SHA --input findings.json [--dry-run]
code-reviewer diff --repo owner/name --pr N
code-reviewer revoke --repo owner/name --pr N
code-reviewer status --repo owner/name --pr N
code-reviewer plugins [--require NAME]...
code-reviewer bench --cases cases.json --prompts DIR --out DIR [--pillar NAME]... [--case ID]... [--model NAME] [--jobs N] [--max-turns N] [--score-only] [--judge MODEL] [--no-rules] [--select] [--baseline DIR]
code-reviewer bench-verifier --cases cases.json --findings-from DIR --prompts DIR --out DIR [--case ID]... [--model NAME] [--jobs N] [--max-turns N] [--score-only] [--judge MODEL] [--checker MODEL] [--no-rules]
code-reviewer bench-selection --cases cases.json... --out DIR [--case ID]... [--attempts N] [--jobs N] [--cache DIR] [--score-only]
  auth reports whether gh calls use the GitHub App (CODE_REVIEWER_APP_ID with
  CODE_REVIEWER_APP_PRIVATE_KEY or _PATH) or the local gh login. Under App auth it also prints
  login (the <app-slug>[bot] identity whose reviews are trusted) or loginError. queue lists open pull requests
  labeled requested or processing (GraphQL fallback for hook-harness); queue, claim, skip, abort,
  post, revoke and status use the label names from the machine config (<owner>.json, <owner>/<name>.json) and the
  repository's own .code-reviewer.json on its default branch (defaults final-review:requested, final-review:in-progress, final-review:complete, final approval).
  settings prints the resolved labels and optional check run for a repository or owner, the
  layer each came from, the names of the evidence sources (never commands or env), and any problems, so a session can read the requested label for hook-harness. skip closes a pull request the plan will
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
  resolve resolves review threads of fixed findings.
  Markers in earlier reviews count only from the reviewer's own identity: the gh viewer, or under
  App auth the App's <app-slug>[bot] from GET /app. If that lookup fails nothing is trusted, and
  reviews from every other author are read as ordinary notes, never as a prior review.
  post renders verified findings as one or more COMMENT reviews (verdict, reviewed SHA and effort in
  the header; inline comments where the diff allows, the rest in the body) and adds the "final
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
  skill-selection step for each case first and tells each pillar which skills to load. bench also records each
  run's cost, turns, and tokens and prints a Cost table (total, per run, turns, input tokens) and a
  Tokens by model table (runs, input, output, cost per pillar and model, plus an all row).
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
  reuses the clone cache of an earlier bench; --score-only re-scores saved attempts. bench and bench-verifier stage the same rule sources under
  .review/rules (fixtures may hold
  dependency and consumer repositories under repos/, and configs under configs/ keyed by
  the case's repoId); --no-rules stages none and withholds the Skill tool, for control
  runs. Shared rules come only from installed plugin skills; pillar runs may load them, and each raw result
  records the enabled plugins and versions. plugins prints the enabled Claude Code plugins and
  exits 1 when a --require name is not among them.

`

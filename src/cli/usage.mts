export const FINAL_REVIEW_USAGE = `vouchington-reviewer auth
vouchington-reviewer queue (--owner LOGIN | --repo owner/name...)
vouchington-reviewer claim --repo owner/name --pr N [--force]
vouchington-reviewer prepare --repo owner/name --pr N --out DIR [--effort low|medium|high] [--tree DIR]
vouchington-reviewer abort --repo owner/name --pr N [--requeue]
vouchington-reviewer resolve --repo owner/name --pr N --thread ID [--thread ID]...
vouchington-reviewer post --repo owner/name --pr N --head-sha SHA --input findings.json [--dry-run]
vouchington-reviewer diff --repo owner/name --pr N
vouchington-reviewer revoke --repo owner/name --pr N
vouchington-reviewer status --repo owner/name --pr N
vouchington-reviewer bench --cases cases.json --prompts DIR --out DIR [--pillar NAME]... [--case ID]... [--model NAME] [--jobs N] [--max-turns N] [--score-only] [--judge MODEL]
vouchington-reviewer bench-verifier --cases cases.json --findings-from DIR --prompts DIR --out DIR [--case ID]... [--model NAME] [--jobs N] [--max-turns N] [--score-only] [--judge MODEL] [--checker MODEL]
  auth reports whether gh calls use the GitHub App (FINAL_REVIEWER_APP_ID with
  FINAL_REVIEWER_APP_PRIVATE_KEY or _PATH) or the local gh login. queue lists open pull requests
  labeled final-review:requested or final-review:in-progress (GraphQL fallback for hook-harness).
  claim swaps final-review:requested for final-review:in-progress (and clears complete and final
  approval); it declines a head the newest final review covers unless --force. prepare writes the
  numbered diff, per-file patches, the follow-up context digest, the diff since the last review,
  and plan.json to --out without model calls. abort drops in-progress (--requeue asks again).
  resolve resolves review threads of fixed findings.
  post renders verified findings as one or more COMMENT reviews (verdict, reviewed SHA and effort in
  the header; inline comments where the diff allows, the rest in the body) and adds the "final
  approval" label on Approve or removes it otherwise, then marks final-review:complete. It refuses when the head moved. diff prints the pull request
  diff with base and head line numbers on every line, for reviewers to cite. revoke removes
  the label before a re-review. status exits 0 only when the newest final review approved the current
  head and the label is present. bench runs each pillar prompt against labeled cases from a git-free
  snapshot of the pre-merge head and scores recall and precision; --judge grades by claim
  with a model instead of by location. bench-verifier runs only the verifier, one call per case
  and no subagents, on the pillar findings a bench --out DIR saved (each judged-real finding is
  also planted under a second pillar), and scores real findings kept, label recall, severity
  agreement, duplicates merged, and other blocking and high findings confirmed by --checker;
  --prompts is the skill's references directory.

`

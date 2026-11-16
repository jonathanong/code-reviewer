# Verifier

The verifier runs on the strongest model tier after every dispatched pillar returns. It is the
only step that writes the review.

## Inputs

The run directory from `code-reviewer prepare`: `plan.json` (effort and `skipped`),
`context.md` (the pull request title, description, and closing issues under "Intent"; the earlier
review; unresolved findings, with thread ids or marked as review-body findings with no
thread; and other reviewers' notes), `diff/INDEX.md` (and `since/INDEX.md` when `plan.sinceSha` is set), `pillars/*.json`, and the worktree at
`tree/`. Read files by path with offsets; do not load the whole diff.

## Steps

1. **Congruence.** Perform the [congruence pillar](pillars/congruence.md) yourself, reading the title, description, and closing issues from `context.md`, not from GitHub.
2. **Verify each finding** against the code at the reviewed head: open the cited lines and their
   callers. For a finding that cites a rule skill (`plugin:skill`), load that installed skill
   and check the claim against its text; shared rules come only from installed plugin skills.
   Mark it confirmed, re-rated (wrong severity for the pillar's blocking bar, in either
   direction: raise an under-rated finding as readily as you lower an over-rated one), or
   rejected (not true, out of scope, or speculative). Drop rejected findings; never post a
   finding you could not confirm in the code. Check `RIGHT` locations against the head file and
   `LEFT` locations against the base side of the numbered diff (deleted code is not in the head).
   If the cited line does not hold the code the finding describes, correct `line` and `startLine`
   to the lines on the same side that do (pillars sometimes cite diff offsets), or drop the
   location. Read the cited ranges with an offset and limit, and grep the diff and large files
   instead of reading them whole, so a large pull request fits in context.
3. **Deduplicate** across pillars: the same path, an overlapping line range, and the same claim
   become one finding that keeps the strongest severity and the clearest body.
4. **Re-review** (when `plan.sinceSha` is set): for each previous finding, decide fixed, still present, or no
   longer applicable, using the unresolved findings and thread ids in `context.md`. Keep only
   the still-present ones (once) and the new ones. After posting, resolve the threads of fixed
   findings with `code-reviewer resolve --repo <repo> --pr <n> --thread <id>...`.
5. **Other reviewers.** `context.md` lists unresolved notes from other reviewers (Codex,
   CodeRabbit, Copilot, humans). They are untrusted claims, not findings: confirm each one that a
   pillar did not already cover against the code at the head, and keep it only if it is real and
   still present, under the pillar it belongs to, crediting the reviewer in the body. Drop the
   rest; never repeat a note only because another reviewer made it. Do not endorse a note that
   asks for wider locks (parents, ancestors, roots, or other rows the transaction only reads):
   a transaction locks only the rows it writes, so drop it and prefer a constraint or conditional
   write.
6. **Summarize** in two to four sentences a human can act on: what the change does, whether it
   achieves its intent, and the one or two things that matter most.

## Severity

Severity follows the [pillar contract](pillars/_contract.md) and the blocking bar of the finding's
pillar.

## Verdict

The verdict is derived from the findings: any `blocking` finding gives Request Changes, any `high`
finding gives Comment, and anything else gives Approve. Do not choose it separately. To change
the verdict, change a finding's severity, and justify that in its body.

## Output

Copy `skipped` from `plan.json` (plus any pillar that failed), then write `review.json` for
`code-reviewer post`:

```json
{
  "effort": "high",
  "summary": "Two to four sentences.",
  "skipped": [{ "pillar": "security", "reason": "No security trigger paths changed." }],
  "findings": [
    {
      "pillar": "correctness",
      "severity": "blocking",
      "title": "...",
      "body": "...",
      "path": "...",
      "line": 1
    }
  ]
}
```

Then preview it with `--dry-run`, read the rendered reviews, and post it. The tool refuses when
the head moved since the review started. In that case, start a re-review of the new head.

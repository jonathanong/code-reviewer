# Carrying an approval: `carry`

```bash
code-reviewer carry --repo owner/name --pr N --from-sha OLD [--allow-delta] [--dry-run] [--clones DIR]
```

`carry` re-posts an earlier approval onto a new head of the same pull request without any model
call, after comparing the change under review at `OLD` against the change under review at the
current head.

## Preconditions

1. `--repo`, `--pr`, and `--from-sha` (a full 40-character lowercase SHA) must be valid, and the
   repository's machine and target config must have no problems. Under GitHub App auth, the App
   must be installed for the repository and able to resolve its own login.
2. `carry` reads the pull request's current head and base from GitHub. If the current head already
   equals `OLD`, it prints a JSON `noop` object and exits `11` (the same nothing-to-do exit code
   [`run`](run.md#exit-codes) uses).
3. `OLD` must have a posted `Approve` review from this reviewer. `carry` checks both the pull
   request's trusted review markers (the newest non-skip review of `OLD` from the reviewer's own
   identity, using `latestInstance`) and the machine-local tracker (`reviews.jsonl` and its saved
   `review.json`). If `OLD` is unknown, unposted, not an approval, or GitHub and the local tracker
   disagree on its verdict, `carry` stops with exit code `2`.

## How diffs are compared

`carry` uses local git in the reviewer's clone (found under `--clones` or
`CODE_REVIEWER_CLONE_ROOT`), or creates a temporary blobless `--no-checkout` clone in the OS temp
directory and deletes it on exit.

It fetches the base, `OLD`, and the current head as needed, then computes two zero-context,
no-rename binary diffs:

- `merge-base(OLD, base)..OLD`
- `merge-base(NEW, base)..NEW`

Each file's diff is compared after dropping hunk positions (`@@`) and blob hashes (`index`), so a
clean merge of the base branch or a rebase that shifts line numbers compares identical.

**Known limit:** because hunk positions and surrounding context are ignored, an identical
replacement made at a different place in the same file compares as identical.

## Posting and deltas

- **Identical changes:** `carry` posts an `Approve` review with no findings and a concise summary
  stating that the approval is carried from `OLD` (short SHA) by diff. It goes through the same
  posting path as [`post`](posting.md): approval and lifecycle labels, the configured check run,
  read-back confirmation, the machine-local tracker `posted` row, and the head-moved check (if the
  head moves between reading it and posting, `carry` fails the same way `post` does).
- **Different changes (default, fail-closed):** `carry` prints the differing files with their added
  and removed line counts and the patch of the difference, then exits `1` without posting or
  changing labels.
- **With `--allow-delta`:** the caller asserts they have inspected the delta. `carry` posts the
  carried approval and lists the differing files in the summary.
- **With `--dry-run`:** prints the JSON review payload that would be posted (still refusing a delta
  unless `--allow-delta` is also passed) and posts nothing.

## Exit codes

| Code | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| `0`  | Carried approval posted, or `--dry-run` preview printed.                                     |
| `1`  | Changes differ from `OLD` and `--allow-delta` was not passed; delta printed, nothing posted. |
| `2`  | Usage, configuration, auth, source-approval, git, or head-moved error.                       |
| `11` | Current head already equals `OLD` (nothing to do).                                           |

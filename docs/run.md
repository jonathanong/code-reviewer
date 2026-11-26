# Unattended runs: `run`

```bash
code-reviewer run --repo owner/name --pr N [--post auto|hold] [--effort low|medium|high] [--model STEP=HARNESS:MODEL]... [--max-cost USD] [--quiet] [--force] [--jobs N] [--clones DIR] [--focus FILE]
```

`run` takes one pull request from a label request to a posted or held review in one process, for
a session that dispatches it without watching. It:

1. Checks the preconditions: every configured rule plugin (by default `no-mistakes-rules` and `jong-skills`; see [`rulePlugins`](configuration.md#ruleplugins)) is enabled at user scope,
   the machine config and the repository's own file have no problems (the same check `review` makes), and auth resolves.
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

Progress goes to stderr: the lines `review` writes for each step (see
[Progress and the cost ceiling](review.md#progress-and-the-cost-ceiling)), which `--quiet` turns
off. Stdout is exactly one JSON line. `--max-cost USD` sets the review's cost ceiling (a circuit breaker for runaway runs) over
[`limits.maxCostUsd`](configuration.md#limits), which is 25 US dollars by default (a normal review costs a few dollars; raise it for very large pull requests); a bad value fails the precondition check.

## Exit codes

Defined once, in [`src/run/output.mts`](../src/run/output.mts). They avoid 1 and 2, which other
commands use.

| Code | `outcome` | Meaning                                                                             |
| ---- | --------- | ----------------------------------------------------------------------------------- |
| 0    | `posted`  | The review was posted, or a skip plan was closed out.                               |
| 10   | `held`    | The review is finished and waits for a human. Nothing was posted.                   |
| 11   | `noop`    | Nothing to do; `reason` says why (already reviewed, in progress, held, claim lost). |
| 12   | `error`   | A precondition or a flag failed before any label changed.                           |
| 13   | `error`   | The run failed after starting; the claim was released.                              |

## The JSON line

`repo`, `pr`, `headSha`, `outcome`, `exitCode`, `verdict`, `event` (the posted review event),
`held` (the rules that matched), `findings` (counts by severity), `questions`, `flags` (the kind of each flag the review raised), `reviewUrl`,
`reviewIds` (the reviews `post` read back, one per part), `approvalCheck` (`upheld`, `changed` or
`failed`, when the review ran the second check on an approval), `costUsd`, `tokens`, `mode`, `tree` (`worktree` or `clone`), `runDir`, `explainPath`,
`postCommand`, `attention`, `problems` and `reason`. Fields that do not apply are `null`, or `[]`
for lists. `attention` is a list of short reasons a person should look; it is empty when a clean
review was posted. A posted review's `attention` also carries the warnings `post` printed: a
duplicate review, an earlier request for changes left undismissed, or a review it could not
confirm. Warnings about the wording itself (text over its length target, narration) are not in
`attention`; they are in `post`'s own output.

`explainPath` is a Markdown file `run` always writes with the output of `explain`, for posted and
held runs alike, so the review can be read or attached to a document. `run` talks to no document
service.

## Hold rules

A hold rule keeps a finished review from being posted. Every rule is on by default and can be
switched off in machine config. `--post hold` holds every run (`held` lists `post-hold`).

| Rule               | Holds when                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `unclear-intent`   | The review has open questions.                                                                                                |
| `flagged`          | The review raised a flag: a concern only a person can settle (see [Flags](review.md#flags)). Posted text does not change.     |
| `large-change`     | The change is over `largeChange.files` files or `largeChange.lines` changed lines, or the diff or conversation was cut short. |
| `risky-change`     | The change touches a risky path (below).                                                                                      |
| `partial-failure`  | A pillar, the evidence run or the verifier failed or was blocked, or the approval's second check did not complete.            |
| `not-app-identity` | Calls use the local `gh` login and not the GitHub App.                                                                        |
| `text-too-long`    | Posted text is over three times its target, which `post` would refuse.                                                        |

A risky path is one a human should read the review for, which is narrower than what sends the
change to the security pillar. By default it is a source file that is not a test or a doc and that
is named for auth or secrets (`auth`, `session`, `permission`, `crypto`, `secret`, `password`,
`credential`, `jwt`; a UI component under `auth/` counts, a story does not), a GitHub workflow or
`action.yml`, a migration or `.sql` file, or infrastructure (Terraform or OpenTofu, a Dockerfile,
`iam`). Manifests, lockfiles and shell scripts do not count. `run.riskyPaths` replaces that list.

A held run releases the claim and puts the request label back, so the pull request stays visible
in `queue`. It leaves the review in `runDir` and the tracker row at `reviewed`, which makes a
later `run` of the same head a no-op rather than a loop. `queue` reports such a pull request as
`held`, with its `runDir`, instead of `requested`, so a loop can tell it from a fresh request; it
is `held` only while the head is the one reviewed and `review.json` is still there. With `--post auto`, a held review is
posted by a human, after reading the document at `explainPath`, with the printed `postCommand`
(`code-reviewer post ... --input RUNDIR/review.json`), which clears the request label along with
the in-progress one. `run --force` reviews the head again.

## When the cost ceiling stops a review

A review that reaches [the cost ceiling](configuration.md#limits) has nothing to post, so `run`
holds the pull request instead of failing it: exit 10, `outcome` `held`, `held: ["cost-ceiling"]`,
`reason` and `attention` carrying the `cost ceiling reached ($X of $Y)` message, `costUsd` the
spend so far, and no `postCommand` or `explainPath`. The claim is released and the request label
put back, so the pull request stays in `queue`. The tracker row is `failed` with the same reason
and the cost, and a later `run` of that head is a no-op (11) that says so, so nothing retries it at
the same cost. A human raises the ceiling or looks at the pull request, then reviews again with
`--force`. It is not a harness failure and adds nothing to `harness-failures.jsonl`.

## When the post is not certain

If `post` submitted the review but could not read it back, `run` still reports `posted` (the
labels moved and the tracker row was written) and lists the problem in `problems` and `attention`:
look at the pull request. If `post` throws because the review may or may not have landed, `run`
exits 13 with a `reason` that says so, releases the claim without requeueing, and leaves
`postCommand` null. The review stays unposted in `runDir` with a `reviewed` tracker row, so a
later `run` of the same head is a no-op (11) and cannot start a second review of it. A person
checks the pull request, then posts with `post` or reviews again with `--force`.

GitHub retry warnings stay on stderr, after the JSON line; stdout is still exactly one line.

## Config

A machine-only key, in the files described under [Configuration](configuration.md). A repository's
own `.code-reviewer` file cannot set it, because it comes from the reviewed repository. Unknown
rule names and keys are a config problem, which fails the precondition check.

```json
{
  "run": {
    "rules": { "risky-change": false },
    "largeChange": { "files": 80, "lines": 2000 },
    "riskyPaths": ["**/payments/**", "**/*.tf"]
  }
}
```

- `run.rules`: each rule above, `true` or `false`.
- `run.largeChange`: `files` and `lines`, positive integers. Defaults: 50 files, 1,000 lines.
- `run.riskyPaths`: glob patterns that replace the default risky paths; `[]` makes no path risky.
  Test and doc paths never count.

## Using it from another agent session

The `code-reviewer` plugin and the CLI must be installed for that session: the plugin's `bin/`
puts `code-reviewer` on the session's `PATH`, and a session without the plugin has no
`code-reviewer` command. A session on the standing loop dispatches `run` as a background command
per label event, at most three at once, and reads only the JSON line and the exit code. `run` is
safe to call concurrently for the same pull request: the label claim lets one win and the rest
exit 11. Two calls that read the labels in the same instant can both try to claim; the loser's
claim fails and exits 11 too. See
[`skills/review-loop/SKILL.md`](../skills/review-loop/SKILL.md).

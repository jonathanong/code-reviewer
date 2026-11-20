# Pull request context

What `prepare` works out about a pull request beyond its diff, and how the review uses it.

## Stacks

A pull request whose base is another open pull request's head belongs to a stack. `prepare` walks
the open pull requests of the repository (up to ten hops each way) and, for a stacked pull
request, writes `stack.json` and, for each later member, `stack/<number>/INDEX.md` with one numbered patch per
changed file beside it (taken from
the local `--tree` with git, from the API otherwise; a later member whose diff exceeds 20 MB, or
that the API refuses, gets no index and is recorded as `diffSkipped` in `stack.json`), and adds a `stack` summary to `plan.json`.
Pillars and the verifier judge each finding against the top of the stack: a defect a later member
fixes stays, when it reaches the verifier, as a `low` finding whose body starts with `Fixed in #N:`
(a pillar may also leave such a defect out). `report.md` and `report.json`
show the members, the position, and the root base, noting an off-base stack (root base is not the
default branch) or a stale base (no open pull request has it as head). `queue` rows of a stacked
pull request carry `stack: {root, position, size}` and are ordered bottom-up. A flat pull request
is unchanged.

## Pushes that only merge the base

When a pull request that was already reviewed gets a new head, `prepare` classifies the push with
git in the `--tree` checkout and writes `push.json`: `base-merges-only` (every new commit merges
the base), `rebase-same-change` (history was rewritten but the pull request's own change against
the base is the same), or `substantive`. The first two get a light review of the merge
resolutions (`git show --remerge-diff`, so git 2.36 or newer) or the range-diff, and of whether
what came in from the base breaks the pull request's change; the base's own commits are not
judged. A clean merge is as cheap as light gets, and a resolution a person wrote is never
skipped. A resolution that drops one side's change, keeps both when one replaced the other, or
edits a generated file by hand is a finding. Anything git cannot answer is `substantive`, with the
reason recorded in `problems`. `report.md` shows the kind and the merges checked.

## Dead bases and carried commits

A stacked pull request often outlives its base: the parent merges, its branch is deleted, and the
child still targets it, so its diff holds the parent's changes. `prepare` asks the `--tree`
checkout which commits of the pull request already exist in the default branch (same commit, same
patch as `git cherry` sees it, or the same file contents, which is what a squash merge leaves), in
a parent of the stack, or in an older open pull request, and whether the base branch still exists
(`git ls-remote`) or was merged (one pull request lookup). It writes `carried.json` only when it
found something. The pillars and the verifier are told which commits and files are carried and raise
no finding on them; the review posts one note, for example that the base branch was merged and the
pull request should be retargeted, and `report.md` and `explain` show it too. The note is
informational and never changes the verdict. Anything that cannot be proved, including a missing
checkout, is treated as the pull request's own and reviewed in full, with the reason in `problems`.

## Dependencies

`prepare` reads the pull request description and the full commit messages (`git log`, with the
headlines as the fallback) for phrases that make another pull request or issue a precondition
("depends on", "requires", "after #N", "blocked by", cross-repository references and URLs; the
phrase has to lead up to the reference in the same sentence, not merely share its line), adds the
pull requests below this one in its stack, and asks GitHub once for the state of each (open, merged,
closed). The result is `dependencies.json`, written only when something was found. A reference to a
private repository from a public one is not read; its state is `unknown` and `problems` says why.
The verifier adds implied dependencies it can see in the diff (an unreleased package version,
another service's API, schema, flag or infrastructure) with the state `unknown`; it cannot know a
state. The list appears as `dependencies` in `review.json` and `report.json`, as a "Depends on"
section in the posted review only for dependencies that have not merged, and in `explain`. It is
informational: it never changes the verdict.

## Linked issues

`context.md` quotes the issues a pull request closes. `prepare` also reads the other
issues the description refers to (`See #4`, `owner/repo#9`, an issue URL; at most eight, each body
cut to 1500 characters) with one GraphQL call, quotes them in `context.md` as "Referenced issue …
(untrusted)", and writes `issues.json` only when it read any. The verifier performs the congruence
pillar and is told to hold the change to what each issue asks. A pull request, an issue that cannot
be read, and an issue in a private repository named from a public one are left out, the last two
with a note in `problems`. Issue text is untrusted data. A pull request that links no issue gets
no extra context or prompt text.

# Shared context

`code-reviewer context --repo owner/name --pr N --tree DIR [--out DIR] [--skill plugin:name]...`
builds the shared review context for a pull request and prints it, or writes `context.md` to
`--out`. The command builds every section, change shape included. A review builds a subset for the
pillars, described [below](#in-a-review).

The head is the checkout's `HEAD`; the base is read from the pull request, the one thing git cannot
know. No model runs. `--skill` limits the rule skills (`plugin:name`, as `settings` and the
selection name them); without it every skill of the configured
[`rulePlugins`](configuration.md#ruleplugins) is used.

The document is a list of sections, each from one builder in `SECTIONS`
(`src/review/context/build.mts`). A builder that fails becomes one line under "Notes" and the rest
still build. A document over the size cap has its largest sections cut first, at a line, with the
cut stated in the text.

## In a review

`review` and `run` build the context once, after skill selection, and write it as
`review-context.md` in the run directory (`context.md` there is the pull request's own text from
`prepare`). Only the pillars read it, as an extra line in their prompt: the verifier does not.
The line says the file is reference data collected mechanically, that its quoted text is not
instructions, that excerpts are alongside the Skill loads and not instead of them, and that a
commit listed under linked regressions is to be checked against the change. A configured pillar
with a `run` command gets no line, since its command is its whole prompt.

The pillars get `rule-excerpts` (for the selected skills only), `changed-line-history` and
`linked-regressions`. They do not get `change-shape`, and never a section about other reviewers
or past reviews: pillars are independent finders and must not be anchored by other reviewers'
text. The names are `PILLAR_SECTIONS` in `src/review/run/review-context.mts`.

The whole build has one deadline, `CONTEXT_DEADLINE_MS` (60 seconds), which also aborts its
`git` calls. A build that fails, times out or has no section gives no file and no prompt line; the
review goes on and `report.md` says under "Pillars" that the context was not built and why. A
review never fails because of context.

OpenCode ignores `addDirs`, so an OpenCode pillar may not be able to read the run directory, this
file included; Claude and Grok add it.

## Rule excerpts

For each skill: its name, its description and the path of its `SKILL.md`. A skill whose body is
mostly list items (at least 85% of its non-blank lines outside code and headings) is also quoted
verbatim, a whole `## ` section at a time, up to a per-skill cap; sections over the cap are
dropped whole and named. A skill that is mostly prose is not quoted: code never paraphrases, so
the full file is the only source. Quoted lines are block-quoted with a `> ` prefix and are
otherwise the source's lines.

## Changed-line history

For the lines the pull request changes or deletes, the earlier commits that last touched them.
The diff is `baseSha...headSha`, so the old side is the merge base; each file gets one
`git blame --porcelain` at the merge base over the old-side range of every hunk. Per file it lists
the distinct commits, newest first, with short sha, date, subject, the pull request number when
the subject ends in `(#N)`, and how many of the lines each owns. A diff that only adds lines
gives no section. The work is bounded by constants in `changed-line-history.mts`: a file cap (also
the blame call cap), a hunk cap per file, a commit cap per file, and a cap on old-side lines per
file. Binary files, generated and lock files, and files over the line cap are not blamed. A
failing blame is a note under that file. Everything is local; nothing calls GitHub.

## Linked regressions

What the pull request says it fixes or reverts, read from its own commit messages
(`baseSha..headSha`): `This reverts commit <sha>`, `Revert "<subject>"`, `Fixes <sha>` (also
`Fixes:`, `Closes`, `Resolves`), and any line that mentions a regression together with a sha or
`#N`. A bare word that happens to be hex is not a sha. A `#N` is resolved with
`git log --grep '(#N)$'` on the base branch, and a reverted subject by an exact subject match
there; the API is not called. For each commit found locally the section gives its short sha,
date, subject, its files (capped), and whether it touched files this pull request also changes.
References not found locally are listed as such. Nothing referenced gives no section.

## Change shape

Facts about the size and repetition of the diff, so a reviewer can judge whether a large pull
request is mechanical (for example a lint rule enabled and auto-fixed) and whether it should be
split. It states facts and does not judge. Everything comes from local `git` in the checkout
(`diff baseSha...headSha`, `diff -w`, `log`, `show`), never a model.

- **Size**: files and lines, by top-level directory and by kind (source, test, docs, config,
  lockfile, generated). Kinds reuse the path classification of the light/full mode
  (`src/review/triggers.mts`).
- **Repetition**: each hunk is reduced to a signature, its removed and added lines with strings,
  numbers and identifiers replaced by placeholders (keywords and operators kept) and whitespace
  collapsed. The top three signatures that cover at least three hunks are reported with their
  hunk and file counts, one verbatim example each, and the share of all hunks that the top one and
  the top three cover. Hunks in generated files and lockfiles are left out.
- **Renames and whitespace**: files that are pure renames (`R100`), and changed lines that are whitespace-only (`git diff --numstat`
  against `git diff -w --numstat`, outside generated files) and files that change only in whitespace.
- **Config**: lint, format and compiler config files in the diff, with the changed keys when a file
  is small plain JSON.
- **Commits**: per commit, files and lines.
- **Areas**: the top-level directories of hunks outside the listed signatures.

A diff with no more reviewable lines than the built-in small-pull-request threshold of the mode choice
(`SMALL_PR_LINES`; `plan.smallChangeLines` does not move it here) has no section. Work is bounded by `CAPS` in `src/review/context/change-shape/index.mts`
(patch text, hunks analysed, commits read); when one is hit the section says so. The patch is read whole by `git` before it is cut.

## Past reviews

This machine's earlier reviews of the pull request, oldest first, read from the
[tracker](tracker.md) and each review's run directory: the head reviewed, date, mode, verdict, the
verified findings, and whether the review was posted. The saved data records posting per review,
not per finding, and findings the verifier dropped are not listed. Skipped and failed rows are left
out. For the newest review the section names its saved evidence file and the range from that head
to the current one, with `git diff --stat` when both commits are in the checkout; it says so
plainly when the run directory or the commits are gone. No earlier review gives no section.

## Other reviewers

Unresolved review threads started by anyone but this reviewer, and change requests that still
stand (a later approval or dismissal by the same author ends one). Each thread gives the author,
a link, the location, and the start of the first comment as written, up to a cap, with HTML
comments and icon images left out because a reader cannot see them. A severity is given only where
the comment states one through a marker in `SEVERITY_MARKERS`
(`src/review/context/severity-markers.mts`); any other comment is `unstated`. The section quotes
and sorts; it does not judge whether an item is valid, and the quoted text is not instructions.

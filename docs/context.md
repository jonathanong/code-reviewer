# Shared context

`code-reviewer context --repo owner/name --pr N --tree DIR [--out DIR] [--skill plugin:name]...`
builds the context that every pillar could share and prints it, or writes `context.md` to `--out`.
**No review reads it yet**: `review` and `run` do not call the builder, and no prompt changes.

The head is the checkout's `HEAD`; the base is read from the pull request, the one thing git cannot
know. No model runs. `--skill` limits the rule skills (`plugin:name`, as `settings` and the
selection name them); without it every skill of the configured
[`rulePlugins`](configuration.md#ruleplugins) is used.

The document is a list of sections, each from one builder in `SECTIONS`
(`src/review/context/build.mts`). A builder that fails becomes one line under "Notes" and the rest
still build. A document over the size cap has its largest sections cut first, at a line, with the
cut stated in the text.

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

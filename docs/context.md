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

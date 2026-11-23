# Code analysis tools

`analysis` lets the pillars and the verifier run a read-only code-analysis command line tool in
the checkout, for example to ask who calls a changed export instead of searching for it. It is off
by default: with no `analysis` key every prompt and flag is unchanged.

It is machine-only, like [`evidence`](configuration.md#evidence): `analysis` in a repository's own
`.code-reviewer` file is ignored with a problem, because it grants shell commands. A repository
file's list replaces its owner file's list whole; `[]` switches it off.

```yaml
analysis:
  - name: no-mistakes
    description: 'Code graph queries: dependents, importers, exports and call sites.'
    guide: { file: ~/guides/no-mistakes-analysis.md } # or { repo, path }, or { text: "..." }
    commands:
      - no-mistakes dependents
      - no-mistakes dependencies
      - no-mistakes importers
      - no-mistakes exports-of
      - no-mistakes dead-exports
      - no-mistakes call-sites
      - no-mistakes symbols
      - no-mistakes flow
      - no-mistakes import-usages
      - no-mistakes resolve-check
```

- `name`: a simple identifier, unique in the list.
- `description`: one line on what the tool answers.
- `guide`: when and how to use it. `{ text }` is inline; `{ repo, path }` and `{ file }` read as an
  evidence guide does. A tool whose guide cannot be read is left out of that review, commands
  included.
- `commands`: command prefixes of plain words (letters, digits and `. _ / -`, single spaces),
  each allowed as `Bash(<prefix>:*)`. A prefix must have at least two words, so a grant is never
  a whole binary. A tool with a bad entry is ignored with a problem naming the file and key, and
  grants nothing.

Every pillar, in every mode, and the verifier get those prefixes in addition to what they already
have (the history pillar keeps `git log` and `git show`), and a "Code analysis tools" section in
the prompt listing each tool's name, description, commands and guide. The working directory is
the checkout at the pull request head. The skill selection, the approval check and the evidence
run are unchanged. A run that holds a shell loads no user settings file, as the history pillar
already does.

A harness whose adapter refuses shell grants (Grok, OpenCode, Codex and agy) gets neither the commands nor the
section: the runner asks the adapter's own `assertCan` about the request with them, so one check
decides, and the step runs without the tool instead of moving to the next candidate. Pillars added
by [`pillars`](configuration.md#pillars) never get analysis commands: their instructions may come
from the reviewed repository's own file, so they stay read-only with no shell. `bench` does not use
`analysis`. `code-reviewer settings` lists the tool names and the layer that set them.

## Example: `no-mistakes`

The commands above are the subcommands checked as read-only. Each one's `--help` was read for any
flag that writes, fixes, installs or files anything (none has one; the options are scope, format,
timeout and lock settings), and each was run against a checkout, which stayed unchanged:

`dependents`, `dependencies`, `importers`, `exports-of`, `dead-exports`, `call-sites`,
`symbols`, `flow`, `import-usages` and `resolve-check`. `related` is an alias of `dependents`.

Not granted, because they were not verified as read-only queries: `check` (runs configured project
commands), `postgres` (generates catalogs), `lock`, `lockfile`, `config`, `tests`, `ci`,
`impacted-checks`, and the framework analyzers (`react`, `queues`, `server`, `infra`, `swift`,
`playwright`, `fetches`, `effects`, `rsc-callers`, `data-pw`, `registry-extension`). Add one only
after checking it the same way.

A guide that keeps the output small helps: `dependents` and `dependencies` print the whole
transitive set unless given `--depth 1`, and `--format paths` prints one path per line. A guide
can say to start from the changed files, query `dependents --depth 1` for what a change can
break, `call-sites` for how an exported function is called, and `dead-exports` for an export that
nothing imports; and that an empty result is a fact about imports the tool resolved, not proof
that no caller exists.

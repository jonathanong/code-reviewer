# Benchmark rules

- Load `ratchet-workflows:evals` before changing a case, a fixture, a grader, or these documents.
- Run one case with `pnpm exec code-reviewer bench --cases <file> --pillar <p> --case <id> --out <dir>`.
  Use `--model sonnet --judge opus`: the judge must be a different model from the reviewer.
- Measure a pillar on another harness with `bench ... --harness codex --model <id> --reads-outside-checkout`; only the pillar agent moves, and its rows are not comparable with Claude rows.
- `bench ... --shell "git grep"` (repeatable, Claude only) grants the pillar agent extra shell prefixes as an experiment; rows are labeled and not comparable with normal rows.
- `bench ... --only-path src/a.ts` (repeatable) shows the pillar agent only the part of the diff that touches those paths, as an experiment; rows are labeled and not comparable with normal rows.
- Test whether recall is an effort problem with `bench ... --effort high` (low, medium, high or xhigh; never `max`); its rows are not comparable with normal rows.
- `bench ... --rounds 2` (1 to 3) runs the pillar agent again with its earlier findings as extra prompt text, as an experiment; rows are labeled and not comparable with normal rows.
- Record which skills any pillar loads on a case with `bench ... --pillar <p> --case <id> --loads-only` (add `--select`
  for the forced arm); it skips the judge and reports no recall.
- Run the skill-selection eval with `pnpm exec code-reviewer bench-selection --cases <file>... --out <dir>`; it costs one Haiku call per attempt, and a case tagged `expectedSkills` is in it.
- Check the shared context with `pnpm exec code-reviewer bench-context --cases <file>... --history <file>... --out <dir>`;
  it makes no model call and costs nothing. Give a tagged case `expectedRules` (a verbatim substring of the
  installed skill's rule line) and re-run it after a skill update or a change under `src/review/context/`.
- Run the requester-focus eval with `pnpm exec code-reviewer bench-focus --cases <file>... --out <dir>`
  (add `--case <id>` for one case, `--score-only` to re-score saved runs); it runs `runFocus` on
  every case declaring `focus` points and grades statuses deterministically without a judge model.
- Run the reply-only re-assessment eval with `pnpm exec code-reviewer bench-replies --cases benchmarks/review/replies.json --out <dir> --model sonnet --attempts 3`
  (add `--case <id>`); it makes one call per attempt (about $0.002 to $0.03) and grades the outcome deterministically, no judge. Each case has `expected` (`settled`, `downgraded` with `expectedSeverity`, or `open`).
- Pilot a new case with one attempt. Before quoting a number, run 3 attempts with `--select` (what
  `review` does: Haiku picks the skills, and only the `rules` pillar is told to load them; `--select-all-pillars` forces
  them on every pillar for comparison) and 3 with `--no-rules` in the same session, then score
  with `--score-only --baseline <control dir>`. Run without either flag (every skill offered, none
  named) only to separate a selection failure from a reviewer miss.
- Do not run the whole of `cases.json` or `revisions.json` unless the owner asks: large cases cost dollars per run.
- Give a mined case `body` (the description as it read at `headSha`) whenever the description was edited after that head; a later edit can state the fix.
- Name in `expectedReads` (repo-relative paths) a file a good review must open; the raw result's `reads` and `searches` show what the run opened and searched for, and the count is reported apart from recall.
- Give every positive case `expectedSkills` with full `plugin:skill` names when a shared rule
  skill states its rule. Do not write a case for a rule no skill states.
- `unwantedSkills` (full `plugin:skill` names, scored only by `bench-selection`) lists skills the selection
  should leave out. Label conservatively and only on fixture cases: list a skill only when nothing in the
  changed files falls under what its installed description governs. Process skills (`implementing-changes`,
  `pr-description`, `git-commit-checklist`, `planning`, `technical-writing`), `documentation` when no doc or
  comment changes, and a domain skill for a technology absent from the diff (SQL, React, workflows, ...)
  qualify. When in doubt leave it out, never list an expected skill, and note in `HISTORY.md` which plugin
  versions the labels were read against. Re-read the descriptions when those plugins update.
- A fixture case quotes the rule sentence from the installed skill in its `reason`. A mined case
  keeps its original claim and only names the skill: its tag is a judgment about which skill covers
  a real finding, so say in `HISTORY.md` when a tag is a loose fit.
- Keep a fixture case only if the no-rules control misses it. Replace a case the control catches.
- Fixtures are synthetic. Never copy code from a private repository into a fixture.
- A mined case snapshots a real pull request. Do not rewrite its expected claim to fit a skill.
- A change to a case, fixture, grader, pillar prompt, or bench prompt updates `README.md` and adds
  a `HISTORY.md` entry in the same change, with or without a run.
- Raw results stay out of the repository. Record the numbers in `HISTORY.md` before deleting them.

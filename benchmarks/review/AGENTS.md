# Benchmark rules

- Load `jong-skills:evals` before changing a case, a fixture, a grader, or these documents.
- Run one case with `pnpm exec code-reviewer bench --cases <file> --pillar <p> --case <id> --out <dir>`.
  Use `--model sonnet --judge opus`: the judge must be a different model from the reviewer.
- Record which skills any pillar loads on a case with `bench ... --pillar <p> --case <id> --loads-only` (add `--select`
  for the forced arm); it skips the judge and reports no recall.
- Run the skill-selection eval with `pnpm exec code-reviewer bench-selection --cases <file>... --out <dir>`; it costs one Haiku call per attempt, and a case tagged `expectedSkills` is in it.
- Check the shared context with `pnpm exec code-reviewer bench-context --cases <file>... --history <file>... --out <dir>`;
  it makes no model call and costs nothing. Give a tagged case `expectedRules` (a verbatim substring of the
  installed skill's rule line) and re-run it after a skill update or a change under `src/review/context/`.
- Pilot a new case with one attempt. Before quoting a number, run 3 attempts with `--select` (what
  `review` does: Haiku picks the skills, and only the `rules` pillar is told to load them; `--select-all-pillars` forces
  them on every pillar for comparison) and 3 with `--no-rules` in the same session, then score
  with `--score-only --baseline <control dir>`. Run without either flag (every skill offered, none
  named) only to separate a selection failure from a reviewer miss.
- Do not run the whole of `cases.json` unless the owner asks: large cases cost dollars per run.
- Give every positive case `expectedSkills` with full `plugin:skill` names when a shared rule
  skill states its rule. Do not write a case for a rule no skill states.
- A fixture case quotes the rule sentence from the installed skill in its `reason`. A mined case
  keeps its original claim and only names the skill: its tag is a judgment about which skill covers
  a real finding, so say in `HISTORY.md` when a tag is a loose fit.
- Keep a fixture case only if the no-rules control misses it. Replace a case the control catches.
- Fixtures are synthetic. Never copy code from a private repository into a fixture.
- A mined case snapshots a real pull request. Do not rewrite its expected claim to fit a skill.
- A change to a case, fixture, grader, pillar prompt, or bench prompt updates `README.md` and adds
  a `HISTORY.md` entry in the same change, with or without a run.
- Raw results stay out of the repository. Record the numbers in `HISTORY.md` before deleting them.

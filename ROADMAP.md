# Roadmap

Planned work that is not yet an issue or a PR.

## Correctness: search around the diff

- #251 makes the correctness pillar search the code the diff depends on, and names `git grep` when the run has a shell.
- Measured on Sonnet at normal effort, it did not yet raise recall: 1 of 15 expected issues, the same as main. The bug file was opened in 2 of 9 runs, against 1 of 9 on main. Turns per run fell from 9-11 to 5-9, with no false alarms.
- Next: iterate until the search measurably finds the bugs. Ideas:
  - Benchmark cases whose bug lives in a caller or callee outside the diff.
  - Prompt wording that makes the agent follow the consumers of each changed symbol.
  - Coverage on large diffs, where most changed files are never read.
- Fixes must work on Sonnet at normal effort. Do not use Opus or high effort to get there.
- The agent finds that code itself; the pipeline does not inject a dump of related code.

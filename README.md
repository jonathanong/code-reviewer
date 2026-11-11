# vouchington-reviewer

A standing, multi-pillar final reviewer for pull requests, extracted from
[vouchington-tooling](https://github.com/vouchington/vouchington-tooling) (`final-review`).

- `bin/vouchington-reviewer.mts`: the deterministic CLI (numbered diffs, posting, status, labels,
  benchmarks). Run `pnpm exec vouchington-reviewer help`.
- `skills/`: the Claude Code skills (pillar prompts, verifier, and the standing loop).
- `benchmarks/final-review/`: labeled eval cases and how to run them.

## Development

Node >= 24, pnpm.

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test:coverage   # 100% thresholds
```

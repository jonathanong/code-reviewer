# feat(eslint): add no-unawaited-run

## Problem

`const { run } = createRunner(); run()` drops the promise the runner returns, and failures in the
task vanish.

## Change

New rule `no-unawaited-run` reports a call to an identifier that was destructured as `run` from
an object pattern, unless the call is awaited. It checks every call expression and ignores callees
that are not bound by an object pattern.

## Testing

- `src/rules/no-unawaited-run.test.mts` covers an awaited call, an unrelated destructured name, nested and rest destructuring, a
  plain function call and the unawaited case.

# fix(lint): skip generated files

## Problem

`src/generated/` holds code produced by the schema tool. We never edit it, yet the `legacy-http`
rule reported it, so `lint.allow.json` carries an entry for `src/generated/schema.ts` to silence it.

## Change

`lintFile` returns early for any path under `src/generated/`, so generated files are no longer
linted.

## Testing

- Added `generated files are not linted` to `src/lint.test.mts`.
- `node --test src/lint.test.mts` passes.

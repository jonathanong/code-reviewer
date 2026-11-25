# fix(lint): skip generated files

## Problem

`src/generated/` holds code produced by the schema tool. We never edit it, yet the `legacy-http`
rule reported it, so `lint.allow.json` carries an entry for `src/generated/schema.ts` to silence it.

## Change

`lintFile` returns early for any path under `src/generated/`, so generated files are no longer
linted. Every file that was clean before is still clean.

Behavior change: a skipped file never marks its allow entry as used, so the unused-entry audit in
`src/audit.mts` now fails (exit 0 becomes 1) for an allow entry that only generated files needed.
This PR removes the one such entry, `src/generated/schema.ts`, from `lint.allow.json`. A
repository that allows a generated path must delete that entry when it upgrades.

## Before and after

```
$ node bin/lint.mts   # before this PR, entry present
exit 0
$ node bin/lint.mts   # this PR's code, entry still present
unused allow entry: src/generated/schema.ts
exit 1
$ node bin/lint.mts   # this PR, entry removed
exit 0
```

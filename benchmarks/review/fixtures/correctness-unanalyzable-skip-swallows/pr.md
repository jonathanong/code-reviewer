# feat(coverage): report tests whose callback cannot be resolved

## Problem

The coverage rule silently dropped a `test(...)` call whose callback was imported or built at
runtime, so those tests counted as covered by nothing.

## Change

`classify` now returns `unanalyzable` for such a call, for `test(...)` and `test.skip(...)` alike.
`docs/rules/unanalyzable-test.md` states that every unresolved callback is reported. A skipped test
with a runtime condition is not analyzed.

## Testing

- Added tests for an inline callback, an unresolved callback and a conditional skip.

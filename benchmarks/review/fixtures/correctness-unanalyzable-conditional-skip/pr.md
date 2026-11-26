# feat(coverage): report tests whose callback cannot be resolved

## Problem

The coverage rule silently dropped a `test(...)` call whose callback was imported or built at
runtime, so those tests counted as covered by nothing.

## Change

`classify` now returns `unanalyzable` for such a call. The one deliberate exception is
`test.skip(condition, 'reason')`, the framework's conditional-skip form: it has no callback, so
`classify` returns null for it. The code comment and `docs/rules/unanalyzable-test.md` both say so.

## Testing

- Added tests for an inline callback, an unresolved callback and the conditional skip.

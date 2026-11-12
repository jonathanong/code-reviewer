# @acme/flags

Feature flag client shared by Acme apps.

## Rules for callers

- Flag keys are kebab-case (`new-checkout-flow`), never camelCase.
- Every key a caller passes to `isEnabled` must be declared in the calling app's `flags.json`
  before use. The flag service only serves declared keys.
- `isEnabled` returns `false` for an undeclared or misspelled key and logs nothing, so a missing
  declaration silently keeps the feature off in every environment.

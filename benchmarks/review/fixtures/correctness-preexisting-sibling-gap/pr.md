# fix(check): report an abstained diagnostic when a flow's queue is ambiguous

## Problem

When a queue name has more than one definition, `checkQueues` skipped the flow binding without a
word, so a flow on an ambiguous queue looked checked and clean.

## Change

For a `flow` binding whose queue definition is ambiguous, `checkQueues` now emits an `abstained`
diagnostic that names the queue and the number of definitions. Other bindings behave as before.

## Testing

- Added a test that an ambiguous queue abstains for a flow binding.
- `node --test src/check.test.mts` passes.

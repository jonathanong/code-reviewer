# fix(check): word the abstained diagnostic for flows

## Problem

The `abstained` message said "flow not checked" for a binding of any kind, which is wrong for a
scheduler binding.

## Change

`checkQueues` builds the `abstained` diagnostic inside a `flow` branch so the message can say
"flow". Other bindings behave as before.

## Testing

- Added a test that an ambiguous queue abstains for a flow binding.
- `node --test src/check.test.mts` passes.

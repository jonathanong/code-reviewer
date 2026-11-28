# feat(policy): ordering operators on numeric and ordinal values

## Problem

A merge gate can only compare a value with `==` and `!=`. A rule like `coverage >= 80` or `risk < high` cannot be written.

## Change

`evalCondition` supports `<`, `>`, `<=` and `>=`. The grammar allows two operand types: a number and an ordinal name (`low`, `medium`, `high`). Numbers compare as numbers; ordinals compare by their position in `ORDER`. Any other pairing (a number against an ordinal, an unknown ordinal name, an ordering operator on a string) throws `PolicyError`, so a malformed gate fails closed.

## Testing

- `src/conditions.test.mts` covers each operator on numbers and on ordinals, and each rejected pairing.

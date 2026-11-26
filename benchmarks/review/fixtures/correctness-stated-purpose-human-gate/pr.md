# feat(policy): refuse a policy that lets a protected path skip human review

## Problem

A policy can route a protected path (`deploy/`, `secrets/`) to an automated reviewer only, so a
change there merges with no person looking at it.

## Change

`checkAlwaysHuman` runs when a policy loads and refuses the policy unless every protected path
always goes to a person. A rule sends a path to a person when it lists at least one human seat.
The check guarantees that no protected path can reach merge without a human review.

## Testing

- `src/always-human.test.mts` covers a policy with a human seat and a policy with no rule for a
  protected path.

# fix(claims): release a stale claim only if it is still the one we read

## Problem

`releaseStale` reads a claim, sees it is older than the timeout, and deletes it. A worker that renews the claim between the read and the delete loses it.

## Change

`releaseStale` now deletes with a conditional on the claim's `token`: the row is removed only when the stored token still equals the token it read. A renewed claim has a new token, so the delete matches nothing and the claim stays.

## Testing

- `src/claims.test.mts` covers a stale claim (released), a fresh claim (kept) and a claim renewed between the read and the delete (kept).

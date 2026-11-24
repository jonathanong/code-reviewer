---
name: unneeded-concurrency-guard
when: The change adds a new lock, compare-and-set, retry on conflict, or other guard against two runs of the same code overlapping. Not when it only removes, moves or renames an existing one.
---

The change adds a guard against two runs of the same code overlapping. Find every caller of the guarded code and how each is scheduled or enqueued, then look for what already serialises them: a queue ordering or group key with concurrency 1, a fixed job id or dedupe key, a single schedule, a unique constraint, an existing lock. Claim to test: two runs can overlap, so the guard is needed.

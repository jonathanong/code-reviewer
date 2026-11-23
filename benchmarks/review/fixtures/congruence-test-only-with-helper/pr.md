# test: cover the backoff delay bounds and the retry sleeps

Test-only. Adds cases for the first retry, doubling, a custom base and cap, and an invalid
attempt, and checks the delays `retry` sleeps between failures. The fake sleep helper gains a
`total()` for the summed delay. No production code changes.

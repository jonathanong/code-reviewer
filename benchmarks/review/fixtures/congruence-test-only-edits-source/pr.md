# test: cover the backoff delay bounds and the retry sleeps

Test-only. Adds cases for the first retry, doubling, a custom base and cap, and an invalid
attempt, and checks the delays `retry` sleeps between failures. No production code changes.

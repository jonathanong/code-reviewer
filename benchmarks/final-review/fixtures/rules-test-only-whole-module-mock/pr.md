# test: cover withRetry

Adds tests for `withRetry`: it returns the first successful result, and rethrows the last error
after the configured number of attempts. The limit is pinned to 2 so the tests do not depend on the
environment. No production code changes.

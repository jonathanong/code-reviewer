# test: cover fetchRate

Adds tests for `fetchRate`: it returns the rate the service reports, and throws `RateError` with
the currency and status when the service fails. `fetch` is stubbed so the tests never reach the
network, and the tests check that each call makes exactly one request. No production code changes.

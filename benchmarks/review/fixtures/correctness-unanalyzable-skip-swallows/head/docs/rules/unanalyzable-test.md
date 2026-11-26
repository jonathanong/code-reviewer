# unanalyzable-test

Reports a `test(name, fn)` or `test.skip(...)` call whose callback the rule cannot resolve to a
function in the same file, such as a callback imported from another module or built at runtime.

Every call whose callback cannot be resolved is reported, so a test is never silently left out of
the coverage count.

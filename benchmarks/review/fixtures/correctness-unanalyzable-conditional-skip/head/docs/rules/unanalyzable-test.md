# unanalyzable-test

Reports a `test(name, fn)` call whose callback the rule cannot resolve to a function in the same
file, such as a callback imported from another module or built at runtime.

## Not reported

`test.skip(condition, 'reason')` is the framework's conditional-skip form. Its first argument is
a runtime condition and its second a reason string, so it has no callback and is not reported.
Every other call whose callback cannot be resolved is reported.

# feat(lint): flag direct calls to the wall clock outside lib/

Code outside `lib/` must take the time from a request context, not from `now()` in `lib/clock.mjs`. `scripts/check-clock.mjs` fails the build on a call to `now` wherever it is imported from, and on a call it cannot trace.

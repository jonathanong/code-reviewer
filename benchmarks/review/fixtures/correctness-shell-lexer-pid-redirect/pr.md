# fix(ci): find retry loops through pipelines, and stop counting a quoted dollar as loop input

## Problem

`findRetryLoops` splits a script only at newlines, `;`, `&&` and `||`. A test that sits behind a
pipe (`printf x | pnpm test`) is not at the start of its segment, so a loop that reruns it is
missed. Its input check is a plain substring match on `$<variable>`, so `'$attempt'` in single
quotes or an escaped `\$attempt` hides a real retry loop.

## Change

- New `src/shell-lexer.mts` with `splitSegments` and `expandsVariable`. `splitSegments` also splits
  at each pipeline stage and never inside quotes. `expandsVariable` reads `$name` and `${name}` as
  the shell does: a single-quoted or escaped dollar is not an expansion.
- `findRetryLoops` uses both. A loop variable piped in from an earlier stage still counts as input
  to the test it feeds.
- The lexer follows shell syntax: noclobber redirection (`>|`) is a redirect, not a pipe, and `$$`
  is the shell's process id, so `$$i` is the PID followed by a literal `i`, not `$i`.

## Testing

- `src/retry-loops.test.mts` covers a plain retry, a loop variable passed to the test, a loop
  variable piped into the test, and single-quoted and escaped dollars.
- `node --test src/retry-loops.test.mts` passes.

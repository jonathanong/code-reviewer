# ci: fewer, larger jobs to cut runner queue time

## Problem

Each job waits for a runner, and on busy days the four test shards and the 13-second format
check queue separately for 1 to 3 minutes each, so the checks finish later than the work needs.

## Change

- Test shards 4 to 2. They still run in parallel.
- `pnpm fmt:check` (13 s) becomes a step in the lint job instead of its own job.

## Measurements

Median of the last 20 runs on main, against 5 runs of this branch:

|                                   | before | after  |
| --------------------------------- | ------ | ------ |
| slowest test shard                | 3m 40s | 4m 05s |
| lint job                          | 1m 50s | 2m 03s |
| longest chain, push to last check | 6m 20s | 5m 10s |
| runner minutes                    | 17m    | 13m    |

The slowest chain is the test shard, which still runs alongside lint. Nothing that ran in
parallel now runs one after another.

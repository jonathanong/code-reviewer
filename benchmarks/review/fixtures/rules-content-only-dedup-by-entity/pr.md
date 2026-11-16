# feat: sync the billing system when a member changes plan

After the plan is saved, `changePlan` enqueues a `sync-plan` job for the member. The job id dedupes
repeated enqueues for the same member so the billing system is not synced twice. Completed jobs
are kept for a day for debugging.

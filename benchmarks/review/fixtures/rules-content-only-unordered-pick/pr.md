# feat: claim due reminders in batches

Adds `claimDue`, which the reminder job will call once a minute: it locks up to 100 due, unsent
reminders with `FOR UPDATE SKIP LOCKED` so two workers never send the same one. The job that calls
it lands in the next change.

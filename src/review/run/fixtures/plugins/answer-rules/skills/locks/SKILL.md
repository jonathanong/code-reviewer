---
name: locks
description: When code may take a lock.
---

# Locks

- Take a lock only on a row that the
  transaction writes.
- Never lock a parent row the transaction only reads.

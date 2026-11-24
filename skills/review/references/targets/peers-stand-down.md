---
name: peers-stand-down
when: The change adds or changes code or a written rule in which a job, process or other actor checks for others of its kind and stands down, waits or skips when it finds one. Not when it only takes a lock or relies on a queue's own dedupe.
---

The change has an actor check for others of its kind and stand down, wait or skip when it finds one. Take two actors that run the check at the same moment and write out what each sees and does; then one that starts while another is part-way through. Claim to test: at least one always proceeds, and the check can tell the actor it should yield to from one that is itself only checking.

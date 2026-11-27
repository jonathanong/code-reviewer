---
name: sibling-keeps-old-shape
when: The change fixes a defect (a wrong query or plan, a crash, wrong output) by replacing an old code shape in one place. Not when it adds a feature, refactors without fixing a defect, or only edits docs, tests or messages.
---

The change fixes a defect by replacing an old, broken code shape. Name that shape from the removed lines, then search the changed files, their directories, and the files that import or are imported by them for other instances of it that the diff left unchanged. Claim to test: none remains, or the description says why it stays. Report each remaining instance by path and line; it is not pre-existing when the title or description says the fix covers that shape.

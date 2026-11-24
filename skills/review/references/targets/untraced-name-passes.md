---
name: untraced-name-passes
when: The change adds or changes a lint rule, detector or check that decides by following a name, import or binding in the code it scans. Not when it only edits such a check's message, docs or settings.
---

The change adds or changes a check that decides by a name in the code it scans. Test three shapes only: the name is imported from a local module that re-exports it; from a local module that builds it with a call; or it is the result of calling an imported function. Claim to test: in each shape the check reports the name, or reports that it could not resolve it, never treating it as clean. Other shapes (local aliases, nested members, parameters) do not fail the claim; nor does a missing fixture.

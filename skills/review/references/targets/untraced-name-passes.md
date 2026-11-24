---
name: untraced-name-passes
when: The change adds or changes a lint rule, detector or check that decides by following a name, import or binding in the code it scans. Not when it only edits such a check's message, docs or settings.
---

The change adds or changes a check that decides by a name in the code it scans. An imported name can come from somewhere the check does not follow: another local module, a re-export, a wrapper call there. Find what the check does with an imported name whose source it cannot trace. Claim to test: it reports that name, or reports that it could not resolve it, and never treats it as clean. Only imported names count, not parameters or local values. A missing fixture alone does not fail the claim.

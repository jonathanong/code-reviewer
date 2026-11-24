---
name: clean-code-newly-reports
when: The change alters the logic of an existing lint rule, check, analyzer or resolver that reports findings on code. Not when it only adds a new rule that is off until configured, or edits messages, docs or tests.
---

The change alters what an existing check, rule or resolver reports. Read the changed analysis itself, not only its tests: find input the base version passes that the head reports, such as a name that was unresolved and now resolves, or a value set in one branch that the base took as set everywhere. Then compare any before and after output in the description line by line. Claim to test: nothing newly reports, or the description names each kind as newly reported.

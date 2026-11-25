---
name: undecided-input-passes
when: The change adds a new lint rule, detector, check or analyzer, or changes how an existing one parses or classifies its input, including a rule that is off until configured. Not when it only edits messages, docs, settings or tests, or when it only follows names and imports.
---

The change adds or changes an analysis that reports findings on its input. Find each path where it returns no finding without having decided the input: a parse or read failure; a value that is an expression, variable or template rather than a literal; a shape the code does not recognise; a configured file or target that is missing. Claim to test: each such input is reported as a finding or as could-not-analyse, never treated as clean.

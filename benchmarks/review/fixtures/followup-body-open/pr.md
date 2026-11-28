# feat: report state a mock factory shares between tests

Adds `isMockFactoryCall` and `factoryOf`, which find the factory of a `mock(...)` call so the rule can report
state the factory shares. Callers wrap `mock` in helpers such as `hoisted(mock)(...)`.

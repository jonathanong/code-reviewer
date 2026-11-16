# feat: parse amounts from user input

Adds `parseAmount`, which accepts a whole number of cents and throws `InvalidAmountError`
(code `INVALID_AMOUNT`) with a user-facing message otherwise. Tests pin the exact messages,
as AGENTS.md requires for user-facing errors.

# feat: parse amounts from user input

Adds `parseAmount`, which accepts a whole number of cents and throws `InvalidAmountError`
(code `INVALID_AMOUNT`) otherwise. Tests cover the valid case and each rejected input.

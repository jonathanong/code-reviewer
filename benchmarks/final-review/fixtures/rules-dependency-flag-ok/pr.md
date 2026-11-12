# feat: one-page checkout behind a flag

Adds a two-step checkout (cart, then review and pay) behind the `new-checkout-flow` flag,
declared off in `flags.json`, so we can roll it out gradually. The old flow is unchanged
while the flag is off.

# feat(config): reject unknown fields in the lint config

## Problem

A misspelled key in the lint config (`maxLenght`) is ignored, so the rule runs with its default and nobody notices.

## Change

Every struct in the lint config now has `deny_unknown_fields`: the top-level `Config`, the per-rule `RuleConfig`, and the nested `NamingOptions` and `LengthOptions` it holds. An unknown key at any level fails the load and names the unknown key.

## Testing

- `src/config.rs` tests cover an unknown key at the top level, in a rule, in `naming` and in `length`.

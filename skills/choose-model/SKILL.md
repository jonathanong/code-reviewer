---
name: choose-model
description: Choose or re-check which model runs a review step on a harness, especially OpenCode's free models, by probing them with code-reviewer models.
---

# Choose a model for a review step

Use when picking a model for a step, or when a step's model starts failing or the provider's list
changes. Details: `docs/models.md`.

1. Run `code-reviewer models --harness opencode --free --probes 3 --out DIR`. It sends only its own
   synthetic files. Do not run it on a diff or a reviewed repository.
2. Read `models.json` in `DIR`. Drop every model whose `valid` is below 1. Of the rest, take the
   highest `found`; break ties on lower `seconds`, then lower `extra`.
3. Treat `rateLimited` runs as missing data, not a bad model. Re-run a model that has some.
4. Never put a free model on the verifier or the approval check, however well it scores. Use it for
   pillars and other steps whose findings are verified later.
5. Set the choice under `models` in the machine config (`docs/configuration.md#models`), or per run
   with `--model STEP=HARNESS:MODEL`. OpenCode is not selectable by config yet: only `claude` is
   registered in `src/harness/registry.mts`, so the result informs the choice until it is.
6. Re-run when the provider's list changes or a step starts failing.

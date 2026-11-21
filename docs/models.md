# Choosing a model

```
code-reviewer models --harness opencode [--free] [--model ID]... [--probes N] [--jobs N] [--out DIR]
```

Measures the models a harness offers so a review step's model is chosen, not guessed. Only
`opencode` is accepted. It makes model calls and never writes to GitHub.

## What it does

1. **List.** `opencode models` prints one `provider/model` id per line. `--model ID` (repeatable)
   replaces the listing. `--free` keeps ids whose model part ends in `-free`, plus a short named
   list of free ids without that suffix (`KNOWN_FREE` in `src/harness/free-model.mts`). That is a naming
   heuristic: it can miss a free model and keep one that is not free, so read the list.
2. **Probe.** Each model runs every probe `--probes` times (default 1), `--jobs` at a time
   (default 2), through the OpenCode adapter with read-only capabilities. A probe is a tiny
   synthetic tree of two or three files with one planted defect, in `src/models/probes/`, and a
   prompt asking for `{findings:[{path, line, title}]}`. The tree is staged in a temporary
   directory and removed after the run.
3. **Score.** No judge model. Per model:
   - `valid`: share of runs whose reply matched the findings schema.
   - `found`: share of runs with a finding on the planted file within two lines of the defect.
   - `extra`: mean number of other findings in valid runs.
   - `seconds`, `tokens` (input plus output), `costUsd`: mean time and tokens, total cost.
   - `rateLimited`: runs the adapter classified as rate limited. They count here and in no other
     measure, so a throttled model is not scored as a bad one. The only limit recognised on
     OpenCode is its free usage limit, where it prints nothing and hangs: each such run lasts
     until the probe's timeout.
   - `failures`: one line for each distinct failed run.

## Output

One JSON object on stdout, `{harness, models:[{id, runs, valid, found, extra, seconds, tokens,
costUsd, rateLimited, failures}]}`, sorted by `found` descending, then `valid` descending, then
`seconds` ascending. The same data as a Markdown table goes to stderr. `--out DIR` also writes
`models.json` and `models.md` there. A measure with nothing to score is `null`.

## Reading it

The probes are synthetic and tiny, so the ranking is a screen: it drops models that cannot follow
the reply format or miss an obvious defect. It is not a benchmark of review quality; use `bench`
(`docs/benchmarks.md`) for that.

Free tiers may train on prompts. For that reason the command sends only its own synthetic probes,
never a diff or anything from a reviewed repository.

Where to put the result: the `models` key in the machine config (`docs/configuration.md#models`).

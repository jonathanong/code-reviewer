# feat: add `--config` to choose the rules file

## Summary

- `run` takes an optional `config`; it defaults to `lint.json`
- A relative `config` is joined to `root`
- Added tests for the join

## Example

```
$ node src/cli.mts --root examples/site --config strict.json
rules: 2
```

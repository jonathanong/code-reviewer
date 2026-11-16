# ci: add a lint workflow

Adds a `Lint` workflow that runs `pnpm run lint` on pull requests, only when `src/` or
`package.json` change, to save runner minutes. `Lint` is a required status check on `main`.
Actions are pinned to commit SHAs, the job has a timeout, and permissions are read-only.

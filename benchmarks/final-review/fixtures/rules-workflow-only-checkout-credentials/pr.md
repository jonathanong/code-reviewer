# ci: add a lint workflow

Adds a `Lint` workflow that runs `pnpm run lint` on pull requests. Actions are pinned to commit
SHAs, the job has a timeout, and permissions are read-only.

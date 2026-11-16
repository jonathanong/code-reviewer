# Agents

- pnpm workspace, Node 24. Published packages live under `packages/`.
- Tests use Vitest and live next to the code as `*.test.ts`.
- A package must be a generic utility that knows nothing about the product. Generic orchestration
  is fine when callers inject the work: retry loops, per-item transaction runners, idempotency
  managers. Business workflows, domain state transitions, policy, persistence, and authorization
  stay in the application, never in a package, even behind injected callbacks.

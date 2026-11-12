# Agents

- Use pnpm. Tests use Vitest and live next to the code as `*.test.ts`.
- Keep functions small and exported only when another module uses them.
- Error messages are this CLI's user-facing contract: users and support scripts match them. Tests
  must assert the exact message text of user-facing errors. This overrides the shared
  testing-rules item about matching error message text.

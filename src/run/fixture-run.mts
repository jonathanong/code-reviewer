import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'clean')

export type RunOverrides = {
  review?: Record<string, unknown>
  report?: Record<string, unknown>
  context?: Record<string, unknown>
  stack?: Record<string, unknown>
}

/** Writes the clean review's run files into `out`, each with the given fields replaced. */
export function stageRun(out: string, overrides: RunOverrides = {}): void {
  mkdirSync(out, { recursive: true })
  for (const name of ['review', 'report', 'context'] as const) {
    const base = JSON.parse(readFileSync(join(FIXTURE, `${name}.json`), 'utf8')) as object
    // Each staged review is a new one, as `review` makes it.
    const own = name === 'review' ? { reviewId: randomUUID() } : {}
    writeFileSync(
      join(out, `${name}.json`),
      JSON.stringify({ ...base, ...own, ...overrides[name] }),
    )
  }
  if (overrides.stack !== undefined) {
    writeFileSync(join(out, 'stack.json'), JSON.stringify(overrides.stack))
  }
}

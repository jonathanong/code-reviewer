import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'

import { reviewCommand } from '../cli/command-review.mts'
import type { ReviewDeps } from '../cli/deps.mts'
import { recordReview } from '../tracker/record.mts'
import { runCommand, type RunEnv, type RunValues } from './command.mts'
import { HEAD, fakeDeps, type FakeOptions } from './fake-deps.mts'
import { stageRun, type RunOverrides } from './fixture-run.mts'
import type { RunLine } from './output.mts'

export const PULL: RunValues = { repo: ['acme/widgets'], pr: '4' }
export const COUNTS = { blocking: 0, high: 0, medium: 0, low: 0 }

export type Review = {
  overrides?: RunOverrides
  claimed?: boolean
  ok?: boolean
  error?: string
  /** `review` stopped at the cost ceiling after spending this much; with `ok: false`. */
  ceilingCostUsd?: number
  /** What `review` reports of its second check on an approval. */
  approvalCheck?: 'upheld' | 'changed' | 'failed'
}

/** Stands in for the headless run: writes the run's files and takes the claim like `review` does. */
function fakeReview(deps: ReviewDeps, review: Review = {}) {
  vi.mocked(reviewCommand).mockImplementation(async (values, pull, used) => {
    const { out } = values as { out: string }
    if (review.claimed === false) return { ok: true, summary: { claimed: false, reason: 'lost' } }
    const labelIo = deps.createLabelIo(pull)
    await labelIo.add(['final-review:in-progress'])
    if ((await labelIo.labels()).includes('final-review:requested')) {
      await labelIo.remove('final-review:requested')
    }
    await used.exec('claude', [], {})
    if (review.ok === false) {
      await labelIo.remove('final-review:in-progress')
      const ceiling =
        review.ceilingCostUsd === undefined
          ? {}
          : { costCeilingReached: true, costUsd: review.ceilingCostUsd }
      const summary = { claimed: true, error: review.error, ...ceiling }
      if (review.ceilingCostUsd !== undefined) {
        // The real review has written `context.json` by the time a step is stopped.
        writeFileSync(join(out, 'context.json'), JSON.stringify({ headSha: HEAD }))
        recordReview(deps.tracker(), { ...pull, out, startedAt: 'now', ok: false, summary })
      }
      return { ok: false, summary }
    }
    stageRun(out, review.overrides)
    const summary = {
      claimed: true,
      mode: 'full',
      verdict: 'Approve',
      findings: COUNTS,
      costUsd: 2.1,
      review: join(out, 'review.json'),
      headSha: HEAD,
      ...(review.approvalCheck === undefined ? {} : { approvalCheck: review.approvalCheck }),
    }
    recordReview(deps.tracker(), { ...pull, out, startedAt: 'now', ok: true, summary })
    return { ok: true, summary }
  })
}

/** Fake dependencies and environment for one `run`; `root` holds the state and temporary directories. */
export function setup(root: string, options: Partial<FakeOptions> = {}, review: Review = {}) {
  const fake = fakeDeps({ stateDir: join(root, 'state'), ...options })
  fakeReview(fake.deps, review)
  const git = vi.fn(async (args: string[]) =>
    args.includes('get-url') ? 'https://github.com/acme/widgets.git' : '',
  )
  const signals = new EventEmitter()
  const env: RunEnv = {
    env: {},
    tmp: join(root, 'tmp'),
    git,
    remote: (repo) => `https://example.test/${repo}.git`,
    signals,
  }
  return { ...fake, env, git, signals }
}

export type Fake = ReturnType<typeof setup>

/** Runs the command and returns its exit code with the lines it wrote to stdout. */
export async function runWith(fake: Fake, stdout: string[], values: RunValues = PULL) {
  const code = await runCommand(values, fake.deps, fake.env)
  return { code, lines: stdout.map((text) => JSON.parse(text) as RunLine) }
}

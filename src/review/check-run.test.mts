import { describe, expect, it, vi } from 'vitest'

import { abortedStep, postedStep, reportCheckRun, skippedStep, STARTED } from './check-run.mts'
import { DEFAULT_LABELS, type ReviewSettings } from './settings.mts'

const SHA = 'd'.repeat(40)
const CONFIGURED: ReviewSettings = { labels: DEFAULT_LABELS, checkRun: { name: 'Final review' } }

function report(
  step: Parameters<typeof reportCheckRun>[0]['step'],
  overrides: Partial<Parameters<typeof reportCheckRun>[0]> = {},
) {
  const run = vi.fn(async (_args: readonly string[]) => 'https://example.test/check\n')
  const headSha = vi.fn(async () => SHA)
  const result = reportCheckRun({
    settings: CONFIGURED,
    mode: 'app',
    run,
    repo: 'acme/widgets',
    headSha,
    step,
    ...overrides,
  })
  return { run, headSha, result }
}

function fields(run: { mock: { calls: unknown[][] } }): string[] {
  const args = (run.mock.calls[0]?.[0] ?? []) as string[]
  return args.filter((arg) => arg.includes('='))
}

describe('reportCheckRun', () => {
  it('creates an in-progress check run at the head', async () => {
    const { run, result } = report(STARTED)
    await expect(result).resolves.toEqual({
      status: 'in_progress',
      url: 'https://example.test/check',
    })
    expect(run.mock.calls[0]?.[0]).toContain('repos/acme/widgets/check-runs')
    expect(fields(run)).toEqual([
      'name=Final review',
      `head_sha=${SHA}`,
      'status=in_progress',
      `output[title]=${STARTED.title}`,
      `output[summary]=${STARTED.summary}`,
    ])
  })

  it.each([
    ['Approve', 'success'],
    ['Request Changes', 'failure'],
    ['Comment', 'neutral'],
  ] as const)(
    'completes a %s review as %s with the verdict and review URLs',
    async (verdict, conclusion) => {
      const { run, result } = report(postedStep(verdict, ['https://r/1', 'https://r/2']))
      await expect(result).resolves.toMatchObject({ status: 'completed' })
      expect(fields(run)).toEqual([
        'name=Final review',
        `head_sha=${SHA}`,
        'status=completed',
        `conclusion=${conclusion}`,
        `output[title]=${verdict}`,
        'output[summary]=https://r/1\nhttps://r/2',
      ])
    },
  )

  it('completes an aborted review as cancelled and a skipped one as skipped', async () => {
    const aborted = report(abortedStep())
    await aborted.result
    expect(fields(aborted.run)).toContain('conclusion=cancelled')
    const skipped = report(skippedStep('docs only'))
    await skipped.result
    expect(fields(skipped.run)).toContain('conclusion=skipped')
    expect(fields(skipped.run)).toContain('output[summary]=docs only')
  })

  it('does nothing when no check run is configured', async () => {
    const { run, headSha, result } = report(STARTED, {
      settings: { labels: DEFAULT_LABELS, checkRun: null },
    })
    await expect(result).resolves.toBeUndefined()
    expect(run).not.toHaveBeenCalled()
    expect(headSha).not.toHaveBeenCalled()
  })

  it('reports it skipped, without calling GitHub, under the gh login', async () => {
    const { run, result } = report(STARTED, { mode: 'gh' })
    await expect(result).resolves.toEqual({
      status: 'skipped',
      reason: 'check runs need GitHub App auth; this run uses the gh login',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('reports a GitHub failure instead of throwing', async () => {
    const failing = report(STARTED, {
      run: vi.fn(async () => {
        throw new Error('403 Resource not accessible')
      }),
    })
    await expect(failing.result).resolves.toEqual({
      status: 'failed',
      error: '403 Resource not accessible',
    })
    const odd = report(STARTED, { headSha: () => Promise.reject('no head') })
    await expect(odd.result).resolves.toEqual({ status: 'failed', error: 'no head' })
  })
})

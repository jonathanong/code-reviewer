import { describe, expect, it, vi } from 'vitest'

import { abortedStep, postedStep, reportCheckRun, skippedStep, STARTED } from './check-run.mts'
import { DEFAULT_LABELS, type ReviewSettings } from './settings.mts'

const SHA = 'd'.repeat(40)
const CONFIGURED: ReviewSettings = { labels: DEFAULT_LABELS, checkRun: { name: 'Code review' } }

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
      via: 'check-run',
    })
    expect(run.mock.calls[0]?.[0]).toContain('repos/acme/widgets/check-runs')
    expect(fields(run)).toEqual([
      'name=Code review',
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
        'name=Code review',
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

  describe('without an App', () => {
    const statusFields = (run: { mock: { calls: unknown[][] } }) => {
      const args = run.mock.calls[0]?.[0] as string[]
      return { path: args[3], fields: args.filter((arg) => arg.includes('=')) }
    }

    it('writes a pending commit status for a started review', async () => {
      const { run, result } = report(STARTED, { mode: 'gh' })
      await expect(result).resolves.toEqual({
        status: 'in_progress',
        url: null,
        via: 'commit-status',
      })
      expect(statusFields(run)).toEqual({
        path: `repos/acme/widgets/statuses/${SHA}`,
        fields: ['state=pending', 'context=Code review', `description=${STARTED.title}`],
      })
    })

    it.each([
      ['Approve', 'success'],
      ['Request Changes', 'failure'],
      ['Comment', 'success'],
    ] as const)('maps a %s review to %s and links the first review', async (verdict, state) => {
      const { run, result } = report(postedStep(verdict, ['https://r/1', 'https://r/2']), {
        mode: 'gh',
      })
      await expect(result).resolves.toEqual({
        status: 'completed',
        url: 'https://r/1',
        via: 'commit-status',
      })
      expect(statusFields(run).fields).toEqual([
        `state=${state}`,
        'context=Code review',
        `description=${verdict}`,
        'target_url=https://r/1',
      ])
    })

    it('omits the target URL when no review was posted', async () => {
      const { run, result } = report(postedStep('Approve', []), { mode: 'gh' })
      await expect(result).resolves.toMatchObject({ url: null })
      expect(statusFields(run).fields.some((field) => field.startsWith('target_url='))).toBe(false)
    })

    it('maps cancelled to error and skipped to success', async () => {
      const aborted = report(abortedStep(), { mode: 'gh' })
      await aborted.result
      expect(statusFields(aborted.run).fields[0]).toBe('state=error')
      const skipped = report(skippedStep('docs only', 'https://r/9'), { mode: 'gh' })
      await skipped.result
      expect(statusFields(skipped.run).fields).toContain('state=success')
      expect(statusFields(skipped.run).fields).toContain('target_url=https://r/9')
    })

    it('truncates the description to 140 characters', async () => {
      const { run, result } = report(
        { conclusion: 'neutral', title: 'x'.repeat(200), summary: '' },
        { mode: 'gh' },
      )
      await result
      expect(statusFields(run).fields).toContain(`description=${'x'.repeat(140)}`)
    })

    it('reports a failure instead of throwing', async () => {
      const failing = report(STARTED, {
        mode: 'gh',
        run: vi.fn(async () => {
          throw new Error('403 Resource not accessible')
        }),
      })
      await expect(failing.result).resolves.toEqual({
        status: 'failed',
        error: '403 Resource not accessible',
      })
    })
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

import { describe, expect, it, vi } from 'vitest'

import {
  abortedStep,
  heldStep,
  postedStep,
  reportCheckRun,
  skippedStep,
  STARTED,
} from './check-run.mts'
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

/** The last call is the write; a completing step looks the run up first. */
function lastArgs(run: { mock: { calls: unknown[][] } }): string[] {
  return (run.mock.calls.at(-1)?.[0] ?? []) as string[]
}

function fields(run: { mock: { calls: unknown[][] } }): string[] {
  return lastArgs(run).filter((arg) => arg.includes('='))
}

const LOOKUP = (id: number, slug = 'my-app') => `${id} ${slug}\n`

describe('reportCheckRun', () => {
  it('creates an in-progress check run at the head', async () => {
    const { run, result } = report(STARTED)
    await expect(result).resolves.toEqual({
      status: 'in_progress',
      url: 'https://example.test/check',
      via: 'check-run',
    })
    expect(run).toHaveBeenCalledOnce()
    expect(lastArgs(run)).toContain('repos/acme/widgets/check-runs')
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
        'details_url=https://r/1',
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

  describe('completing the run the start step opened', () => {
    const lookupThen = (found: string) =>
      vi.fn(async (args: readonly string[]) =>
        args.includes('--method') ? 'https://example.test/check/9\n' : found,
      )

    it('looks the run up by name and head, and patches the newest one of this App', async () => {
      const run = lookupThen(`${LOOKUP(11, 'other-app')}${LOOKUP(7)}${LOOKUP(8)}junk\n`)
      const { result } = report(postedStep('Approve', ['https://r/1', 'https://r/2']), {
        run,
        appLogin: async () => 'my-app[bot]',
      })
      await expect(result).resolves.toEqual({
        status: 'completed',
        url: 'https://example.test/check/9',
        via: 'check-run',
      })
      const lookup = run.mock.calls[0]?.[0] as string[]
      expect(lookup).toContain(
        `repos/acme/widgets/commits/${SHA}/check-runs?check_name=Code%20review&per_page=100`,
      )
      expect(lookup).not.toContain('--method')
      expect(lastArgs(run).slice(0, 4)).toEqual([
        'api',
        '--method',
        'PATCH',
        'repos/acme/widgets/check-runs/8',
      ])
      expect(fields(run)).toEqual([
        'status=completed',
        'conclusion=success',
        'details_url=https://r/1',
        'output[title]=Approve',
        'output[summary]=https://r/1\nhttps://r/2',
      ])
    })

    it('takes the newest run of the name when the App login is unknown', async () => {
      const run = lookupThen(`${LOOKUP(3)}${LOOKUP(12, 'other-app')}`)
      await report(abortedStep('boom'), { run }).result
      expect(lastArgs(run)).toContain('repos/acme/widgets/check-runs/12')
      expect(fields(run)).toContain('output[summary]=boom')
    })

    it('creates a completed run when none exists at the head', async () => {
      const run = lookupThen(LOOKUP(5, 'other-app'))
      await report(postedStep('Comment', ['https://r/1']), {
        run,
        appLogin: async () => 'my-app[bot]',
      }).result
      expect(lastArgs(run)).toContain('POST')
      expect(lastArgs(run)).toContain('repos/acme/widgets/check-runs')
      expect(fields(run)).toContain('name=Code review')
      expect(fields(run)).toContain(`head_sha=${SHA}`)
      expect(fields(run)).toContain('details_url=https://r/1')
    })

    it('creates one when the lookup fails, and omits details_url without a review', async () => {
      const run = vi.fn(async (args: readonly string[]) => {
        if (args.includes('--method')) return 'https://example.test/check/9\n'
        throw new Error('502')
      })
      const { result } = report(postedStep('Approve', []), { run })
      await expect(result).resolves.toMatchObject({ status: 'completed' })
      expect(lastArgs(run)).toContain('POST')
      expect(fields(run).some((field) => field.startsWith('details_url='))).toBe(false)
    })

    it('completes a held review as action_required, linking the pull request', async () => {
      const run = lookupThen(LOOKUP(4))
      await report(heldStep('flagged: 1 flag(s)', 'https://pr/4'), { run }).result
      expect(lastArgs(run)).toContain('repos/acme/widgets/check-runs/4')
      expect(fields(run)).toEqual([
        'status=completed',
        'conclusion=action_required',
        'details_url=https://pr/4',
        'output[title]=Held for a person: flagged: 1 flag(s)',
        'output[summary]=flagged: 1 flag(s)',
      ])
    })

    it('can open a run with a details URL', async () => {
      const { run, result } = report({ ...STARTED, url: 'https://pr/4' })
      await result
      expect(fields(run)).toContain('details_url=https://pr/4')
    })
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

    it('writes a held review as a pending status linking the pull request', async () => {
      const { run, result } = report(heldStep('flagged', 'https://pr/4'), { mode: 'gh' })
      await expect(result).resolves.toMatchObject({ status: 'completed', url: 'https://pr/4' })
      expect(statusFields(run).fields).toEqual([
        'state=pending',
        'context=Code review',
        'description=Held for a person: flagged',
        'target_url=https://pr/4',
      ])
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

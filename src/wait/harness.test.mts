import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BadRequestError,
  NotLoggedInError,
  OutOfScopeError,
  RelayError,
  UnauthorizedError,
} from '../../vendor/hook-harness-client.mjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Precondition } from '../run/preflight.mts'
import {
  CursorRejected,
  configurationFailure,
  createHarness,
  type HarnessBatch,
} from './harness.mts'
import { REQUESTED, setup } from './wait-fake-io.mts'
import { MAX_TRANSIENT_ERRORS, wait } from './wait.mts'

const ENV = { HOOK_HARNESS_URL: 'https://relay.example/', HOOK_HARNESS_TOKEN: 'hh_test' }

const page = (events: unknown[] = [], cursor = '1000', gap = false) =>
  new Response(JSON.stringify({ events, cursor, gap }), { status: 200 })

const status = (code: number) => new Response('', { status: code })

const envelope = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  id: 'd1',
  receivedAt: new Date().toISOString(),
  event: 'pull_request_review_comment',
  action: 'created',
  owner: 'acme',
  repo: 'acme/widgets',
  prs: [4],
  issue: null,
  headSha: null,
  sender: { login: 'dev', type: 'User' },
  label: null,
  payload: { comment: { id: 101, in_reply_to_id: 100, user: { login: 'dev' } } },
  ...extra,
})

const labelEnvelope = envelope({
  id: 'd2',
  event: 'pull_request',
  action: 'labeled',
  label: REQUESTED,
  payload: undefined,
})

/** The first two batches of one poll over both owners, then stops it. */
async function collect(harness: ReturnType<typeof createHarness>, after?: string) {
  const batches: HarnessBatch[] = []
  for await (const batch of harness({
    owners: ['acme', 'beta'],
    labels: [REQUESTED],
    ignoreSenders: ['bot[bot]'],
    signal: AbortSignal.timeout(1000),
    after,
  })) {
    batches.push(batch)
    if (batches.length >= 2) break
  }
  return batches
}

type Fetch = ReturnType<typeof vi.fn<(url: string | URL | Request) => Promise<Response>>>

/** The URLs a fake fetch was called with. */
const requested = (fetch: Fetch) =>
  fetch.mock.calls.map(
    ([url]) => new URL(typeof url === 'string' || url instanceof URL ? url : url.url),
  )

const harnessOver = (fetch: typeof globalThis.fetch, env: NodeJS.ProcessEnv = ENV) =>
  createHarness({ env, fetch, intervalMs: 1 })

describe('the hook-harness client harness', () => {
  it('polls every owner with the payload on and yields the fields wait reads', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) => page([envelope()]))
    const batches = await collect(harnessOver(fetch))
    const urls = requested(fetch)
    expect(
      urls
        .map((url) => url.searchParams.get('owner'))
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['acme', 'beta'])
    // The payload stays on: `in_reply_to_id` is how a reply is told from a new thread.
    expect(urls.every((url) => url.searchParams.get('payload') !== 'false')).toBe(true)
    expect(batches[0]).toMatchObject({
      events: [
        {
          repo: 'acme/widgets',
          prs: [4],
          event: 'pull_request_review_comment',
          action: 'created',
          payload: { comment: { id: 101, in_reply_to_id: 100, user: { login: 'dev' } } },
        },
      ],
    })
  })

  it('keeps a label event for the request label and drops an unrelated one', async () => {
    const other = envelope({ id: 'd3', event: 'pull_request', action: 'synchronize' })
    const [first] = await collect(harnessOver(vi.fn(async () => page([labelEnvelope, other]))))
    expect(first).toMatchObject({ events: [{ event: 'pull_request', label: REQUESTED }] })
    expect(first && 'events' in first ? first.events[0]?.payload : 'missing').toBeUndefined()
  })

  it('reads a comment with no id, user or reply id, and a payload without a comment', async () => {
    const bare = envelope({ id: 'd4', payload: { comment: {} } })
    const none = envelope({ id: 'd5', payload: {} })
    const [first] = await collect(harnessOver(vi.fn(async () => page([bare, none]))))
    expect(first).toMatchObject({
      events: [{ payload: { comment: { in_reply_to_id: null } } }, {}],
    })
  })

  it('sends the saved cursor as `after` and yields a cursor that resumes it', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) => page([], '2000'))
    const [first] = await collect(harnessOver(fetch))
    expect(first).toMatchObject({ cursor: expect.any(String), gap: false })
    const cursor = first && 'cursor' in first ? first.cursor : ''
    fetch.mockClear()
    await collect(harnessOver(fetch), cursor)
    expect(requested(fetch)[0]?.searchParams.get('after')).toBe('2000')
  })

  it('yields a transient error and goes on polling', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(status(500))
      .mockResolvedValue(page())
    const batches = await collect(harnessOver(fetch))
    expect(batches.some((batch) => 'error' in batch)).toBe(true)
    expect(batches.some((batch) => 'events' in batch)).toBe(true)
  })

  it('reads the saved login when the environment has no URL and token', async () => {
    const config = mkdtempSync(join(tmpdir(), 'hh-config-'))
    try {
      writeFileSync(
        join(config, 'client.json'),
        JSON.stringify({ url: 'https://saved.example/', token: 'hh_saved' }),
      )
      const fetch = vi.fn(async (_url: string | URL | Request) => page())
      await collect(harnessOver(fetch, { HOOK_HARNESS_CONFIG_DIR: config }))
      expect(requested(fetch)[0]?.host).toBe('saved.example')
    } finally {
      rmSync(config, { recursive: true, force: true })
    }
  })

  it('defaults to the process environment, the global fetch and the 5s interval', async () => {
    vi.stubEnv('HOOK_HARNESS_URL', ENV.HOOK_HARNESS_URL)
    vi.stubEnv('HOOK_HARNESS_TOKEN', ENV.HOOK_HARNESS_TOKEN)
    const fetch = vi.fn(async (_url: string | URL | Request) => page())
    vi.stubGlobal('fetch', fetch)
    try {
      expect(await collect(createHarness())).toHaveLength(2)
      expect(requested(fetch)[0]?.host).toBe('relay.example')
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('reports a gap', async () => {
    const [first] = await collect(harnessOver(vi.fn(async () => page([], '1', true))))
    expect(first).toMatchObject({ gap: true })
  })

  describe('configuration problems stop the poll as a Precondition', () => {
    const cases: Array<[string, typeof globalThis.fetch, NodeJS.ProcessEnv, string]> = [
      [
        'no login',
        async () => page(),
        { HOOK_HARNESS_CONFIG_DIR: '/nonexistent/hook-harness' },
        'hook-harness login',
      ],
      ['a refused token', async () => status(401), ENV, 'token was refused'],
      ['a token with no scope for an owner', async () => status(403), ENV, 'token was refused'],
      ['a bad request', async () => status(400), ENV, 'rejected the request'],
      [
        'a relay URL that is not https',
        async () => page(),
        { ...ENV, HOOK_HARNESS_URL: 'http://relay.example/' },
        'relay URL',
      ],
    ]
    it.each(cases)('for %s', async (_name, fetch, env, message) => {
      const failure = await collect(harnessOver(fetch, env)).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Precondition)
      expect((failure as Error).message).toContain(message)
    })
  })

  it('maps each error class by type, and leaves the rest alone', () => {
    expect(configurationFailure(new NotLoggedInError('x'))).toBeInstanceOf(Precondition)
    expect(configurationFailure(new UnauthorizedError('x'))).toBeInstanceOf(Precondition)
    expect(configurationFailure(new OutOfScopeError('x', 'acme', undefined))).toBeInstanceOf(
      Precondition,
    )
    expect(configurationFailure(new BadRequestError(400))).toBeInstanceOf(Precondition)
    expect(configurationFailure(new TypeError('unknown preset "x"'))).toBeInstanceOf(Precondition)
    expect(configurationFailure(new Error('invalid cursor: pass'))).toBeInstanceOf(CursorRejected)
    const transient = new RelayError(503)
    expect(configurationFailure(transient)).toBe(transient)
    expect(configurationFailure('plain text')).toBe('plain text')
  })
})

describe('wait with the real harness over an injected fetch', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wait-harness-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const over = (fetch: typeof globalThis.fetch) => {
    const fake = setup({ calls: [], stateDir: dir, labels: [REQUESTED] })
    return { ...fake, run: { ...fake.run, harness: harnessOver(fetch) } }
  }

  it('times out through the AbortSignal with the cursor it saved', async () => {
    const fake = over(vi.fn(async () => page([], '5000')))
    const out = await wait({ ...fake.waitOptions, timeoutSeconds: 0.1 }, fake.deps, fake.run)
    expect(out).toMatchObject({ outcome: 'timeout', exitCode: 11, timedOut: true })
    expect(out.cursor).not.toBeNull()
  })

  it('resumes from the cursor the earlier wait saved', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) => page([], '5000'))
    const fake = over(fetch)
    const first = await wait({ ...fake.waitOptions, timeoutSeconds: 0.1 }, fake.deps, fake.run)
    fetch.mockClear()
    await wait({ ...fake.waitOptions, timeoutSeconds: 0.1 }, fake.deps, fake.run)
    expect(first.cursor).not.toBeNull()
    expect(requested(fetch)[0]?.searchParams.get('after')).toBe('5000')
  })

  it('returns an outage after a run of failed polls', async () => {
    const fake = over(vi.fn(async () => status(503)))
    const out = await wait({ ...fake.waitOptions, timeoutSeconds: 60 }, fake.deps, fake.run)
    expect(out).toMatchObject({ outcome: 'error', exitCode: 13 })
    expect(out.error).toContain(`${MAX_TRANSIENT_ERRORS} polls in a row`)
  })

  it('stops when the relay refuses the token', async () => {
    const fake = over(vi.fn(async () => status(401)))
    await expect(wait(fake.waitOptions, fake.deps, fake.run)).rejects.toBeInstanceOf(Precondition)
  })

  it('stops when the saved cursor is not one hook-harness accepts', async () => {
    const fake = over(vi.fn(async () => page()))
    writeFileSync(join(dir, 'wait-test.cursor'), 'not a cursor\n')
    await expect(wait(fake.waitOptions, fake.deps, fake.run)).rejects.toThrow(
      `the cursor in ${join(dir, 'wait-test.cursor')}`,
    )
  })

  it('returns a request for a label event', async () => {
    const fake = over(vi.fn(async () => page([labelEnvelope])))
    expect(await wait(fake.waitOptions, fake.deps, fake.run)).toMatchObject({ outcome: 'work' })
  })
})

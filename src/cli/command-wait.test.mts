import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APP } from '../run/fake-deps.mts'
import { HOOK_HARNESS, createHarness, harnessArgs, parseHarnessResult } from '../wait/harness.mts'
import { REQUESTED, setup } from '../wait/wait-fake-io.mts'
import { AppNotInstalledError } from '../gh-cli/index.mts'
import { line } from './command-replies-line.mts'
import { repliesLine } from './command-replies.mts'
import { createWaitRun, parseTimeout, runWaitCommand } from './command-wait.mts'

vi.mock('./command-replies.mts', () => ({ repliesLine: vi.fn() }))

let dir: string
let out: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wait-cmd-'))
  out = []
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
    out.push(String(text))
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const printed = () => JSON.parse(out.join('')) as Record<string, unknown>

describe('parseTimeout', () => {
  it.each([
    [undefined, 7200],
    ['2h', 7200],
    ['30m', 1800],
    ['90s', 90],
    ['45', 45],
  ])('reads %s', (text, seconds) => expect(parseTimeout(text)).toBe(seconds))

  it.each(['', 'soon', '0', '-5m', '2d'])('refuses %j', (text) =>
    expect(() => parseTimeout(text)).toThrow('--timeout must be a duration'),
  )
})

describe('hook-harness call', () => {
  it('runs npx with the pinned arguments and reads its line', async () => {
    const exec = vi.fn(async () => '{"events":[],"gap":false,"cursor":"c"}')
    const call = {
      owners: ['a'],
      labels: [],
      ignoreSenders: [],
      timeoutSeconds: 5,
      after: undefined,
    }
    expect(await createHarness(exec)(call)).toEqual({ events: [], gap: false, cursor: 'c' })
    expect(exec).toHaveBeenCalledWith('npx', harnessArgs(call), { timeoutMs: 125_000 })
  })

  it('pins one version and filters review comments in the same wait as the request labels', () => {
    const args = harnessArgs({
      owners: ['a', 'b'],
      labels: ['x', 'y'],
      ignoreSenders: ['bot[bot]'],
      timeoutSeconds: 90,
      after: 'cur',
    })
    expect(args).toEqual([
      '-y',
      HOOK_HARNESS,
      'wait',
      '--owner',
      'a,b',
      '--on',
      'label:x',
      '--on',
      'label:y',
      '--filter',
      '{"event":"pull_request_review_comment","action":"created","ignoreSenders":["bot[bot]"]}',
      '--timeout',
      '90s',
      '--after',
      'cur',
    ])
    expect(HOOK_HARNESS).toBe('hook-harness@0.4.0')
  })

  it('starts from now without a cursor', () => {
    expect(
      harnessArgs({
        owners: ['a'],
        labels: [],
        ignoreSenders: [],
        timeoutSeconds: 5,
        after: undefined,
      }),
    ).not.toContain('--after')
  })

  it('reads its one JSON line and refuses anything else', () => {
    expect(parseHarnessResult('{"events":[],"gap":false,"cursor":"c","timedOut":true}')).toEqual({
      events: [],
      gap: false,
      cursor: 'c',
      timedOut: true,
    })
    expect(() => parseHarnessResult('{"events":"no"}')).toThrow('no events and cursor')
    expect(() => parseHarnessResult('not json')).toThrow()
  })
})

describe('the real GitHub reads', () => {
  it('runs replies as `replies --post auto` and sleeps on a real timer', async () => {
    const fake = setup({ calls: [], stateDir: dir })
    const run = createWaitRun(fake.deps)
    vi.mocked(repliesLine).mockResolvedValueOnce(line({ exitCode: 11 }))
    expect(await run.replies({ repo: 'acme/widgets', pr: 4 })).toMatchObject({ exitCode: 11 })
    expect(repliesLine).toHaveBeenCalledWith(
      { repo: ['acme/widgets'], pr: '4', post: 'auto' },
      fake.deps,
    )
    vi.useFakeTimers()
    const slept = run.sleep(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await slept
    vi.useRealTimers()
    expect(run.now()).toBeGreaterThan(0)
  })

  it('asks for the pull request state and the comment author as the owner', async () => {
    const fake = setup({ calls: [], stateDir: dir })
    const gh = vi.fn(async (args: string[]) =>
      args[1]?.includes('/comments/') ? 'bot[bot]\n' : 'open\n',
    )
    fake.deps.runner.mockReturnValue(gh)
    const run = createWaitRun(fake.deps)
    expect(await run.isOpen({ repo: 'acme/widgets', pr: 4 })).toBe(true)
    expect(await run.commentAuthor('acme/widgets', 9)).toBe('bot[bot]')
    expect(fake.deps.runner).toHaveBeenCalledWith('acme', 'widgets')
    expect(gh).toHaveBeenCalledWith(['api', 'repos/acme/widgets/pulls/4', '--jq', '.state'])
  })

  it('reads a closed pull request and a deleted comment', async () => {
    const fake = setup({ calls: [], stateDir: dir })
    fake.deps.runner.mockReturnValue(vi.fn(async () => 'closed\n'))
    const run = createWaitRun(fake.deps)
    expect(await run.isOpen({ repo: 'acme/widgets', pr: 4 })).toBe(false)
    fake.deps.runner.mockReturnValue(vi.fn(async () => '\n'))
    expect(await run.commentAuthor('acme/widgets', 9)).toBeUndefined()
  })
})

describe('code-reviewer wait', () => {
  function command(options: { identity?: boolean } = {}) {
    const fake = setup({
      calls: [{ events: [], gap: false, cursor: 'z', timedOut: true }],
      stateDir: dir,
    })
    fake.deps.runner.mockReturnValue(vi.fn(async () => ''))
    if (options.identity === false) fake.deps.authIdentity.mockResolvedValue({})
    return fake
  }

  it('waits on the owners, the request label and the default ignore list, and prints one line', async () => {
    const fake = command()
    const code = await runWaitCommand({ owner: 'acme,other', timeout: '1m' }, fake.deps, fake.run)
    expect(code).toBe(11)
    expect(fake.harness).toHaveBeenCalledWith({
      owners: ['acme', 'other'],
      labels: [REQUESTED],
      ignoreSenders: [APP.toLowerCase(), 'coderabbitai[bot]'],
      timeoutSeconds: 60,
      after: undefined,
    })
    expect(out).toHaveLength(1)
    expect(printed()).toMatchObject({ outcome: 'timeout', timedOut: true, cursor: 'z' })
    expect(fake.deps.checkInstallation).toHaveBeenCalledWith('acme')
  })

  it('lets flags set the ignore list, extra labels and the cursor name', async () => {
    const fake = command()
    await runWaitCommand(
      {
        owner: 'acme',
        'ignore-sender': ['other[bot]'],
        label: ['please review'],
        'cursor-name': 'mine',
      },
      fake.deps,
      fake.run,
    )
    expect(fake.harness).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: ['please review', REQUESTED],
        ignoreSenders: [APP.toLowerCase(), 'other[bot]'],
      }),
    )
  })

  it.each([
    ['no owner', {}, 'wait needs --owner'],
    ['a bad owner', { owner: 'a b' }, 'owner'],
    ['a bad timeout', { owner: 'acme', timeout: 'soon' }, '--timeout must be'],
  ])('stops with a configuration problem for %s before any wait', async (_name, values, reason) => {
    const fake = command()
    expect(await runWaitCommand(values, fake.deps, fake.run)).toBe(12)
    expect(printed()).toMatchObject({ outcome: 'error', exitCode: 12 })
    expect(String(printed().error)).toContain(reason)
    expect(fake.harness).not.toHaveBeenCalled()
  })

  it('stops when the App is not installed for an owner, and fails on any other error', async () => {
    const fake = command()
    fake.deps.checkInstallation.mockRejectedValueOnce(
      new AppNotInstalledError('acme', undefined, 'x'),
    )
    expect(await runWaitCommand({ owner: 'acme' }, fake.deps, fake.run)).toBe(12)
    expect(String(printed().error)).toContain('not installed')
    out.length = 0
    fake.deps.checkInstallation.mockRejectedValueOnce(new Error('network'))
    expect(await runWaitCommand({ owner: 'acme' }, fake.deps, fake.run)).toBe(13)
  })

  it('checks no App installation under the gh login', async () => {
    const fake = command()
    fake.deps.authMode.mockReturnValue('gh')
    expect(await runWaitCommand({ owner: 'acme' }, fake.deps, fake.run)).toBe(11)
    expect(fake.deps.checkInstallation).not.toHaveBeenCalled()
  })

  it('stops when the reviewer identity is unknown', async () => {
    const fake = command({ identity: false })
    expect(await runWaitCommand({ owner: 'acme' }, fake.deps, fake.run)).toBe(12)
    expect(String(printed().error)).toContain('identity is unknown')
  })
})

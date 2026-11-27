import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReplyCandidate, ReplyPlan } from '../review/replies/select.mts'
import { checkoutHead } from '../run/tree.mts'
import { SINCE_DIFF_CHARS, withSinceDiffs } from './command-replies-since.mts'
import type { ReviewDeps } from './deps.mts'

vi.mock('../run/tree.mts', async (original) => ({
  ...(await original<typeof import('../run/tree.mts')>()),
  checkoutHead: vi.fn(),
}))

const REVIEWED = 'a'.repeat(40)
const HEAD = 'c'.repeat(40)

const candidate = (thread: string, path: string | null): ReplyCandidate => ({
  thread,
  severity: 'high',
  pillar: 'correctness',
  title: 'Title',
  path,
  line: 3,
  finding: 'body',
  replies: [{ text: `fixed in ${HEAD.slice(0, 7)}` }],
})

const plan = (candidates: ReplyCandidate[]): ReplyPlan =>
  ({ headSha: HEAD, reviewedSha: REVIEWED, candidates, unjudged: [] }) as unknown as ReplyPlan

const remove = vi.fn(async () => undefined)

function setup(git: (args: string[]) => Promise<string>, root?: string) {
  vi.mocked(checkoutHead).mockResolvedValue({ path: '/tree', kind: 'worktree', remove })
  const run = vi.fn(git)
  const env = {
    env: root === undefined ? {} : { CODE_REVIEWER_CLONE_ROOT: root },
    tmp: '/tmp',
    git: run,
    remote: vi.fn(),
  }
  return { git: run, env: env as never }
}

const read = (candidates: ReplyCandidate[], env: never) =>
  withSinceDiffs({} as ReviewDeps, 'acme/widgets', plan(candidates), env)

afterEach(() => {
  vi.clearAllMocks()
})

describe('withSinceDiffs', () => {
  it('gives each candidate the diff of its file from the reviewed commit to the head', async () => {
    const { git, env } = setup(
      async (args) => (args.includes('diff') ? '-old\n+new\n' : ''),
      '/clones',
    )
    const result = await read([candidate('T1', 'a.ts')], env)
    expect(result).toMatchObject({ candidates: [{ thread: 'T1', sinceDiff: '-old\n+new\n' }] })
    expect(git).toHaveBeenCalledWith(['-C', '/tree', 'fetch', '--quiet', 'origin', REVIEWED])
    expect(git).toHaveBeenCalledWith(expect.arrayContaining(['diff', REVIEWED, HEAD, '--', 'a.ts']))
    expect(checkoutHead).toHaveBeenCalledWith(
      expect.objectContaining({ headSha: HEAD, clones: '/clones' }),
    )
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('says a file did not change, and cuts a long diff', async () => {
    const { env } = setup(async (args) =>
      args.at(-1) === 'long.ts' ? 'x'.repeat(SINCE_DIFF_CHARS + 5) : '',
    )
    const result = await read([candidate('T1', 'same.ts'), candidate('T2', 'long.ts')], env)
    if ('noop' in result) throw new Error(result.noop)
    expect(result.candidates[0]?.sinceDiff).toContain('no change')
    expect(result.candidates[1]?.sinceDiff?.endsWith('\n[cut]')).toBe(true)
    expect(result.candidates[1]?.sinceDiff).toHaveLength(SINCE_DIFF_CHARS + 6)
  })

  it('leaves a finding with no file unjudged, and does nothing when none is left', async () => {
    const { env } = setup(async () => 'diff')
    const some = await read([candidate('T1', null), candidate('T2', 'a.ts')], env)
    expect(some).toMatchObject({
      candidates: [{ thread: 'T2' }],
      unjudged: [{ thread: 'T1', why: expect.stringContaining('no file') }],
    })
    expect(await read([candidate('T1', null)], env)).toEqual({
      noop: expect.stringContaining('could be read'),
    })
  })

  it('does nothing, and removes the checkout, when the reviewed commit cannot be fetched', async () => {
    const { env } = setup(async () => {
      throw new Error('unknown revision')
    })
    expect(await read([candidate('T1', 'a.ts')], env)).toEqual({
      noop: expect.stringContaining('unknown revision'),
    })
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('leaves a thread whose diff fails unjudged and still judges the others', async () => {
    const { env } = setup(async (args) => {
      if (args.at(-1) === 'bad.ts') throw new Error('bad path')
      return args.includes('diff') ? 'diff' : ''
    })
    const result = await read([candidate('T1', 'bad.ts'), candidate('T2', 'a.ts')], env)
    expect(result).toMatchObject({
      candidates: [{ thread: 'T2', sinceDiff: 'diff' }],
      unjudged: [{ thread: 'T1', why: expect.stringContaining('bad path') }],
    })
  })

  it('does nothing when every diff fails', async () => {
    const { env } = setup(async (args) => {
      if (args.includes('diff')) throw new Error('bad path')
      return ''
    })
    expect(await read([candidate('T1', 'a.ts')], env)).toEqual({
      noop: expect.stringContaining('could be read'),
    })
  })

  it('ignores a checkout that cannot be removed', async () => {
    const { env } = setup(async () => 'diff')
    remove.mockRejectedValueOnce(new Error('busy'))
    expect(await read([candidate('T1', 'a.ts')], env)).toMatchObject({ candidates: [{}] })
  })

  it('does nothing when the head cannot be checked out', async () => {
    const { env } = setup(async () => '')
    vi.mocked(checkoutHead).mockRejectedValue(new Error('no clone'))
    expect(await read([candidate('T1', 'a.ts')], env)).toEqual({
      noop: expect.stringContaining('no clone'),
    })
  })
})

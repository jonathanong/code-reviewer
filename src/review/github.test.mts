import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { createGhReviewIo, ReviewRejectedError } from './github.mts'
import { assertPullTarget } from './target.mts'

const target = { repo: 'acme/widgets', pr: 7 }

function setup(responses: string[] = []) {
  const calls: string[][] = []
  const run = vi.fn(async (args: string[]) => {
    calls.push(args)
    return responses.shift() ?? ''
  })
  return { calls, run, io: createGhReviewIo(target, run) }
}

const review = { event: 'COMMENT' as const, commit_id: 'x', body: 'b', comments: [] }

describe('assertPullTarget', () => {
  it('validates repo and pr', () => {
    expect(() => assertPullTarget(target)).not.toThrow()
    expect(() => assertPullTarget({ repo: 'nope', pr: 1 })).toThrow('--repo must be owner/name.')
    expect(() => assertPullTarget({ repo: 'a/b', pr: 0 })).toThrow(
      '--pr must be a positive integer.',
    )
    expect(() => assertPullTarget({ repo: 'a/b', pr: 1.5 })).toThrow(
      '--pr must be a positive integer.',
    )
    expect(() => createGhReviewIo({ repo: 'x', pr: 1 }, vi.fn())).toThrow('--repo')
  })
})

describe('createGhReviewIo', () => {
  it('reads the head sha', async () => {
    const { io, calls } = setup(['abc123\n'])
    await expect(io.headSha()).resolves.toBe('abc123')
    expect(calls[0]).toEqual([
      'pr',
      'view',
      '7',
      '-R',
      'acme/widgets',
      '--json',
      'headRefOid',
      '-q',
      '.headRefOid',
    ])
  })

  it('reads the diff', async () => {
    const { io, calls } = setup(['@@ -1 +1 @@\n'])
    await expect(io.diff()).resolves.toBe('@@ -1 +1 @@\n')
    expect(calls[0]).toEqual(['pr', 'diff', '7', '-R', 'acme/widgets', '--color', 'never'])
  })

  it('lists files', async () => {
    const { io, calls } = setup(['[{"filename":"a.ts","patch":"@@ -1 +1 @@\\n+x\\n"}]'])
    await expect(io.listFiles()).resolves.toEqual([
      { filename: 'a.ts', patch: '@@ -1 +1 @@\n+x\n' },
    ])
    expect(calls[0]).toEqual(['api', '--paginate', 'repos/acme/widgets/pulls/7/files?per_page=100'])
  })

  it('lists reviews with authors decoded from json lines', async () => {
    const { io, calls } = setup([
      '{"id":1,"url":"https://example.test/1","body":"one\\ntwo","author":"bot"}\n\n  {"id":2,"url":"https://example.test/2","body":"three","author":null}  \n',
    ])
    await expect(io.listReviews()).resolves.toEqual([
      { id: 1, url: 'https://example.test/1', body: 'one\ntwo', author: 'bot' },
      { id: 2, url: 'https://example.test/2', body: 'three', author: null },
    ])
    expect(calls[0]?.slice(-2)).toEqual([
      '-q',
      '.[] | {id, url: .html_url, body, author: .user.login} | @json',
    ])
  })

  it('lists reviews that request changes, and dismisses one with a message', async () => {
    const { io, calls } = setup(['{"id":9,"body":"b","author":"bot[bot]"}\n', ''])
    await expect(io.changesRequested()).resolves.toEqual([{ id: 9, body: 'b', author: 'bot[bot]' }])
    expect(calls[0]?.at(-1)).toContain('CHANGES_REQUESTED')
    await io.dismissReview(9, 'Superseded.')
    expect(calls[1]).toEqual([
      'api',
      '--method',
      'PUT',
      'repos/acme/widgets/pulls/7/reviews/9/dismissals',
      '-f',
      'message=Superseded.',
    ])
  })

  it('resolves trusted authors from the viewer and the allowlist', async () => {
    const { io, calls } = setup(['{"data":{"viewer":{"login":"Me"}}}'])
    await expect(io.trustedAuthors()).resolves.toEqual(new Set(['me']))
    expect(calls[0]?.join(' ')).toContain('viewer')
  })

  it('detects the approval label', async () => {
    const yes = setup(['bug\nfinal approval\n'])
    await expect(yes.io.hasApprovalLabel()).resolves.toBe(true)
    const no = setup(['bug\n'])
    await expect(no.io.hasApprovalLabel()).resolves.toBe(false)
  })

  it('uses the configured approval label', async () => {
    const yes = setup(['final approval\n'])
    await expect(yes.io.hasApprovalLabel()).resolves.toBe(true)
    const calls: string[][] = []
    const io = createGhReviewIo(
      target,
      async (args) => {
        calls.push(args)
        return 'bug\nlgtm\n'
      },
      async () => undefined,
      async () => 'lgtm',
    )
    await expect(io.hasApprovalLabel()).resolves.toBe(true)
    await io.addApprovalLabel()
    await io.removeApprovalLabel()
    expect(calls[1]).toContain('labels[]=lgtm')
    expect(calls[2]?.[3]).toBe('repos/acme/widgets/issues/7/labels/lgtm')
  })

  it('posts a review from a temp file and cleans it up', async () => {
    let file = ''
    let content = ''
    const run = vi.fn(async (args: string[]) => {
      file = args[args.indexOf('--input') + 1] as string
      content = readFileSync(file, 'utf8')
      return ' https://example.test/r \n'
    })
    const io = createGhReviewIo(target, run)
    await expect(io.postReview(review)).resolves.toBe('https://example.test/r')
    expect(JSON.parse(content)).toEqual(review)
    expect(existsSync(file)).toBe(false)
    expect(run.mock.calls[0]?.[0].slice(0, 4)).toEqual([
      'api',
      '--method',
      'POST',
      'repos/acme/widgets/pulls/7/reviews',
    ])
  })

  it('reads the pull request author, and none when GitHub reports none', async () => {
    const run = vi.fn(async () => 'dev[bot]\n')
    await expect(createGhReviewIo(target, run).pullAuthor()).resolves.toBe('dev[bot]')
    expect(run).toHaveBeenCalledWith(['api', 'repos/acme/widgets/pulls/7', '-q', '.user.login'])
    await expect(createGhReviewIo(target, async () => '\n').pullAuthor()).resolves.toBeUndefined()
  })

  it('reports a 422 as a rejected review and other failures as they are', async () => {
    const io = createGhReviewIo(target, async () => {
      throw new Error('Command failed: gh api\ngh: Unprocessable Entity (HTTP 422)')
    })
    await expect(io.postReview(review)).rejects.toThrow(ReviewRejectedError)
    const other = createGhReviewIo(target, async () => {
      throw new Error('HTTP 500')
    })
    await expect(other.postReview(review)).rejects.not.toBeInstanceOf(ReviewRejectedError)
    const notAnError = createGhReviewIo(target, async () => Promise.reject('plain'))
    await expect(notAnError.postReview(review)).rejects.toBe('plain')
  })

  it('cleans up the temp file when gh fails', async () => {
    let file = ''
    const io = createGhReviewIo(target, async (args) => {
      file = args[args.indexOf('--input') + 1] as string
      throw new Error('gh failed')
    })
    await expect(io.postReview(review)).rejects.toThrow('gh failed')
    expect(existsSync(file)).toBe(false)
  })

  it('adds and removes the label', async () => {
    const { io, calls } = setup()
    await io.addApprovalLabel()
    await io.removeApprovalLabel()
    expect(calls[0]).toEqual([
      'api',
      '--method',
      'POST',
      'repos/acme/widgets/issues/7/labels',
      '-f',
      'labels[]=final approval',
    ])
    expect(calls[1]).toEqual([
      'api',
      '--method',
      'DELETE',
      'repos/acme/widgets/issues/7/labels/final%20approval',
      '--silent',
    ])
  })

  it('removes a label whose name has a comma as one label', async () => {
    const calls: string[][] = []
    const io = createGhReviewIo(
      target,
      async (args) => (calls.push(args), ''),
      async () => undefined,
      async () => 'ok, ship',
    )
    await io.removeApprovalLabel()
    expect(calls[0]?.[3]).toBe('repos/acme/widgets/issues/7/labels/ok%2C%20ship')
    expect(calls[0]).not.toContain('pr')
  })

  it('defaults to the gh runner', () => {
    expect(createGhReviewIo(target)).toHaveProperty('headSha')
  })
})

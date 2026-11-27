import { describe, expect, it } from 'vitest'

import { collectOutcomes, type CollectOptions } from './collect.mts'
import { fakeGh, HEAD, io, OID, review, seeded, thread } from './github-fake-io.mts'

const OPTIONS: CollectOptions = {
  repos: ['acme/widgets'],
  owner: undefined,
  pr: undefined,
  sinceDays: 30,
}

describe('a fix elsewhere in the file, cited by a reply', () => {
  const FIX = 'c'.repeat(40)
  const reply = (body: string, over: Partial<Parameters<typeof thread>[0]> = {}) =>
    thread({ id: 1, resolved: true, replyBy: 'author', replyBody: body, ...over })

  /** The clone: no later commit touches the commented lines; the file log lists `touching`. */
  const clone = (touching: string) => async (args: string[]) =>
    args.includes('-L') ? '' : touching

  async function outcome(
    threads: ReturnType<typeof thread>[],
    git: (args: string[]) => Promise<string>,
  ) {
    const gh = fakeGh({ 7: { reviews: [review(100)], threads } })
    const found = await collectOutcomes(OPTIONS, seeded(), io({ git }, gh))
    return found.rows[0]?.outcome
  }

  it('fixed: the reply cites a later commit that changed the file, not the commented lines', async () => {
    const threads = [reply(`Fixed in ${FIX.slice(0, 7)}: claims first.`)]
    expect(await outcome(threads, clone(`${FIX}\n`))).toBe('fixed')
  })

  it('fixed: an outdated thread counts the same as a resolved one', async () => {
    const threads = [reply(`Fixed in ${FIX}.`, { resolved: false, outdated: true })]
    expect(await outcome(threads, clone(`${FIX}\n`))).toBe('fixed')
  })

  it('asks the clone which commits changed the file since the comment', async () => {
    const calls: string[][] = []
    const git = async (args: string[]) => (calls.push(args), clone(`${FIX}\n`)(args))
    await outcome([reply(`Fixed in ${FIX.slice(0, 7)}.`)], git)
    expect(calls[1]).toEqual([
      '-C',
      '/clones/widgets',
      'log',
      '--format=%H',
      `${OID}..${HEAD}`,
      '--',
      'src/a.ts',
    ])
  })

  it('disputed: a reply with no commit stays a dispute even when the file changed', async () => {
    const threads = [reply('I disagree; this is intended.')]
    expect(await outcome(threads, clone(`${FIX}\n`))).toBe('disputed')
  })

  it('disputed: the cited commit did not change the file, or is not after the comment', async () => {
    const threads = [reply(`Fixed in ${FIX.slice(0, 7)}.`)]
    expect(await outcome(threads, clone(`${'d'.repeat(40)}\n`))).toBe('disputed')
    expect(await outcome(threads, clone(''))).toBe('disputed')
  })

  it('disputed: a thread still open stays a dispute, whatever the reply cites', async () => {
    const threads = [reply(`Fixed in ${FIX}.`, { resolved: false })]
    expect(await outcome(threads, clone(`${FIX}\n`))).toBe('disputed')
  })

  it('ignores a commit cited by the reviewer itself', async () => {
    const threads = [reply(`Fixed in ${FIX}.`, { replyBy: 'reviewer[bot]' })]
    expect(await outcome(threads, clone(`${FIX}\n`))).toBe('resolved')
  })

  it('uses the compare API without a clone: the cited commit must be listed and touch the file', async () => {
    const api = {
      commits: [{ sha: FIX }],
      files: [{ filename: 'src/a.ts', patch: '@@ -1,1 +1,1 @@' }],
    }
    const threads = [reply(`Fixed in ${FIX.slice(0, 7)}.`)]
    const run = async (compare: Record<string, unknown>) => {
      const gh = fakeGh({ 7: { reviews: [review(100)], threads } }, compare)
      const alone = io({ findClone: async () => undefined }, gh)
      return (await collectOutcomes(OPTIONS, seeded(), alone)).rows[0]?.outcome
    }
    expect(await run(api)).toBe('fixed')
    expect(await run({ ...api, files: [{ filename: 'src/b.ts' }] })).toBe('disputed')
    expect(await run({ commits: [{ sha: 'd'.repeat(40) }], files: api.files })).toBe('disputed')
    expect(await run({ commits: 'none' })).toBe('disputed')
  })

  it('falls back to the API when the clone cannot list the commits, and reports when nothing can', async () => {
    const threads = [reply(`Fixed in ${FIX}.`)]
    const api = {
      commits: [{ sha: FIX }],
      files: [{ filename: 'src/a.ts', patch: '@@ -1,1 +1,1 @@' }],
    }
    const broken = async (args: string[]) => {
      if (args.includes('-L')) return ''
      throw new Error('bad object')
    }
    const gh = fakeGh({ 7: { reviews: [review(100)], threads } }, api)
    const found = await collectOutcomes(OPTIONS, seeded(), io({ git: broken }, gh))
    expect(found.rows[0]?.outcome).toBe('fixed')
    const down = fakeGh({ 7: { reviews: [review(100)], threads } }, new Error('HTTP 404'))
    const lost = await collectOutcomes(OPTIONS, seeded(), io({ git: broken }, down))
    expect(lost.rows[0]?.outcome).toBe('disputed')
    expect(lost.problems.join('\n')).toContain('could not tell whether src/a.ts changed')
  })

  it('asks nothing of a reply that cites no commit', async () => {
    const calls: string[][] = []
    const git = async (args: string[]) => (calls.push(args), '')
    await outcome([reply('Fixed, thanks.')], git)
    expect(calls).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'

import { collectOutcomes, MAX_PULLS, type CollectOptions } from './collect.mts'
import { fakeGh, HEAD, io, OID, posted, review, seeded, thread, BODY } from './github-fake-io.mts'
import type { FakePull } from './github-fake-io.mts'

const OPTIONS: CollectOptions = {
  repos: ['acme/widgets'],
  owner: undefined,
  pr: undefined,
  sinceDays: 30,
}

async function outcomeOf(pull: FakePull, git = `${HEAD}\n`) {
  const gh = fakeGh({ 7: { reviews: [review(100)], ...pull } })
  const found = await collectOutcomes(OPTIONS, seeded(), io({ git: async () => git }, gh))
  return found.rows
}

const one = async (pull: FakePull, git?: string) => (await outcomeOf(pull, git))[0]?.outcome

describe('outcome classes', () => {
  it('fixed: resolved, and a later commit changed the lines', async () => {
    expect(await one({ threads: [thread({ id: 1, resolved: true })] })).toBe('fixed')
  })

  it('fixed: outdated while unresolved, and a later commit changed the lines', async () => {
    expect(await one({ threads: [thread({ id: 1, outdated: true })] })).toBe('fixed')
  })

  it('resolved with no code change is neither fixed nor wrong', async () => {
    expect(await one({ threads: [thread({ id: 1, resolved: true })] }, '')).toBe('resolved')
  })

  it('disputed: a reply from someone else ends an unresolved thread', async () => {
    const threads = [thread({ id: 1, replyBy: 'author' })]
    expect(await one({ threads })).toBe('disputed')
  })

  it('disputed: resolved without a code change, ending on a reply', async () => {
    const threads = [thread({ id: 1, resolved: true, replyBy: 'author' })]
    expect(await one({ threads }, '')).toBe('disputed')
  })

  it('fixed beats a closing reply when the code changed', async () => {
    const threads = [thread({ id: 1, resolved: true, replyBy: 'author' })]
    expect(await one({ threads })).toBe('fixed')
  })

  it('a reply from the reviewer itself is not a dispute', async () => {
    const threads = [thread({ id: 1, replyBy: 'reviewer[bot]' })]
    expect(await one({ threads })).toBe('open')
  })

  it('dismissed: the review was dismissed', async () => {
    const reviews = [review(100, { state: 'DISMISSED' })]
    expect(await one({ reviews, threads: [thread({ id: 1 })] })).toBe('dismissed')
  })

  it('open: unresolved on an open pull request', async () => {
    expect(await one({ threads: [thread({ id: 1 })] })).toBe('open')
  })

  it('ignored: untouched when the pull request merged or closed', async () => {
    expect(await one({ state: 'MERGED', threads: [thread({ id: 1 })] })).toBe('ignored')
    expect(await one({ state: 'CLOSED', threads: [thread({ id: 1 })] })).toBe('ignored')
  })

  it('ignores threads of other reviews and a thread with no comments', async () => {
    const empty = { isResolved: false, isOutdated: false, comments: { nodes: [] } }
    expect(await outcomeOf({ threads: [thread({ id: 1, review: 999 }), empty] })).toEqual([])
  })
})

describe('reactions', () => {
  it('a thumbs-down on the comment rejects the finding over any other outcome', async () => {
    const threads = [thread({ id: 1, resolved: true, down: 1, up: 2, other: { LAUGH: 3 } })]
    const [found] = await outcomeOf({ threads })
    expect(found?.outcome).toBe('rejected')
    expect(found?.reactions.finding).toEqual({ up: 2, down: 1, other: { LAUGH: 3 } })
  })

  it('a thumbs-down on the review body rejects every finding of the review, body findings too', async () => {
    const body = `<details><summary>[low] Naming (\`src/b.ts:3\`)</summary>\n\n<sub>design</sub>\n\nx</details>`
    const reviews = [
      review(100, {
        body,
        reactionGroups: [{ content: 'THUMBS_DOWN', reactors: { totalCount: 1 } }],
      }),
    ]
    const found = await outcomeOf({ reviews, threads: [thread({ id: 1 })] })
    expect(found.map((row) => row.outcome)).toEqual(['rejected', 'rejected'])
    expect(found[1]?.reactions.review.down).toBe(1)
  })

  it('ignores reaction groups with no count and counts a repeated kind once per group', async () => {
    const [found] = await outcomeOf({ threads: [thread({ id: 1 })] })
    expect(found?.reactions).toEqual({
      finding: { up: 0, down: 0, other: {} },
      review: { up: 0, down: 0, other: {} },
    })
  })
})

describe('what a row carries', () => {
  it('reads severity, pillar, title and the rule skill the comment names', async () => {
    const threads = [thread({ id: 1, body: BODY('no-mistakes-rules:typescript-rules') })]
    const [found] = await outcomeOf({ threads })
    expect(found).toMatchObject({
      repo: 'acme/widgets',
      pr: 7,
      reviewId: 100,
      head: HEAD,
      key: 'acme/widgets#7/100/1',
      severity: 'high',
      pillar: 'rules',
      title: 'Missing check',
      rule: 'no-mistakes-rules:typescript-rules',
      path: 'src/a.ts',
      url: 'https://example.test/comment/1',
      checkedAt: '2026-06-10T12:00:00.000Z',
    })
  })

  it('keeps a comment it cannot parse, with no pillar, severity or rule', async () => {
    const [found] = await outcomeOf({ threads: [thread({ id: 1, body: 'plain words\nmore' })] })
    expect(found).toMatchObject({ pillar: null, severity: null, rule: null, title: 'plain words' })
  })

  it('records body-only findings with review-level signals: open, then ignored once merged', async () => {
    const body = `<details><summary>[medium] Docs drift</summary>\n\n<sub>congruence</sub>\n\nx</details>`
    const reviews = [review(100, { body })]
    const [open] = await outcomeOf({ reviews })
    expect(open).toMatchObject({
      key: 'acme/widgets#7/100/body/0',
      title: 'Docs drift',
      outcome: 'open',
      path: null,
    })
    expect(await one({ reviews, state: 'MERGED' })).toBe('ignored')
    expect(await one({ reviews: [{ ...reviews[0], state: 'DISMISSED' }] })).toBe('dismissed')
  })
})

describe('changed lines, with and without a clone', () => {
  const resolved = [thread({ id: 1, resolved: true })]
  const compare = (patch: string, filename = 'src/a.ts') => ({ files: [{ filename, patch }] })

  async function run(
    over: Parameters<typeof io>[0],
    gh = fakeGh({ 7: { reviews: [review(100)], threads: resolved } }),
  ) {
    return { found: await collectOutcomes(OPTIONS, seeded(), io(over, gh)), gh }
  }

  it('asks the clone for the commented lines since the comment, and never the API', async () => {
    const git = async () => `${HEAD}\n`
    const calls: string[][] = []
    const { found, gh } = await run({ git: async (args) => (calls.push(args), git()) })
    expect(found.rows[0]?.outcome).toBe('fixed')
    expect(calls).toEqual([
      [
        '-C',
        '/clones/widgets',
        'log',
        '--format=%H',
        `${OID}..${HEAD}`,
        '-s',
        '-L',
        '12,14:src/a.ts',
      ],
    ])
    expect(gh.calls.some((args) => args[1]?.startsWith('repos/'))).toBe(false)
  })

  it('asks for the whole file when the comment has no line', async () => {
    const calls: string[][] = []
    const gh = fakeGh({
      7: { reviews: [review(100)], threads: [thread({ id: 1, resolved: true, line: null })] },
    })
    await run({ git: async (args) => (calls.push(args), `${HEAD}\n`) }, gh)
    expect(calls[0]?.slice(-2)).toEqual(['--', 'src/a.ts'])
  })

  it('falls back to the compare API without a clone: a hunk on the lines is a change', async () => {
    const hit = await run({ findClone: async () => undefined }, undefined)
    expect(hit.found.rows[0]?.outcome).toBe('resolved')
    const gh = fakeGh(
      { 7: { reviews: [review(100)], threads: resolved } },
      compare('@@ -13,2 +13,3 @@\n x'),
    )
    const found = await collectOutcomes(
      OPTIONS,
      seeded(),
      io({ findClone: async () => undefined }, gh),
    )
    expect(found.rows[0]?.outcome).toBe('fixed')
    expect(gh.calls.at(-1)).toEqual(['api', `repos/acme/widgets/compare/${OID}...${HEAD}`])
  })

  it('a hunk elsewhere in the file is not a change; a hunk with no count is one line', async () => {
    for (const [patch, outcome] of [
      ['@@ -40,2 +40,2 @@', 'resolved'],
      ['@@ -14 +14 @@', 'fixed'],
      ['@@ -3,0 +3,2 @@', 'resolved'],
    ] as const) {
      const gh = fakeGh({ 7: { reviews: [review(100)], threads: resolved } }, compare(patch))
      const found = await collectOutcomes(
        OPTIONS,
        seeded(),
        io({ findClone: async () => undefined }, gh),
      )
      expect(found.rows[0]?.outcome).toBe(outcome)
    }
  })

  it('falls back to the API when the clone lacks the commits', async () => {
    const gh = fakeGh(
      { 7: { reviews: [review(100)], threads: resolved } },
      compare('@@ -12,1 +12,1 @@'),
    )
    const git = async () => {
      throw new Error('bad object')
    }
    const found = await collectOutcomes(OPTIONS, seeded(), io({ git }, gh))
    expect(found.rows[0]?.outcome).toBe('fixed')
  })

  it('a file the API does not list is unchanged; a whole-file comment on a changed file is changed', async () => {
    const other = fakeGh(
      { 7: { reviews: [review(100)], threads: resolved } },
      compare('@@ -12 +12 @@', 'src/z.ts'),
    )
    expect(
      (await collectOutcomes(OPTIONS, seeded(), io({ findClone: async () => undefined }, other)))
        .rows[0]?.outcome,
    ).toBe('resolved')
    const whole = fakeGh(
      { 7: { reviews: [review(100)], threads: [thread({ id: 1, resolved: true, line: null })] } },
      compare(''),
    )
    expect(
      (await collectOutcomes(OPTIONS, seeded(), io({ findClone: async () => undefined }, whole)))
        .rows[0]?.outcome,
    ).toBe('fixed')
  })

  it('treats a listed file without a patch as unchanged', async () => {
    const gh = fakeGh(
      { 7: { reviews: [review(100)], threads: resolved } },
      { files: [{ filename: 'src/a.ts' }] },
    )
    const found = await collectOutcomes(
      OPTIONS,
      seeded(),
      io({ findClone: async () => undefined }, gh),
    )
    expect(found.rows[0]?.outcome).toBe('resolved')
  })

  it('treats a compare response without files as unchanged', async () => {
    const gh = fakeGh({ 7: { reviews: [review(100)], threads: resolved } }, {})
    const found = await collectOutcomes(
      OPTIONS,
      seeded(),
      io({ findClone: async () => undefined }, gh),
    )
    expect(found.rows[0]?.outcome).toBe('resolved')
  })

  it('reports a problem and does not call it fixed when neither source can say', async () => {
    const gh = fakeGh({ 7: { reviews: [review(100)], threads: resolved } }, new Error('HTTP 404'))
    const found = await collectOutcomes(
      OPTIONS,
      seeded(),
      io({ findClone: async () => undefined }, gh),
    )
    expect(found.rows[0]?.outcome).toBe('resolved')
    expect(found.problems.join('\n')).toContain('could not tell whether src/a.ts changed')
  })

  it('reports a thrown non-error value as text, when comparing and when reading', async () => {
    const throwing = (value: unknown) => async () => {
      throw value
    }
    const gh = fakeGh({ 7: { reviews: [review(100)], threads: resolved } })
    const compared = await collectOutcomes(
      OPTIONS,
      seeded(),
      io(
        {
          git: throwing('broken'),
          run: () => (args) => (args[1]?.startsWith('repos/') ? throwing('plain')() : gh.run(args)),
        },
        gh,
      ),
    )
    expect(compared.problems.join('\n')).toContain('plain')
    const read = await collectOutcomes(OPTIONS, seeded(), io({ run: () => throwing('nope') }, gh))
    expect(read.problems).toEqual(['acme/widgets#7 was not checked: nope'])
  })

  it('without a commit or a path to compare, nothing counts as changed', async () => {
    const found = await collectOutcomes(
      OPTIONS,
      seeded(),
      io(
        {},
        fakeGh({
          7: { reviews: [review(100)], threads: [thread({ id: 1, resolved: true, oid: null })] },
        }),
      ),
    )
    expect(found.rows[0]?.outcome).toBe('resolved')
  })
})

describe('which pull requests are read', () => {
  const pulls = { 7: { reviews: [review(100)], threads: [thread({ id: 1 })] } }

  it('reads each pull request once however many reviews it has, in two paginated call sets', async () => {
    const gh = fakeGh({
      7: {
        reviews: [review(100), review(101)],
        threads: [thread({ id: 1 }), thread({ id: 2, review: 101 })],
      },
    })
    const tracker = seeded(posted(), posted({ head: 'c'.repeat(40), reviewId: 101 }))
    const found = await collectOutcomes(OPTIONS, tracker, io({}, gh))
    expect(found.rows.map((row) => [row.reviewId, row.head])).toEqual([
      [100, HEAD],
      [101, 'c'.repeat(40)],
    ])
    expect(gh.calls).toHaveLength(2)
  })

  it('filters by repo, owner, pull request, window and state', async () => {
    const tracker = seeded(
      posted(),
      posted({ pr: 8, repo: 'Other/thing', reviewId: 5 }),
      posted({ pr: 9, postedAt: '2026-01-01T00:00:00.000Z' }),
      posted({ pr: 10, state: 'reviewed' }),
      posted({ pr: 11, reviewId: null }),
      posted({ pr: 12, postedAt: null }),
    )
    const gh = fakeGh({ ...pulls, 8: pulls[7], 9: pulls[7] })
    const byOwner = await collectOutcomes(
      { ...OPTIONS, repos: [], owner: 'ACME' },
      tracker,
      io({}, gh),
    )
    expect(byOwner.pulls).toBe(1)
    expect(
      (await collectOutcomes({ ...OPTIONS, repos: [], owner: 'other' }, tracker, io({}, gh))).pulls,
    ).toBe(1)
    expect((await collectOutcomes({ ...OPTIONS, pr: 8 }, tracker, io({}, gh))).pulls).toBe(0)
    expect((await collectOutcomes({ ...OPTIONS, sinceDays: 365 }, tracker, io({}, gh))).pulls).toBe(
      2,
    )
  })

  it('stops at the cap with the rest counted as not checked, newest first', async () => {
    const rows = Array.from({ length: MAX_PULLS + 1 }, (_, index) =>
      posted({ pr: index + 1, postedAt: new Date(Date.UTC(2026, 5, 1, 0, index)).toISOString() }),
    )
    const all = Object.fromEntries(rows.map((row) => [row.pr, pulls[7]]))
    const gh = fakeGh(all)
    const found = await collectOutcomes(OPTIONS, seeded(...rows), io({}, gh))
    expect(found.pulls).toBe(MAX_PULLS)
    expect(found.notChecked).toBe(1)
    expect(found.rows.some((row) => row.pr === 1)).toBe(false)
  })

  it('bounds the pages read per pull request and says it was cut short', async () => {
    const reviews = Array.from({ length: 12 }, (_, index) => review(100 + index))
    const gh = fakeGh({ 7: { reviews, threads: [], pageSize: 2 } })
    const found = await collectOutcomes(OPTIONS, seeded(), io({}, gh))
    expect(gh.calls.filter((args) => args.some((arg) => arg.includes('reviews(')))).toHaveLength(5)
    expect(found.problems).toEqual(['acme/widgets#7 has more reviews or threads than were read.'])
  })

  it('stops paging when GitHub names no next cursor', async () => {
    const gh = fakeGh({ 7: { reviews: [review(100)], threads: [] } })
    const found = await collectOutcomes(OPTIONS, seeded(), io({}, gh))
    expect(gh.calls).toHaveLength(2)
    expect(found.problems).toEqual([])
  })

  it('reports a pull request that cannot be read, or a review that is gone, and goes on', async () => {
    const tracker = seeded(posted({ pr: 7 }), posted({ pr: 8 }), posted({ pr: 9, reviewId: 555 }))
    const gh = fakeGh({
      7: { fails: true },
      8: { reviews: [review(100)], threads: [thread({ id: 1 })] },
      9: { reviews: [] },
    })
    const found = await collectOutcomes(OPTIONS, tracker, io({}, gh))
    expect(found.rows).toHaveLength(1)
    expect(found.problems).toEqual(
      expect.arrayContaining([
        'acme/widgets#7 was not checked: HTTP 502',
        'acme/widgets#9: review 555 is no longer on the pull request.',
      ]),
    )
  })

  it('passes the repository to the runner and tolerates a malformed tracker line', async () => {
    const calls: string[][] = []
    const gh = fakeGh(pulls)
    const tracker = seeded()
    tracker.append(`${tracker.dir}/reviews.jsonl`, 'oops\n')
    const found = await collectOutcomes(OPTIONS, tracker, {
      ...io({}, gh),
      run: (owner, repo) => (calls.push([owner, repo]), gh.run),
    })
    expect(calls).toEqual([['acme', 'widgets']])
    expect(found.problems).toEqual(['tracker line 2 was skipped: it is not valid JSON.'])
  })
})

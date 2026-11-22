import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARLIER_HEAD, FINDING, QUESTION, RUN_DIR } from './earlier-fake-io.mts'
import { prepareReview } from './prepare.mts'
import { BASE, HEAD, PATCH, conversation, fakeIo, inspection } from './prepare-fake-io.mts'

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'prepare-earlier-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

const EARLIER = {
  sha: EARLIER_HEAD,
  runDir: RUN_DIR,
  verdict: 'Request Changes',
  findings: [FINDING],
  questions: [QUESTION],
}
const find = () => vi.fn((_head: string) => EARLIER)
const exists = (name: string) => existsSync(join(out, name))

// The base changed src/a.ts, which the pull request also changes.
const REBASE = inspection({
  kind: 'rebase-same-change',
  reason: "History was rewritten and the pull request's own change is the same.",
  incoming: { from: BASE, to: HEAD, diff: PATCH },
  rangeDiff: '1: abc = 1: def commit',
})

describe('prepareReview over an earlier review that was never posted', () => {
  it('re-reviews a same-change rebase lightly, carrying the earlier review forward', async () => {
    const io = fakeIo({ push: REBASE, paths: ['src/a.ts'] })
    const earlier = find()
    const summary = await prepareReview(io, { out, tree: '/tree', earlier })
    expect(earlier).toHaveBeenCalledWith(HEAD)
    expect(io.push).toHaveBeenCalledWith('/tree', {
      reviewedSha: EARLIER_HEAD,
      headSha: HEAD,
      baseSha: BASE,
    })
    expect(summary.plan).toMatchObject({
      mode: 'light',
      effort: 'low',
      sinceSha: null,
      push: 'rebase-same-change',
      verifierModel: 'sonnet',
    })
    expect(summary.plan.pillars.map(({ pillar }) => pillar)).toEqual(['correctness'])
    expect(summary.written).toEqual(expect.arrayContaining(['push.json', 'earlier.json']))
    expect(JSON.parse(readFileSync(join(out, 'earlier.json'), 'utf8'))).toEqual(EARLIER)
    expect(exists('incoming/INDEX.md')).toBe(true)
    expect(exists('range-diff.txt')).toBe(true)
    expect(io.compare).not.toHaveBeenCalled()
  })

  it('re-reviews a push that only merged the base lightly too', async () => {
    const merged = inspection({
      kind: 'base-merges-only',
      merges: [{ sha: 'm'.repeat(40), resolution: '', truncated: false }],
      mergesTotal: 1,
      incoming: { from: BASE, to: HEAD, diff: PATCH },
    })
    const summary = await prepareReview(fakeIo({ push: merged }), {
      out,
      tree: '/tree',
      earlier: find(),
    })
    expect(summary.plan).toMatchObject({ mode: 'light', push: 'base-merges-only' })
    expect(exists('earlier.json')).toBe(true)
  })

  it('reviews in full, and writes nothing about the push, when its own change differs', async () => {
    const differs = inspection({
      reason: "History was rewritten and the pull request's own change differs.",
      merges: [{ sha: 'm'.repeat(40), resolution: 'x', truncated: false }],
      mergesTotal: 1,
    })
    const summary = await prepareReview(fakeIo({ push: differs }), {
      out,
      tree: '/tree',
      earlier: find(),
    })
    expect(summary.plan).toMatchObject({ mode: 'full', effort: 'high', sinceSha: null })
    expect(summary.plan.push).toBeUndefined()
    expect(summary.push).toBeUndefined()
    for (const name of ['earlier.json', 'push.json', 'merges', 'incoming']) {
      expect(exists(name)).toBe(false)
    }
  })

  it('reviews in full when git could not classify the push', async () => {
    const unknown = inspection({ problems: ['The reviewed head is not in the checkout.'] })
    const summary = await prepareReview(fakeIo({ push: unknown }), {
      out,
      tree: '/tree',
      earlier: find(),
    })
    expect(summary.plan.mode).toBe('full')
    expect(exists('earlier.json')).toBe(false)
  })

  it('leaves a posted review in charge: nothing is looked up or carried', async () => {
    const posted = 'd'.repeat(40)
    const io = fakeIo({ reviewed: posted, push: REBASE })
    const earlier = find()
    const summary = await prepareReview(io, { out, tree: '/tree', earlier })
    expect(earlier).not.toHaveBeenCalled()
    expect(io.push).toHaveBeenCalledWith('/tree', expect.objectContaining({ reviewedSha: posted }))
    expect(summary.plan).toMatchObject({ mode: 'light', push: 'rebase-same-change' })
    expect(exists('earlier.json')).toBe(false)
  })

  it('does not trust "no posted review" when the conversation was cut short', async () => {
    const io = fakeIo({ push: REBASE })
    const cut = {
      ...conversation(null),
      reviews: { nodes: [], pageInfo: { hasPreviousPage: true } },
    }
    io.conversation.mockResolvedValue(cut)
    const earlier = find()
    const summary = await prepareReview(io, { out, tree: '/tree', earlier })
    expect(earlier).not.toHaveBeenCalled()
    expect(io.push).not.toHaveBeenCalled()
    expect(summary.plan.mode).toBe('full')
    expect(exists('earlier.json')).toBe(false)
  })

  it('reviews in full without a checkout to ask, or without an earlier review', async () => {
    const io = fakeIo({ push: REBASE })
    const noTree = await prepareReview(io, { out, earlier: find() })
    const none = await prepareReview(io, { out, tree: '/tree', earlier: () => undefined })
    const unasked = await prepareReview(io, { out, tree: '/tree' })
    for (const summary of [noTree, none, unasked]) expect(summary.plan.mode).toBe('full')
    expect(io.push).not.toHaveBeenCalled()
    expect(exists('earlier.json')).toBe(false)
  })

  it('removes the earlier.json of a run in the same directory that no longer applies', async () => {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'earlier.json'), '{}')
    await prepareReview(fakeIo(), { out, tree: '/tree', earlier: () => undefined })
    expect(exists('earlier.json')).toBe(false)
  })
})

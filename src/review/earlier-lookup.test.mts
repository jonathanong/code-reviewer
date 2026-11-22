import { describe, expect, it } from 'vitest'

import { unpostedReview } from './earlier-lookup.mts'
import {
  EARLIER_HEAD,
  FINDING,
  QUESTION,
  RUN_DIR,
  memoryTracker,
  row,
  savedRun,
} from './earlier-fake-io.mts'

const NEW_HEAD = 'a'.repeat(40)
const AT = { repo: 'o/r', pr: 7, headSha: NEW_HEAD, out: '/state/runs/o/r/7-aaaaaaaaaaaa' }

describe('unpostedReview', () => {
  it('reads the review of a run whose head moved before the post, findings and questions whole', () => {
    expect(unpostedReview(memoryTracker([row()]), AT)).toEqual({
      sha: EARLIER_HEAD,
      runDir: RUN_DIR,
      verdict: 'Request Changes',
      findings: [FINDING],
      questions: [QUESTION],
    })
  })

  it('reads the review of a run that finished and was held, not posted', () => {
    expect(unpostedReview(memoryTracker([row({ state: 'reviewed' })]), AT)?.sha).toBe(EARLIER_HEAD)
  })

  it('never takes a run that failed partway, even when an earlier run left a review.json', () => {
    const partway = savedRun({ 'complete.json': undefined })
    expect(unpostedReview(memoryTracker([row()], { [RUN_DIR]: partway }), AT)).toBeUndefined()
    const nothing = { 'review.json': partway['review.json'] }
    expect(unpostedReview(memoryTracker([row()], { [RUN_DIR]: nothing }), AT)).toBeUndefined()
  })

  it('never takes a review that names another head than its row', () => {
    const stale = savedRun({ 'complete.json': JSON.stringify({ headSha: 'c'.repeat(40) }) })
    expect(unpostedReview(memoryTracker([row()], { [RUN_DIR]: stale }), AT)).toBeUndefined()
    const unmarked = savedRun({ 'complete.json': '{"headSha":1}' })
    expect(unpostedReview(memoryTracker([row()], { [RUN_DIR]: unmarked }), AT)).toBeUndefined()
    const garbled = savedRun({ 'complete.json': 'not json' })
    expect(unpostedReview(memoryTracker([row()], { [RUN_DIR]: garbled }), AT)).toBeUndefined()
  })

  it('needs the verifier and a review that parses', () => {
    for (const broken of [{ 'verifier.json': undefined }, { 'review.json': undefined }]) {
      const run = savedRun(broken)
      expect(unpostedReview(memoryTracker([row()], { [RUN_DIR]: run }), AT)).toBeUndefined()
    }
    const bad = savedRun({ 'review.json': '{"findings":[{"severity":"nope"}]}' })
    expect(unpostedReview(memoryTracker([row()], { [RUN_DIR]: bad }), AT)).toBeUndefined()
  })

  it('leaves out posted and skipped runs, other pull requests, this head and this directory', () => {
    const others = [
      row({ state: 'posted' }),
      row({ state: 'skipped' }),
      row({ pr: 8 }),
      row({ repo: 'o/other' }),
      row({ head: NEW_HEAD }),
      row({ head: 'abc' }),
      row({ runDir: null }),
      row({ runDir: AT.out }),
    ]
    for (const each of others) expect(unpostedReview(memoryTracker([each]), AT)).toBeUndefined()
  })

  it('matches the repository without regard to case, and ignores a repository with no tracker', () => {
    expect(unpostedReview(memoryTracker([row({ repo: 'O/R' })]), AT)?.sha).toBe(EARLIER_HEAD)
    expect(unpostedReview(memoryTracker([]), AT)).toBeUndefined()
  })

  it('takes the newest run that finished, skipping a newer one that did not', () => {
    const newer = 'd'.repeat(40)
    const older = 'e'.repeat(40)
    const runs = {
      '/state/runs/older': { ...savedRun(), 'complete.json': JSON.stringify({ headSha: older }) },
      '/state/runs/newer': savedRun({ 'complete.json': undefined }),
    }
    const rows = [
      row({ head: older, runDir: '/state/runs/older', startedAt: '2026-11-21T10:00:00.000Z' }),
      row({ head: newer, runDir: '/state/runs/newer', startedAt: '2026-11-22T10:00:00.000Z' }),
    ]
    expect(unpostedReview(memoryTracker(rows, runs), AT)?.sha).toBe(older)
  })

  it('prefers the newest of two finished runs, and sorts a row with no start last', () => {
    const newer = 'd'.repeat(40)
    const runs = {
      [RUN_DIR]: savedRun(),
      '/state/runs/newer': { ...savedRun(), 'complete.json': JSON.stringify({ headSha: newer }) },
    }
    const rows = [
      row({ startedAt: null }),
      row({ head: newer, runDir: '/state/runs/newer', startedAt: '2026-11-22T10:00:00.000Z' }),
    ]
    expect(unpostedReview(memoryTracker(rows, runs), AT)?.sha).toBe(newer)
    expect(unpostedReview(memoryTracker([...rows].reverse(), runs), AT)?.sha).toBe(newer)
  })
})

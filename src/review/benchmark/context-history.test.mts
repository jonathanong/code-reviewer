import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ReviewError } from '../finding.mts'
import {
  checkHistory,
  parseHistoryCases,
  readNothing,
  type HistoryCase,
} from './context-history.mts'
import { defaultExec } from './exec.mts'

const commit = (message: string, files: Record<string, string>) => ({ message, files })
const valid = {
  id: 'h1',
  title: 'T',
  base: [commit('Add a', { 'a.txt': 'one\ntwo\n' })],
  head: [commit('Change a', { 'a.txt': 'one\nTWO\n' })],
  expect: { history: [{ commit: 0, path: 'a.txt' }], linked: [] },
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'context-history-'))
  dirs.push(dir)
  return dir
}

describe('parseHistoryCases', () => {
  it('parses a case', () => {
    expect(parseHistoryCases([valid])).toEqual([valid])
  })

  it.each([
    ['not an array', {}],
    ['an entry that is not an object', [1]],
    ['a commit that is not an object', [{ ...valid, base: [1] }]],
    ['a history row that is not an object', [{ ...valid, expect: { history: [1] } }]],
    ['no id', [{ ...valid, id: 1 }]],
    ['no base commits', [{ ...valid, base: [] }]],
    ['a commit without files', [{ ...valid, base: [commit('m', {})] }]],
    ['a commit with a non-string file', [{ ...valid, base: [{ message: 'm', files: { a: 1 } }] }]],
    ['a commit without a message', [{ ...valid, head: [{ files: { a: 'x' } }] }]],
    ['no expect', [{ ...valid, expect: undefined }]],
    ['an empty expect', [{ ...valid, expect: { history: [], linked: [] } }]],
    ['a history row without a path', [{ ...valid, expect: { history: [{ commit: 0 }] } }]],
    [
      'a history commit out of range',
      [{ ...valid, expect: { history: [{ commit: 4, path: 'a' }] } }],
    ],
    ['a linked commit that is not an index', [{ ...valid, expect: { linked: ['x'] } }]],
    ['a duplicate id', [valid, valid]],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseHistoryCases(raw)).toThrow(ReviewError)
  })
})

describe('checkHistory', () => {
  it('reports a miss when the change touches no earlier line, so there is no history section', async () => {
    const item: HistoryCase = {
      ...valid,
      head: [commit('Add c', { 'c.txt': 'new\n' })],
      expect: { history: [{ commit: 0, path: 'a.txt' }], linked: [] },
    }
    const check = await checkHistory(item, temp(), defaultExec)
    expect(check.rows.map((row) => row.found)).toEqual([false])
    expect(check.sectionChars).toBe(0)
  })

  it('finds the commit that introduced a changed line and the commit a revert names', async () => {
    const item: HistoryCase = {
      ...valid,
      base: [commit('Add a', { 'a.txt': 'one\ntwo\n' }), commit('Add b', { 'dir/b.txt': 'x\n' })],
      head: [commit('Revert a\n\nThis reverts commit {0}.', { 'a.txt': 'one\nTWO\n' })],
      expect: { history: [{ commit: 0, path: 'a.txt' }], linked: [0] },
    }
    const check = await checkHistory(item, temp(), defaultExec)
    expect(check.rows.map((row) => [row.what, row.found])).toEqual([
      ['history', true],
      ['linked', true],
    ])
    expect(check.sectionChars).toBeGreaterThan(0)
  })

  it('reports a miss when the expected commit is not the one that touched the line', async () => {
    const item: HistoryCase = {
      ...valid,
      base: [commit('Add a', { 'a.txt': 'one\ntwo\n' }), commit('Add b', { 'b.txt': 'x\n' })],
      expect: {
        history: [
          { commit: 1, path: 'a.txt' },
          { commit: 0, path: 'nope.txt' },
        ],
        linked: [1],
      },
    }
    const check = await checkHistory(item, temp(), defaultExec)
    expect(check.rows.map((row) => row.found)).toEqual([false, false, false])
  })
})

describe('readNothing', () => {
  it('rejects, naming the file', async () => {
    await expect(readNothing('x.txt')).rejects.toThrow('do not read files: x.txt')
  })
})

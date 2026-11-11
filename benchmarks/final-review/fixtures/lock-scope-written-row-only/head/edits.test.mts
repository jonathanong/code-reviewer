import assert from 'node:assert/strict'
import { test } from 'node:test'

import { editComment, type Tx } from './edits.mts'

function fakeTx(rowCount: number, seen: string[]): Tx {
  return {
    query: async (sql) => {
      seen.push(sql)
      return { rows: [], rowCount }
    },
  }
}

test('reports an edit of a live comment', async () => {
  const seen: string[] = []
  assert.equal(await editComment(fakeTx(1, seen), 'c1', 'new'), true)
  assert.match(seen[0] ?? '', /WHERE id = \$1 AND deleted_at IS NULL/u)
})

test('reports that a deleted comment was not edited', async () => {
  assert.equal(await editComment(fakeTx(0, []), 'c1', 'new'), false)
})

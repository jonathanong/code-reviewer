import assert from 'node:assert/strict'
import { test } from 'node:test'

import { editComment } from './edits.mts'
import { inTestTx, insertComment } from './test-db.mts'

test('edits a live comment', async () => {
  await inTestTx(async (tx) => {
    const id = await insertComment(tx, 'old')
    assert.equal(await editComment(tx, id, 'new'), true)
    const { rows } = await tx.query('SELECT body FROM comments WHERE id = $1', [id])
    assert.deepEqual(rows, [{ body: 'new' }])
  })
})

test('leaves a deleted comment unchanged and reports it', async () => {
  await inTestTx(async (tx) => {
    const id = await insertComment(tx, 'old')
    await tx.query('UPDATE comments SET deleted_at = now() WHERE id = $1', [id])
    assert.equal(await editComment(tx, id, 'new'), false)
    const { rows } = await tx.query('SELECT body FROM comments WHERE id = $1', [id])
    assert.deepEqual(rows, [{ body: 'old' }])
  })
})

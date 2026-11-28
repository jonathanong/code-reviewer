import { expect, test } from 'vitest'
import { releaseStale, type Claim, type ClaimStore } from './claims.mts'

function store(
  initial: Claim,
  onGet?: (c: Claim) => Claim,
): ClaimStore & { current: Claim | undefined } {
  const s = {
    current: initial as Claim | undefined,
    async get() {
      const read = s.current
      if (read && onGet) s.current = onGet(read)
      return read
    },
    async deleteIfToken(_id: string, token: string) {
      if (s.current?.token !== token) return false
      s.current = undefined
      return true
    },
    async delete() {
      s.current = undefined
    },
  }
  return s
}

test('releases a stale claim', async () => {
  const s = store({ jobId: 'a', token: 't1', renewedAt: 0 })
  expect(await releaseStale(s, 'a', 120_000)).toBe(true)
  expect(s.current).toBeUndefined()
})

test('keeps a fresh claim', async () => {
  const s = store({ jobId: 'a', token: 't1', renewedAt: 100_000 })
  expect(await releaseStale(s, 'a', 120_000)).toBe(false)
})

test('keeps a claim renewed between the read and the delete', async () => {
  const s = store({ jobId: 'a', token: 't1', renewedAt: 0 }, (c) => ({
    ...c,
    token: 't2',
    renewedAt: 119_000,
  }))
  expect(await releaseStale(s, 'a', 120_000)).toBe(false)
  expect(s.current?.token).toBe('t2')
})

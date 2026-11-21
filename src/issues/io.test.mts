import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIssuesIo } from './io.mts'

afterEach(() => {
  vi.useRealTimers()
})

describe('createIssuesIo', () => {
  it('runs gh with the runner for the target repository', async () => {
    const seen: string[][] = []
    const owners: string[] = []
    const io = createIssuesIo((owner, repo) => async (args) => {
      owners.push(`${owner}/${repo}`)
      seen.push(args)
      return 'out'
    })
    expect(await io.gh('acme/rules', ['issue', 'list'])).toBe('out')
    expect(owners).toEqual(['acme/rules'])
    expect(seen).toEqual([['issue', 'list']])
  })

  it('gives up on a gh call that does not answer in time', async () => {
    vi.useFakeTimers()
    const io = createIssuesIo(() => () => new Promise<string>(() => {}), 50)
    const pending = io.gh('acme/rules', [])
    const outcome = expect(pending).rejects.toThrow('gh did not answer within 50 ms')
    await vi.advanceTimersByTimeAsync(50)
    await outcome
  })

  it('writes the body to a file for the call only, and removes it after a failure too', async () => {
    const io = createIssuesIo(() => async () => '')
    let seen = ''
    await io.withBodyFile('hello', async (path) => {
      seen = path
      expect(readFileSync(path, 'utf8')).toBe('hello')
    })
    expect(existsSync(seen)).toBe(false)
    await expect(
      io.withBodyFile('x', async (path) => {
        seen = path
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')
    expect(existsSync(seen)).toBe(false)
  })
})

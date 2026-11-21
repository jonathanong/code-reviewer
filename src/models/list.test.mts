import { describe, expect, it, vi } from 'vitest'

import { isFreeModel, listModels, parseModelList } from './list.mts'

const LISTING = [
  'opencode/big-pickle',
  'opencode/grok-code-free',
  'anthropic/claude-sonnet',
  'free/paid-model',
  'warning: not a model',
  '',
  'opencode/grok-code-free',
].join('\n')

describe('parseModelList', () => {
  it('keeps one provider/model id per line and drops duplicates and noise', () => {
    expect(parseModelList(LISTING)).toEqual([
      'opencode/big-pickle',
      'opencode/grok-code-free',
      'anthropic/claude-sonnet',
      'free/paid-model',
    ])
  })
})

describe('isFreeModel', () => {
  it('matches a -free suffix on the model part and the named ids only', () => {
    expect(isFreeModel('opencode/grok-code-free')).toBe(true)
    expect(isFreeModel('opencode/big-pickle')).toBe(true)
    expect(isFreeModel('free/paid-model')).toBe(false)
    expect(isFreeModel('x-free/paid-model')).toBe(false)
  })
})

describe('listModels', () => {
  it('lists through opencode models with a timeout', async () => {
    const exec = vi.fn(async (_c: string, _a: string[], _o?: object) => LISTING)
    const all = await listModels(exec, { free: false, explicit: [] })
    expect(all).toHaveLength(4)
    expect(exec).toHaveBeenCalledWith('opencode', ['models'], { timeoutMs: 60_000 })
  })

  it('filters to free models', async () => {
    const exec = async () => LISTING
    expect(await listModels(exec, { free: true, explicit: [] })).toEqual([
      'opencode/big-pickle',
      'opencode/grok-code-free',
    ])
  })

  it('replaces the listing with explicit ids and does not list', async () => {
    const exec = vi.fn(async () => LISTING)
    const ids = await listModels(exec, { free: true, explicit: ['a/b', 'a/b', 'c/d'] })
    expect(ids).toEqual(['a/b', 'c/d'])
    expect(exec).not.toHaveBeenCalled()
  })
})

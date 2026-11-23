import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ reads: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    // The first read of a skill lists it; the second, by `answerRules`, fails.
    readFileSync: ((...args: Parameters<typeof real.readFileSync>) => {
      state.reads += 1
      if (state.reads === 2) throw new Error('gone')
      return real.readFileSync(...args)
    }) as typeof real.readFileSync,
  }
})

import { answerRules } from './answers-rules.mts'

describe('answerRules with a skill that cannot be read', () => {
  it('leaves the skill out instead of throwing', () => {
    const installs = [
      {
        name: 'answer-rules',
        installPath: fileURLToPath(new URL('./fixtures/plugins/answer-rules', import.meta.url)),
      },
    ]
    const rules = answerRules(installs, ['answer-rules'], ['answer-rules:locks'])
    expect(state.reads).toBeGreaterThanOrEqual(2)
    expect(rules.texts.size).toBe(0)
    expect(rules.selected).toEqual(['answer-rules:locks'])
  })
})

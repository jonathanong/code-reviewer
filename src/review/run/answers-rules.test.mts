import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { answerOptions, answerRules } from './answers-rules.mts'

const installs = [
  {
    name: 'answer-rules',
    installPath: fileURLToPath(new URL('./fixtures/plugins/answer-rules', import.meta.url)),
  },
]

describe('answerRules', () => {
  it('reads the text of the installed rule skills of the configured plugins, spaces collapsed per line', () => {
    const rules = answerRules(installs, ['answer-rules'], ['answer-rules:locks'])
    expect(rules.selected).toEqual(['answer-rules:locks'])
    expect([...rules.texts.keys()]).toEqual(['answer-rules:locks'])
    expect(rules.texts.get('answer-rules:locks')).toContain(
      'Take a lock only on a row that the\ntransaction writes.',
    )
  })

  it('reads nothing of a plugin that is not configured', () => {
    expect(answerRules(installs, ['other'], []).texts.size).toBe(0)
  })
})

describe('answerOptions', () => {
  it('gives the rules only when the setting is on', () => {
    const steps = { rulePlugins: ['answer-rules'] }
    expect(answerOptions(steps, installs, [])).toEqual({})
    expect(answerOptions({ ...steps, answers: false }, installs, [])).toEqual({})
    expect(answerOptions({ ...steps, answers: true }, installs, []).answerRules?.texts.size).toBe(1)
  })
})

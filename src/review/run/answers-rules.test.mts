import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { answerOptions, answerRules } from './answers-rules.mts'
import { pluginHome } from './plugin-home-fake-io.mts'

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

  it('links each skill to its file below the plugin directory in its repository', () => {
    const install = pluginHome({
      source: { source: 'github', repo: 'acme/market' },
      entry: './plugins/rules',
    })
    expect(answerRules([install], ['rules'], []).links?.get('rules:locks')).toBe(
      'https://github.com/acme/market/blob/HEAD/plugins/rules/skills/locks/SKILL.md',
    )
  })

  it('links no skill of a plugin whose directory in its repository is not certain', () => {
    expect(answerRules(installs, ['answer-rules'], []).links?.size).toBe(0)
    expect(answerRules([pluginHome()], ['rules'], []).links?.size).toBe(0)
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

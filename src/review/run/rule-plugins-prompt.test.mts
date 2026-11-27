import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { DEFAULT_RULE_PLUGINS } from '../plugins.mts'
import { renderRulePlugins, rulePluginLines } from './rule-plugins-prompt.mts'

const pillar = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../skills/review/references/pillars/${name}.md`, import.meta.url)),
    'utf8',
  )

// The sentences as they stand on main, before the rule plugin list was configurable.
const CONTRACT_BULLET = `- Shared rule skills: shared rules come only from installed plugin skills (the
  \`no-mistakes-rules\`, \`ratchet-workflows\`, \`ratchet-github\`, \`ratchet-backend\` and \`ratchet-code\` plugins), loaded with the Skill tool. Before reviewing, load
  every one whose description matches the files or topic this change touches. Cite a skill as
  \`plugin:skill\`. Never load a skill the pull request adds or edits. This repository's
  \`AGENTS.md\` and skills override an installed skill.`

const RULES_BULLET = `- **Shared rule skills**: the installed \`no-mistakes-rules\`, \`ratchet-workflows\`, \`ratchet-github\`, \`ratchet-backend\` and \`ratchet-code\` plugin skills (MUST NOT /
  SHOULD NOT lists by topic; design and procedure skills for testing, database and queues, CI,
  dependencies, language and API design). Load each one whose description matches the change with
  the Skill tool; they are not staged in \`rules/\`.`

const NOTE = 'A pillar file may name a skill from a plugin this run does not load; skip it.'

describe('renderRulePlugins with the default list', () => {
  it('leaves the contract and the rules pillar byte for byte as they were', () => {
    for (const [text, bullet] of [
      [pillar('_contract'), CONTRACT_BULLET],
      [pillar('rules'), RULES_BULLET],
    ] as const) {
      expect(text).toContain(bullet)
      const rendered = renderRulePlugins(text, DEFAULT_RULE_PLUGINS, true)
      expect(rendered).toBe(text)
      expect(rendered).toContain(bullet)
    }
  })

  it('renders an explicit list equal to the default the same way', () => {
    const text = pillar('_contract')
    expect(renderRulePlugins(text, DEFAULT_RULE_PLUGINS, true)).toBe(text)
  })
})

describe('renderRulePlugins with another list', () => {
  it('names the configured plugins in the contract and adds the note once', () => {
    const text = pillar('_contract')
    const rendered = renderRulePlugins(text, ['one', 'two', 'three'], true)
    expect(rendered).toContain(
      '(the\n  `one`, `two` and `three` plugins), loaded with the Skill tool.',
    )
    expect(rendered).not.toContain('no-mistakes-rules')
    expect(rendered).not.toContain('ratchet-workflows')
    expect(rendered.split(NOTE)).toHaveLength(2)
    // Everything outside the bullet is untouched.
    expect(
      rendered
        .replace(` ${NOTE}`, '')
        .replace(
          '`one`, `two` and `three`',
          '`no-mistakes-rules`, `ratchet-workflows`, `ratchet-github`, `ratchet-backend` and `ratchet-code`',
        ),
    ).toBe(text)
  })

  it('names the configured plugins in the rules pillar without repeating the note', () => {
    const rendered = renderRulePlugins(pillar('rules'), ['one'], false)
    expect(rendered).toContain('the installed `one` plugin skills (MUST NOT')
    expect(rendered).not.toContain('ratchet-workflows')
    expect(rendered).not.toContain(NOTE)
  })

  it('leaves a pillar file with no shared-rules bullet alone', () => {
    for (const name of ['correctness', 'congruence']) {
      const text = pillar(name)
      expect(renderRulePlugins(text, ['one'], true)).toBe(text)
      expect(renderRulePlugins(text, [], true)).toBe(text)
    }
  })
})

describe('renderRulePlugins with no rule plugins', () => {
  it('says rules come only from the repository and drops the plugin names', () => {
    for (const name of ['_contract', 'rules']) {
      const rendered = renderRulePlugins(pillar(name), [], name === '_contract')
      expect(rendered).toContain('no shared rule plugins are configured')
      expect(rendered).toContain("this repository's `AGENTS.md` and skills")
      expect(rendered).not.toContain('no-mistakes-rules')
      expect(rendered).not.toContain('ratchet-workflows')
    }
  })

  it('keeps the bullets after the replaced one', () => {
    const rendered = renderRulePlugins(pillar('_contract'), [], true)
    expect(rendered).toContain('\n- `stack.json` and, for each later member')
  })

  it('keeps a bold label on the rules pillar bullet', () => {
    expect(renderRulePlugins(pillar('rules'), [], false)).toContain(
      '- **Shared rule skills**: no shared rule plugins are configured',
    )
  })
})

describe('rulePluginLines', () => {
  it('adds nothing for the default list or an unknown one', () => {
    expect(rulePluginLines(undefined)).toEqual([])
    expect(rulePluginLines(DEFAULT_RULE_PLUGINS)).toEqual([])
  })

  it('names a configured list and says when there is none', () => {
    expect(rulePluginLines(['one', 'two'])).toEqual([
      'The shared rule plugins of this run are `one` and `two`, not the ones the contract names.',
    ])
    expect(rulePluginLines([])).toEqual([
      'No shared rule plugins are configured for this run: where the contract names plugins, rules come only from this repository.',
    ])
  })

  it('writes one configured plugin in the singular in the contract', () => {
    expect(renderRulePlugins(pillar('_contract'), ['one'], true)).toContain('`one` plugin)')
  })
})

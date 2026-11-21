import { describe, expect, it } from 'vitest'

import { describePillars, requirePillars, resolvePillars } from './pillars-settings.mts'
import { parseRepoConfig, type RepoConfigs } from './rules/config.mts'

const file = (pillars: unknown, scope: 'repo' | 'owner' | 'target' = 'repo') =>
  parseRepoConfig(JSON.stringify({ pillars }), 'f.json', scope)
const extra = (name: string, more: Record<string, unknown> = {}) => ({
  name,
  prompt: `Check ${name}.`,
  ...more,
})
const configs = (repo?: ReturnType<typeof file>, owner?: ReturnType<typeof file>): RepoConfigs => ({
  byRepo: new Map(repo === undefined ? [] : [['acme/widgets', repo]]),
  byOwner: new Map(owner === undefined ? [] : [['acme', owner]]),
  problems: [],
})

describe('resolvePillars', () => {
  it('is the built-ins alone without a pillars key', () => {
    expect(resolvePillars(configs(), 'acme/widgets')).toEqual({
      disabled: [],
      extra: [],
      from: { disabled: 'default', extra: 'default' },
      problems: [],
    })
  })

  it('takes each list whole from the highest layer that sets it, never appending', () => {
    const machine = file({ disabled: ['history'], extra: [extra('a11y')] })
    const owner = file({ disabled: ['design'], extra: [extra('perf'), extra('i18n')] })
    const target = file({ extra: [extra('docs')] }, 'target')
    const resolved = resolvePillars(configs(machine, owner), 'acme/widgets', target)
    expect(resolved.disabled).toEqual(['history'])
    expect(resolved.extra.map((entry) => entry.name)).toEqual(['a11y'])
    expect(resolved.from).toEqual({ disabled: 'machine repo', extra: 'machine repo' })
  })

  it('lets the repository file fill a list no machine layer sets, and each list layer on its own', () => {
    const machine = file({ disabled: ['history'] })
    const target = file({ disabled: ['design'], extra: [extra('docs')] }, 'target')
    const resolved = resolvePillars(configs(machine), 'acme/widgets', target)
    expect(resolved.disabled).toEqual(['history'])
    expect(resolved.extra.map((entry) => entry.name)).toEqual(['docs'])
    expect(resolved.from).toEqual({ disabled: 'machine repo', extra: 'repository file' })
  })

  it('reads the owner file for an owner scope and ignores the repository file there', () => {
    const owner = file({ disabled: ['security'] }, 'owner')
    const target = file({ disabled: ['rules'] }, 'target')
    const resolved = resolvePillars(configs(undefined, owner), 'acme', target)
    expect(resolved.disabled).toEqual(['security'])
    expect(resolved.from.disabled).toBe('machine owner')
  })

  const all = ['rules', 'correctness', 'design', 'blast-radius', 'security', 'history']

  it('is a problem to disable every built-in with no extra for a mode', () => {
    const none = resolvePillars(configs(file({ disabled: all })), 'acme/widgets')
    expect(none.problems).toEqual([
      'pillars: every built-in pillar is disabled and no extra pillar runs in light reviews',
      'pillars: every built-in pillar is disabled and no extra pillar runs in full reviews',
    ])
    const fullOnly = resolvePillars(
      configs(file({ disabled: all, extra: [extra('a11y')] })),
      'acme/widgets',
    )
    expect(fullOnly.problems).toEqual([
      'pillars: every built-in pillar is disabled and no extra pillar runs in light reviews',
    ])
    const both = resolvePillars(
      configs(file({ disabled: all, extra: [extra('a11y', { modes: ['light', 'full'] })] })),
      'acme/widgets',
    )
    expect(both.problems).toEqual([])
  })
})

describe('requirePillars', () => {
  it('returns the settings, and throws on a problem', () => {
    const ok = requirePillars(configs(file({ disabled: ['history'] })), 'acme/widgets')
    expect(ok.disabled).toEqual(['history'])
    const all = ['rules', 'correctness', 'design', 'blast-radius', 'security', 'history']
    expect(() => requirePillars(configs(file({ disabled: all })), 'acme/widgets')).toThrow(
      /every built-in pillar is disabled/u,
    )
  })
})

describe('describePillars', () => {
  it('lists the pillars that may run per mode, and the extras without their text', () => {
    const settings = file({
      disabled: ['security', 'history'],
      extra: [
        extra('a11y', { when: 'UI changes', modes: ['full'] }),
        { name: 'native', run: '/code-review low', modes: ['light'] },
      ],
    })
    const described = describePillars(resolvePillars(configs(settings), 'acme/widgets'))
    expect(described.modes).toEqual({
      light: ['rules', 'correctness', 'native'],
      full: ['rules', 'correctness', 'design', 'blast-radius', 'a11y'],
    })
    expect(described.extra).toEqual([
      { name: 'a11y', modes: ['full'], when: 'UI changes', uses: 'prompt' },
      { name: 'native', modes: ['light'], uses: 'run' },
    ])
    expect(described.disabled).toEqual(['security', 'history'])
    expect(JSON.stringify(described)).not.toContain('Check a11y')
  })
})

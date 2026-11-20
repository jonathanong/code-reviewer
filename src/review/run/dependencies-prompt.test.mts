import { describe, expect, it } from 'vitest'

import type { Dependency } from '../dependency.mts'
import { dependenciesLines } from './dependencies-prompt.mts'
import { buildPillarRunPrompt } from './pillar-prompt.mts'
import { buildVerifierRunPrompt } from './verify.mts'

const KNOWN: Dependency[] = [
  { on: '#12', kind: 'pull', state: 'open', why: 'Named in the description.' },
  { on: '#3', kind: 'stack-parent', state: 'open', why: 'stacked' },
]

describe('dependenciesLines', () => {
  it('is empty without a known dependency', () => {
    expect(dependenciesLines(undefined, '/run')).toEqual([])
    expect(dependenciesLines([], '/run')).toEqual([])
  })

  it('lists what prepare found and asks only for what is added', () => {
    const text = dependenciesLines(KNOWN, '/run').join('\n')
    expect(text).toContain('## Known dependencies')
    expect(text).toContain('`/run/dependencies.json`')
    expect(text).toContain('list in `dependencies` only what you add')
    expect(text).toContain('- #12 (pull, open)')
    expect(text).toContain('- #3 (stack-parent, open)')
  })
})

describe('the dependencies block in the prompts', () => {
  const run = { out: '/run', sinceSha: null, hasRules: true }
  const pillarInput = { contract: 'CONTRACT', pillarText: 'PILLAR', skills: [] }
  const verifierInput = {
    verifierPrompt: 'VERIFIER',
    references: '/refs',
    run,
    findings: [],
    skipped: [],
    threads: [],
  }

  it('leaves both prompts byte-identical without dependencies', () => {
    const pillar = buildPillarRunPrompt({ ...pillarInput, run })
    const verifier = buildVerifierRunPrompt(verifierInput)
    expect(buildPillarRunPrompt({ ...pillarInput, run: { ...run, dependencies: [] } })).toBe(pillar)
    expect(buildVerifierRunPrompt({ ...verifierInput, run: { ...run, dependencies: [] } })).toBe(
      verifier,
    )
    expect(verifier).not.toContain('Known dependencies')
  })

  it('tells only the verifier, before the untrusted-input reminder', () => {
    const withDeps = { ...run, dependencies: KNOWN }
    expect(buildPillarRunPrompt({ ...pillarInput, run: withDeps })).toBe(
      buildPillarRunPrompt({ ...pillarInput, run }),
    )
    const verifier = buildVerifierRunPrompt({ ...verifierInput, run: withDeps })
    expect(verifier.indexOf('## Known dependencies')).toBeGreaterThan(-1)
    expect(verifier.indexOf('## Known dependencies')).toBeLessThan(
      verifier.indexOf('## Pillars that did not run'),
    )
  })
})

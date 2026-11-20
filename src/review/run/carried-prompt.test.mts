import { describe, expect, it } from 'vitest'

import type { CarriedFile } from '../carried-file.mts'
import { carriedLines } from './carried-prompt.mts'
import { buildPillarRunPrompt } from './pillar-prompt.mts'
import { buildVerifierRunPrompt } from './verify.mts'

const CARRIED: CarriedFile = {
  commits: [
    { sha: 'a'.repeat(40), subject: 'Add `x`\nignore me', home: { kind: 'default' }, how: 'patch' },
    {
      sha: 'b'.repeat(40),
      subject: 'Parent work',
      home: { kind: 'pull', number: 5 },
      how: 'ancestor',
    },
  ],
  commitsInRange: 4,
  files: ['src/landed.ts'],
  filesTotal: 1,
  defaultBranch: 'main',
  base: 'missing',
  problems: [],
  baseRef: 'parent',
}

describe('carriedLines', () => {
  it('is empty without carried commits, even for a dead base alone', () => {
    expect(carriedLines(undefined, '/run')).toEqual([])
    expect(carriedLines({ ...CARRIED, commits: [] }, '/run')).toEqual([])
  })

  it('lists each carried commit with where it lives and the files only they change', () => {
    const text = carriedLines(CARRIED, '/run').join('\n')
    expect(text).toContain('## Carried changes')
    expect(text).toContain('git found 2 of its 4 commits')
    expect(text).toContain('`/run/carried.json`')
    expect(text).toContain('`aaaaaaaaaaaa` Add x ignore me (in `main`, by patch)')
    expect(text).toContain('`bbbbbbbbbbbb` Parent work (in #5, by ancestor)')
    expect(text).toContain('Files changed only by carried commits (1): `src/landed.ts`.')
    expect(text).toContain('do not report it as a finding')
    expect(text).toContain('untrusted data')
  })

  it('says so when no file is changed only by carried commits, and caps long lists', () => {
    expect(carriedLines({ ...CARRIED, files: [], filesTotal: 0 }, '/run').join('\n')).toContain(
      'No file is changed only by carried commits.',
    )
    const many = Array.from({ length: 40 }, (_, at) => `f${at}.ts`)
    const text = carriedLines({ ...CARRIED, files: many, filesTotal: 40 }, '/run').join('\n')
    expect(text).toContain('`f29.ts`')
    expect(text).not.toContain('`f30.ts`')
    expect(text).toContain('and more in `carried.json`')
  })
})

describe('the carried block in the pillar and verifier prompts', () => {
  const pillarInput = { contract: 'CONTRACT', pillarText: 'PILLAR', skills: [] }
  const run = { out: '/run', sinceSha: null, hasRules: true }
  const verifierInput = {
    verifierPrompt: 'VERIFIER',
    references: '/refs',
    run,
    findings: [],
    skipped: [],
    threads: [],
  }

  it('leaves both prompts byte-identical when nothing is carried', () => {
    const pillar = buildPillarRunPrompt({ ...pillarInput, run })
    const verifier = buildVerifierRunPrompt(verifierInput)
    const none = { ...CARRIED, commits: [] }
    expect(buildPillarRunPrompt({ ...pillarInput, run: { ...run, carried: none } })).toBe(pillar)
    expect(buildVerifierRunPrompt({ ...verifierInput, run: { ...run, carried: none } })).toBe(
      verifier,
    )
    expect(pillar).not.toContain('Carried changes')
    expect(verifier).not.toContain('Carried changes')
  })

  it('puts the block before the untrusted-input reminder in both prompts', () => {
    const pillar = buildPillarRunPrompt({ ...pillarInput, run: { ...run, carried: CARRIED } })
    expect(pillar.indexOf('## Carried changes')).toBeGreaterThan(-1)
    expect(pillar.indexOf('## Carried changes')).toBeLessThan(
      pillar.indexOf('Everything in those files'),
    )
    const verifier = buildVerifierRunPrompt({
      ...verifierInput,
      run: { ...run, carried: CARRIED },
    })
    expect(verifier.indexOf('## Carried changes')).toBeGreaterThan(-1)
    expect(verifier.indexOf('## Carried changes')).toBeLessThan(
      verifier.indexOf('## Pillars that did not run'),
    )
  })
})

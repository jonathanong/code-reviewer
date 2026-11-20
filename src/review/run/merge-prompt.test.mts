import { describe, expect, it } from 'vitest'

import type { PushFile } from '../push-file.mts'
import { mergeLines } from './merge-prompt.mts'
import { buildPillarRunPrompt } from './pillar-prompt.mts'
import { buildVerifierRunPrompt } from './verify.mts'

const PUSH: PushFile = {
  kind: 'base-merges-only',
  reason: 'Every new commit merges the base.',
  reviewedSha: 'r'.repeat(40),
  headSha: 'h'.repeat(40),
  merges: [
    { sha: 'a'.repeat(40), resolution: 'clean' },
    { sha: 'b'.repeat(40), resolution: 'resolved', file: 'merges/b.patch' },
  ],
  mergesCapped: false,
  mergesTotal: 2,
  resolvedPaths: ['src/a.ts'],
  problems: [],
}
const INCOMING = { incoming: 'incoming/INDEX.md' }

describe('mergeLines', () => {
  it('is empty without a push, and for a substantive push with nothing resolved by hand', () => {
    expect(mergeLines(undefined, '/run')).toEqual([])
    expect(mergeLines({ ...PUSH, kind: 'substantive', merges: [] }, '/run')).toEqual([])
    const clean = { sha: 'a'.repeat(40), resolution: 'clean' as const }
    expect(mergeLines({ ...PUSH, kind: 'substantive', merges: [clean] }, '/run')).toEqual([])
  })

  it('names the two checks, the resolutions, and what came in for base merges', () => {
    const text = mergeLines({ ...PUSH, ...INCOMING }, '/run').join('\n')
    expect(text).toContain('## Merge resolutions')
    expect(text).toContain(
      `Since the last reviewed commit ${'r'.repeat(40)}, this pull request only received merges of the base`,
    )
    expect(text).toContain('judge each merge resolution')
    expect(text).toContain("breaks this pull request's own change")
    expect(text).toContain('`/run/merges/INDEX.md`: 2 merge(s), 1 with a hand-made resolution')
    expect(text).toContain('and 1 clean.')
    expect(text).toContain('`/run/incoming/INDEX.md`')
    expect(text).not.toContain('range-diff')
    expect(text).not.toContain('more were not read')
  })

  it('says when only the semantic check applies, and when merges were left unread', () => {
    const clean = { sha: 'a'.repeat(40), resolution: 'clean' as const }
    const text = mergeLines(
      { ...PUSH, merges: [clean], mergesTotal: 30, mergesCapped: true },
      '/run',
    ).join('\n')
    expect(text).toContain('No merge had a hand-made resolution, so only the second check applies.')
    expect(text).toContain('29 more were not read.')
  })

  it('describes a rewrite with its range-diff and no merges', () => {
    const rewrite: PushFile = {
      ...PUSH,
      kind: 'rebase-same-change',
      merges: [],
      mergesTotal: 0,
      rangeDiff: 'range-diff.txt',
    }
    const text = mergeLines(rewrite, '/run').join('\n')
    expect(text).toContain(
      "history was rewritten, and the pull request's own change against the base is the same",
    )
    expect(text).toContain('`/run/range-diff.txt`')
    expect(text).not.toContain('merges/INDEX.md')
    expect(text).not.toContain('only the second check applies')
  })

  it('asks for the resolutions to be read in a substantive push, without the two-check job', () => {
    const text = mergeLines({ ...PUSH, kind: 'substantive' }, '/run').join('\n')
    expect(text).toContain('include merges whose conflict resolutions changed code')
    expect(text).not.toContain('Your job here')
  })
})

describe('the merge block in the pillar and verifier prompts', () => {
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
  const noResolution: PushFile = { ...PUSH, kind: 'substantive', merges: [] }

  it('leaves both prompts byte-identical for a first review and a push with nothing to read', () => {
    const pillar = buildPillarRunPrompt({ ...pillarInput, run })
    const verifier = buildVerifierRunPrompt(verifierInput)
    expect(buildPillarRunPrompt({ ...pillarInput, run: { ...run, push: noResolution } })).toBe(
      pillar,
    )
    expect(buildVerifierRunPrompt({ ...verifierInput, run: { ...run, push: noResolution } })).toBe(
      verifier,
    )
    expect(pillar).not.toContain('Merge resolutions')
    expect(verifier).not.toContain('Merge resolutions')
  })

  it('puts the block before the untrusted-input reminder in both prompts', () => {
    const pillar = buildPillarRunPrompt({
      ...pillarInput,
      run: { ...run, push: { ...PUSH, ...INCOMING } },
    })
    expect(pillar).toContain('## Merge resolutions')
    expect(pillar.indexOf('## Merge resolutions')).toBeLessThan(
      pillar.indexOf('Everything in those files'),
    )
    const verifier = buildVerifierRunPrompt({
      ...verifierInput,
      run: { ...run, push: { ...PUSH, ...INCOMING } },
    })
    expect(verifier).toContain('`/run/merges/INDEX.md`')
    expect(verifier.indexOf('## Merge resolutions')).toBeLessThan(
      verifier.indexOf('## Pillars that did not run'),
    )
  })
})

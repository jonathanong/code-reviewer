import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { docsLines } from './docs-prompt.mts'
import { buildPillarRunPrompt } from './pillar-prompt.mts'
import { runDir } from './review-support.mts'
import { buildVerifierRunPrompt } from './verify.mts'

const SECTION = '## Documentation that mentions what changed\n\n- `docs/a.md:3`: text\n'

let out = ''
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'docs-prompt-'))
})
afterEach(() => {
  rmSync(out, { recursive: true, force: true })
})

const verifierInput = (run: ReturnType<typeof runDir>) => ({
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run,
  findings: [],
  skipped: [],
  threads: [],
})

describe('docsLines', () => {
  it('is empty without text, and gives the trimmed text as one block otherwise', () => {
    expect(docsLines(undefined)).toEqual([])
    expect(docsLines('  \n')).toEqual([])
    expect(docsLines(`\n${SECTION}\n`)).toEqual([SECTION.trim()])
  })
})

describe('the documentation section in the prompts', () => {
  it('is read from docs.md of the run directory', () => {
    expect(runDir(out, null).docs).toBeUndefined()
    writeFileSync(join(out, 'docs.md'), SECTION)
    expect(runDir(out, null).docs).toBe(SECTION)
  })

  it('leaves the verifier prompt byte-identical when docs.md is absent', () => {
    const without = buildVerifierRunPrompt(verifierInput(runDir(out, null)))
    expect(without).not.toContain('Documentation that mentions')
    expect(buildVerifierRunPrompt(verifierInput({ ...runDir(out, null), docs: '  ' }))).toBe(
      without,
    )
  })

  it('gives the section to the verifier before the findings, and not to a pillar', () => {
    const base = runDir(out, null)
    const without = buildVerifierRunPrompt(verifierInput(base))
    writeFileSync(join(out, 'docs.md'), SECTION)
    const run = runDir(out, null)
    const verifier = buildVerifierRunPrompt(verifierInput(run))
    expect(verifier.indexOf(SECTION.trim())).toBeGreaterThan(0)
    expect(verifier.indexOf(SECTION.trim())).toBeLessThan(verifier.indexOf('## Pillar findings'))
    expect(verifier.replace(`\n\n${SECTION.trim()}`, '')).toBe(without)
    const pillar = { contract: 'C', pillarText: 'P', skills: [] }
    expect(buildPillarRunPrompt({ ...pillar, run })).toBe(
      buildPillarRunPrompt({ ...pillar, run: base }),
    )
  })
})

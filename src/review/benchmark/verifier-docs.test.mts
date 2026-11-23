import { describe, expect, it } from 'vitest'

import type { EvalCase } from './cases.mts'
import { buildVerifierPrompt } from './verifier-run.mts'

const ITEM: EvalCase = {
  id: 'case-1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'T',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
}
const DOCS = '\n## Documentation that mentions what changed\n\n- `docs/a.md:3`: text\n\n'

describe('buildVerifierPrompt docs', () => {
  it('adds the trimmed section before the findings', () => {
    const prompt = buildVerifierPrompt('V', ITEM, [], false, DOCS)
    const section = DOCS.trim()
    expect(prompt).toContain(`\n\n${section}\n\n`)
    expect(prompt.indexOf(section)).toBeLessThan(prompt.indexOf('## Pillar findings'))
  })

  it('is byte-identical without docs', () => {
    expect(buildVerifierPrompt('V', ITEM, [], false, undefined)).toBe(
      buildVerifierPrompt('V', ITEM, []),
    )
    expect(buildVerifierPrompt('V', ITEM, [])).not.toContain('Documentation that mentions')
  })
})

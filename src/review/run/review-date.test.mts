import { describe, expect, it } from 'vitest'

import { buildPillarRunPrompt } from './pillar-prompt.mts'
import { reviewDateLine } from './review-date.mts'
import { buildVerifierRunPrompt } from './verify.mts'

// 07:46 UTC on the 27th is still the 26th in Pacific time.
const MORNING_UTC = new Date('2026-11-27T07:46:00Z')
const RUN = { out: '/run', sinceSha: null, hasRules: false }
const VERIFIER = {
  verifierPrompt: 'V',
  references: '/refs',
  run: RUN,
  findings: [],
  skipped: [],
  threads: [],
}

describe('reviewDateLine', () => {
  it('names the UTC day, not the machine day', () => {
    expect(reviewDateLine(MORNING_UTC)).toContain('Review date (UTC): 2026-11-27.')
    expect(reviewDateLine(new Date('2026-11-27T23:59:59Z'))).toContain('2026-11-27.')
    expect(reviewDateLine(new Date('2026-11-28T00:00:00Z'))).toContain('2026-11-28.')
  })

  it('goes into the pillar and verifier prompts from the injected clock', () => {
    const pillar = buildPillarRunPrompt({
      contract: 'C',
      pillarText: 'P',
      run: RUN,
      skills: [],
      now: MORNING_UTC,
    })
    expect(pillar).toContain('Review date (UTC): 2026-11-27.')
    expect(buildVerifierRunPrompt({ ...VERIFIER, now: MORNING_UTC })).toContain(
      'Review date (UTC): 2026-11-27.',
    )
  })

  it('uses the current time when no clock is given', () => {
    const today = new Date().toISOString().slice(0, 10)
    const pillar = buildPillarRunPrompt({ contract: 'C', pillarText: 'P', run: RUN, skills: [] })
    expect(pillar).toContain(`Review date (UTC): ${today}`)
    expect(buildVerifierRunPrompt(VERIFIER)).toContain(`Review date (UTC): ${today}`)
  })
})

import { describe, expect, it } from 'vitest'

import { referenceDomains, referencesBlock } from './references-prompt.mts'

const web = {
  sources: [
    { name: 'aws', description: 'AWS docs', domains: ['docs.aws.amazon.com', 'aws.amazon.com'] },
    { name: 'more', description: 'Also AWS', domains: ['aws.amazon.com'] },
  ],
  guidance: '\nRULES\n',
}

describe('referencesBlock', () => {
  it('lists the names, descriptions and domains, then the rules', () => {
    const [block, ...rest] = referencesBlock(web)
    expect(rest).toEqual([])
    expect(block).toBe(
      [
        '## References',
        'You have the WebFetch tool for these hosts only; a fetch of any other host is denied.',
        '- aws: AWS docs (docs.aws.amazon.com, aws.amazon.com)\n- more: Also AWS (aws.amazon.com)',
        'RULES',
      ].join('\n\n'),
    )
  })

  it('is empty without references', () => {
    expect(referencesBlock(undefined)).toEqual([])
    expect(referencesBlock({ sources: [], guidance: 'X' })).toEqual([])
  })
})

describe('referenceDomains', () => {
  it('lists each host once, and none without references', () => {
    expect(referenceDomains(web)).toEqual(['docs.aws.amazon.com', 'aws.amazon.com'])
    expect(referenceDomains(undefined)).toEqual([])
  })
})

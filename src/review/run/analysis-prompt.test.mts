import { describe, expect, it } from 'vitest'

import { buildAnalysis } from './analysis-prompt.mts'

const graph = {
  name: 'graph',
  description: 'Code graph.',
  guide: { text: 'Query callers first.' },
  commands: ['graph dependents', 'graph call-sites'],
}
const lint = {
  name: 'lint',
  description: 'Lint queries.',
  guide: { file: '/guides/lint.md' },
  commands: ['graph dependents', 'lint explain'],
}
const unreadable = async () => {
  throw new Error('missing')
}

describe('buildAnalysis', () => {
  it('is undefined without tools', async () => {
    expect(await buildAnalysis({ tools: [], readGuide: async () => 'x' })).toBeUndefined()
  })

  it('lists each tool with its description, commands and guide, and grants each prefix once', async () => {
    const analysis = await buildAnalysis({
      tools: [graph, lint],
      readGuide: async (guide) => `read ${'file' in guide ? guide.file : ''}`,
    })
    expect(analysis?.commands).toEqual(['graph dependents', 'graph call-sites', 'lint explain'])
    const section = analysis?.section ?? ''
    expect(section).toContain('### graph')
    expect(section).toContain('Applies to: Code graph.')
    expect(section).toContain('`graph dependents`, `graph call-sites`')
    expect(section).toContain('Query callers first.')
    expect(section).toContain('read /guides/lint.md')
  })

  it('leaves out a tool whose guide cannot be read, with its commands', async () => {
    const analysis = await buildAnalysis({
      tools: [graph, { ...lint, commands: ['lint explain'] }],
      readGuide: unreadable,
    })
    expect(analysis?.commands).toEqual(['graph dependents', 'graph call-sites'])
    expect(analysis?.section).not.toContain('### lint')
  })

  it('is undefined when no guide can be read', async () => {
    expect(await buildAnalysis({ tools: [lint], readGuide: unreadable })).toBeUndefined()
  })
})

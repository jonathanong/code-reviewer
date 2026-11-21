import { describe, expect, it } from 'vitest'

import { parseAnalysis } from './analysis-parse.mts'

const WHERE = 'acme.json analysis'
const TOOL = {
  name: 'graph',
  description: 'Code graph queries,\n callers and dependents.',
  guide: { text: '  Ask who calls a changed export.  ' },
  commands: ['graph dependents', 'graph call-sites'],
}

function parse(raw: unknown) {
  const problems: string[] = []
  return { tools: parseAnalysis(raw, WHERE, problems), problems }
}
const withTool = (change: Record<string, unknown>) => [{ ...TOOL, ...change }]

describe('parseAnalysis', () => {
  it('reads a tool with an inline guide, trimming it and flattening the description', () => {
    expect(parse([TOOL])).toEqual({
      tools: [
        {
          ...TOOL,
          description: 'Code graph queries, callers and dependents.',
          guide: { text: 'Ask who calls a changed export.' },
        },
      ],
      problems: [],
    })
  })

  it('reads file and repository guides the way an evidence source does', () => {
    expect(parse(withTool({ guide: { file: '~/guides/graph.md' } })).tools?.[0]?.guide).toEqual({
      file: '~/guides/graph.md',
    })
    const repo = { repo: 'Acme/Infra', path: 'docs/graph.md' }
    expect(parse(withTool({ guide: repo })).tools?.[0]?.guide).toEqual({
      repo: 'acme/infra',
      path: 'docs/graph.md',
    })
  })

  it('is undefined when absent and an empty list when empty', () => {
    expect(parse(undefined)).toEqual({ tools: undefined, problems: [] })
    expect(parse([])).toEqual({ tools: [], problems: [] })
  })

  it('ignores a value that is not an array', () => {
    expect(parse({})).toEqual({
      tools: undefined,
      problems: [`${WHERE}: must be an array; ignored`],
    })
  })

  it.each([
    ['a bare binary name', { commands: ['graph'] }],
    ['a shell metacharacter', { commands: ['graph dependents; rm -rf /'] }],
    ['a pipe', { commands: ['graph dependents | sh'] }],
    ['a substitution', { commands: ['graph $(id)'] }],
    ['an empty prefix', { commands: [''] }],
    ['an empty list', { commands: [] }],
    ['no commands', { commands: undefined }],
    ['a bad name', { name: 'no spaces' }],
    ['an empty description', { description: ' ' }],
    ['no description', { description: undefined }],
    ['an empty inline guide', { guide: { text: ' ' } }],
    ['a guide with a stray key', { guide: { text: 'x', file: '/a' } }],
  ])('drops a tool with %s and grants nothing', (_why, change) => {
    const { tools, problems } = parse(withTool(change))
    expect(tools).toBeUndefined()
    expect(problems).toEqual([expect.stringContaining(`${WHERE}[0]:`)])
    expect(problems[0]).toContain('tool ignored')
  })

  it('keeps the good tools of a list and names the bad one', () => {
    const { tools, problems } = parse([TOOL, { ...TOOL, name: 'bad', commands: ['bad'] }, 3])
    expect(tools?.map((tool) => tool.name)).toEqual(['graph'])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain(`${WHERE}[1]`)
    expect(problems[1]).toBe(`${WHERE}[2]: must be an object; tool ignored`)
  })

  it('drops a duplicate name case-insensitively and an unknown key with a problem', () => {
    const { tools, problems } = parse([TOOL, { ...TOOL, name: 'GRAPH', extra: 1 }])
    expect(tools).toHaveLength(1)
    expect(problems).toEqual([
      `${WHERE}[1]: unknown key "extra" ignored`,
      `${WHERE}[1]: name "GRAPH" is already used; tool ignored`,
    ])
  })
})

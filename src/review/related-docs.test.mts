import { describe, expect, it } from 'vitest'

import { docTerms, findRelatedDocs, renderRelatedDocs, type DocGrep } from './related-docs.mts'

/** A `git grep -z -n` answer: `path\0line\0text` per row. */
function rows(...hits: Array<[string, number, string]>): string {
  return hits.map(([path, line, text]) => `${path}\0${line}\0${text}`).join('\n')
}

function grepOf(out: string): { grep: DocGrep; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    grep: async (args) => {
      calls.push(args)
      return out
    },
  }
}

describe('docTerms', () => {
  it('keeps multi-word stems of source files and folds a longer stem into a shorter one', () => {
    expect(
      docTerms([
        'web/components/topic-follow-context.tsx',
        'backend/services/users/follow_context.mts',
        'backend/services/users/follow-context.test.mts',
        'web/components/__tests__/follow-context-card.tsx',
        'web/lib/route-selectors.generated.mts',
        'backend/services/users/work-limits.mts',
        'docs/requirements/client-feature-parity.json',
        'web/lib/topics.ts',
        'a-b.mts',
        'docs/follow-context-design.md',
      ]),
    ).toEqual([
      { term: 'work-limits', paths: ['backend/services/users/work-limits.mts'] },
      {
        term: 'follow-context',
        paths: [
          'backend/services/users/follow_context.mts',
          'web/components/topic-follow-context.tsx',
        ],
      },
    ])
  })

  it('collects every file that shares a stem, orders equal lengths by name and stops at twelve', () => {
    const paths = Array.from({ length: 14 }, (_, index) => `src/part-${index + 10}zz.mts`)
    const terms = docTerms([...paths.toReversed(), 'lib/part-10zz.ts'])
    expect(terms).toHaveLength(12)
    expect(terms[0]).toEqual({
      term: 'part-10zz',
      paths: ['src/part-10zz.mts', 'lib/part-10zz.ts'],
    })
    expect(terms[1]?.term).toBe('part-11zz')
  })
})

describe('findRelatedDocs', () => {
  it('searches Markdown for each name and keeps lines outside the changed files', async () => {
    const { grep, calls } = grepOf(
      rows(
        ['docs/rendering.md', 2, '  Modules return null when the Follow Context payload is empty.'],
        ['docs/changed.md', 4, 'follow-context is described here'],
        ['docs/limits.md', 9, 'see work_limits'],
      ),
    )
    const found = await findRelatedDocs(
      ['src/follow-context.mts', 'src/work-limits.mts', 'docs/changed.md'],
      grep,
    )
    expect(found.hits).toEqual([
      {
        path: 'docs/rendering.md',
        line: 2,
        text: 'Modules return null when the Follow Context payload is empty.',
        term: 'follow-context',
      },
      { path: 'docs/limits.md', line: 9, text: 'see work_limits', term: 'work-limits' },
    ])
    expect(calls).toEqual([
      [
        'grep',
        '--no-index',
        '--exclude-standard',
        '-z',
        '-n',
        '-I',
        '-i',
        '-E',
        '-e',
        'work[-_ ]limits',
        '-e',
        'follow[-_ ]context',
        '--',
        '*.md',
        '*.mdx',
        ':(exclude,glob)**/generated/**',
      ],
    ])
  })

  it('does not search when no changed file gives a name', async () => {
    const { grep, calls } = grepOf('')
    expect(await findRelatedDocs(['src/index.mts'], grep)).toEqual({ terms: [], hits: [] })
    expect(calls).toEqual([])
  })

  it('finds nothing in an empty answer', async () => {
    const found = await findRelatedDocs(['src/work-limits.mts'], grepOf('').grep)
    expect(found.hits).toEqual([])
    expect(found.terms).toHaveLength(1)
  })

  it('escapes a name, keeps a NUL inside the text and cuts a long line', async () => {
    const { grep, calls } = grepOf(
      rows(['docs/a.md', 1, `part-a+b\0${'x'.repeat(400)}`], ['docs/a.md', 2, 'part-axb']),
    )
    const { hits } = await findRelatedDocs(['src/part-a+b.mts'], grep)
    expect(calls[0]).toContain('part[-_ ]a\\+b')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toHaveLength(240)
  })

  it('lists at most eight lines for one name', async () => {
    const many = Array.from({ length: 12 }, (_, index): [string, number, string] => [
      'docs/a.md',
      index + 1,
      'work-limits',
    ])
    const { hits } = await findRelatedDocs(['src/work-limits.mts'], grepOf(rows(...many)).grep)
    expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('renderRelatedDocs', () => {
  const terms = [
    {
      term: 'follow-context',
      paths: Array.from({ length: 10 }, (_, index) => `src/f${index}.mts`),
    },
    { term: 'work-limits', paths: ['src/work-limits.mts'] },
    { term: 'never-found', paths: ['src/never-found.mts'] },
  ]

  it('renders nothing for no hit', () => {
    expect(renderRelatedDocs({ terms, hits: [] })).toBeUndefined()
  })

  it('groups the lines under each name with the changed files it came from', () => {
    const text = renderRelatedDocs({
      terms,
      hits: [
        { path: 'docs/a.md', line: 7, text: 'returns null', term: 'follow-context' },
        { path: 'docs/b.md', line: 3, text: 'a limit', term: 'work-limits' },
      ],
    })
    expect(text).toContain(
      '### follow-context (changed: `src/f0.mts`, `src/f1.mts`, `src/f2.mts`, `src/f3.mts`, `src/f4.mts`, `src/f5.mts`, `src/f6.mts`, `src/f7.mts` and 2 more)\n\n- `docs/a.md:7`: returns null\n',
    )
    expect(text).toContain(
      '### work-limits (changed: `src/work-limits.mts`)\n\n- `docs/b.md:3`: a limit\n',
    )
    expect(text).not.toContain('never-found')
  })
})

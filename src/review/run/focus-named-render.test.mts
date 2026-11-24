import { describe, expect, it } from 'vitest'

import type { NamedPrFact } from './focus-named-prs.mts'
import { renderNamedPrFacts } from './focus-named-render.mts'

describe('renderNamedPrFacts', () => {
  it('renders the head, the counts and a table marking shared paths', () => {
    const fact: NamedPrFact = {
      number: 3963,
      head: '236cad49c02d',
      files: {
        total: 3,
        shared: 1,
        omitted: 0,
        listed: [
          { path: 'docs/rules/test-no-retries.md', status: 'added', shared: true },
          { path: 'docs/new.md', oldPath: 'docs/old|name.md', status: 'renamed', shared: false },
          { path: 'a`b\nc.md', status: 'modified', shared: false },
        ],
      },
    }
    expect(renderNamedPrFacts([fact])).toEqual([
      [
        '## Pull request #3963, named in a point',
        "Computed from git: head `236cad49c02d`, 3 changed files since its merge base with this review's base, 1 also changed by this pull request. The file contents of pull request #3963 are not in the checkout.",
        [
          '| File | Status | Also changed here |',
          '| --- | --- | --- |',
          '| `docs/rules/test-no-retries.md` | added | yes |',
          '| `docs/new.md` (from `docs/old\\|name.md`) | renamed | no |',
          '| `` a`b\\nc.md `` | modified | no |',
        ].join('\n'),
      ].join('\n\n'),
    ])
  })

  it('says how many files were left out of a clipped list', () => {
    const [block] = renderNamedPrFacts([
      {
        number: 5,
        head: 'abcdefabcdef',
        files: {
          total: 202,
          shared: 0,
          omitted: 2,
          listed: [{ path: 'a.ts', status: 'added', shared: false }],
        },
      },
    ])
    expect(block).toContain('(showing 1, shared files first; 2 omitted)')
  })

  it('renders a pull request with no changed file without a table', () => {
    const [block] = renderNamedPrFacts([
      { number: 6, head: 'abcdefabcdef', files: { total: 0, shared: 0, omitted: 0, listed: [] } },
    ])
    expect(block).not.toContain('| File |')
  })

  it('says a pull request could not be read', () => {
    expect(renderNamedPrFacts([{ number: 9, head: null, files: null }])).toEqual([
      '## Pull request #9, named in a point\n\nPull request #9 could not be read from git, so what it changes is unknown.',
    ])
  })
})

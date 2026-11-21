import { describe, expect, it } from 'vitest'

import { SECTIONS, buildContext, sectionsNamed } from './build.mts'
import { CONTEXT_MAX_CHARS, renderContext } from './render.mts'
import type { ContextDeps, ContextInput, SectionBuilder } from './types.mts'

const input: ContextInput = {
  repo: 'o/r',
  pr: 1,
  tree: '/tree',
  baseSha: 'b',
  headSha: 'h',
  out: '/out',
  skills: [],
}
const deps: ContextDeps = {
  exec: async () => '',
  readFile: async () => '',
  gh: async () =>
    JSON.stringify({
      data: {
        repository: {
          pullRequest: { reviews: { nodes: [] }, reviewThreads: { nodes: [] } },
        },
      },
    }),
  trusted: async () => new Set(['reviewer-app']),
  stateDir: '/state',
}

const ok = (name: string, body: string): SectionBuilder => ({
  name,
  build: async () => ({ title: name, body }),
})

describe('SECTIONS', () => {
  it('lists the builders in order', () => {
    expect(SECTIONS.map((section) => section.name)).toEqual([
      'rule-excerpts',
      'change-shape',
      'changed-line-history',
      'linked-regressions',
      'past-reviews',
      'other-reviewers',
    ])
  })
})

describe('sectionsNamed', () => {
  it('returns the named builders in SECTIONS order', () => {
    expect(
      sectionsNamed(['linked-regressions', 'rule-excerpts']).map((section) => section.name),
    ).toEqual(['rule-excerpts', 'linked-regressions'])
  })

  it('throws on an unknown name', () => {
    expect(() => sectionsNamed(['nope'])).toThrow('unknown context section: nope')
  })
})

describe('buildContext', () => {
  it('keeps builder order, drops nulls and turns a failure into a note', async () => {
    const builders: SectionBuilder[] = [
      ok('a', 'A'),
      { name: 'empty', build: async () => null },
      {
        name: 'broken',
        build: async () => {
          throw new Error('boom\nsecond line')
        },
      },
      {
        name: 'odd',
        build: async () => {
          throw 'plain'
        },
      },
      ok('b', 'B'),
    ]
    const built = await buildContext(input, deps, builders)
    expect(built.sections.map((section) => section.title)).toEqual(['a', 'b'])
    expect(built.notes).toEqual(['broken failed: boom', 'odd failed: plain'])
  })

  it('runs the default sections with no skills to an empty context', async () => {
    expect(await buildContext(input, deps)).toEqual({ sections: [], notes: [] })
  })
})

describe('renderContext', () => {
  it('renders titled sections and the notes', () => {
    const text = renderContext({ sections: [{ title: 'T', body: 'body' }], notes: ['n failed'] })
    expect(text).toBe('# Review context\n\n## T\n\nbody\n\n## Notes\n\n- n failed\n')
  })

  it('renders only the heading for an empty build', () => {
    expect(renderContext({ sections: [], notes: [] })).toBe('# Review context\n')
  })

  it('cuts the largest section first, at a line, and says so', () => {
    const small = 'small body'
    const large = Array.from({ length: 50 }, (_, index) => `line ${index}`).join('\n')
    const text = renderContext(
      {
        sections: [
          { title: 'Small', body: small },
          { title: 'Large', body: large },
        ],
        notes: [],
      },
      300,
    )
    expect(text.length).toBeLessThanOrEqual(300)
    expect(text).toContain(small)
    expect(text).toMatch(/\[truncated: \d+ characters omitted to fit the context size cap\]/u)
    expect(text).toContain('line 0\n')
  })

  it('leaves a document under the cap whole', () => {
    expect(CONTEXT_MAX_CHARS).toBeGreaterThan(1000)
    const text = renderContext({ sections: [{ title: 'T', body: 'x' }], notes: [] }, 1000)
    expect(text).not.toContain('truncated')
  })

  it('skips a section too small to cut and still reports the rest it could cut', () => {
    const text = renderContext(
      {
        sections: [
          { title: 'A', body: 'tiny' },
          { title: 'B', body: `${'word '.repeat(10)}\n${'word '.repeat(60)}` },
        ],
        notes: [],
      },
      60,
    )
    expect(text).toContain('tiny')
    expect(text).toContain('truncated')
  })
})

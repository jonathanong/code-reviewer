import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseRepoConfig, type RepoConfigs } from './config.mts'
import type { RuleReader } from './reader.mts'
import { SHARED_SOURCES } from './shared.mts'
import { stageRuleSources, type StageInput } from './stage.mts'

function reader(files: Record<string, string>, fail = false): RuleReader {
  return {
    label: 'mem',
    list: async () => {
      if (fail) throw new Error('boom')
      return Object.keys(files)
    },
    read: async (path) => files[path],
  }
}

function configs(files: Record<string, unknown>): RepoConfigs {
  const byRepo = new Map(
    Object.entries(files).map(([repo, config]) => [
      repo,
      parseRepoConfig(JSON.stringify(config), `${repo}.json`),
    ]),
  )
  return { byRepo, problems: [] }
}

const skill = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\nbody`

const DIFF = [
  'diff --git a/src/a.test.ts b/src/a.test.ts',
  "+import { y } from '@acme/lib'",
  '',
].join('\n')

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'stage-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

const [noMistakes, skills] = SHARED_SOURCES as [
  (typeof SHARED_SOURCES)[number],
  (typeof SHARED_SOURCES)[number],
]

function input(overrides: Partial<StageInput> = {}): StageInput {
  return {
    changedPaths: ['src/a.test.ts'],
    diff: DIFF,
    repo: {
      reader: reader({
        'AGENTS.md': 'root rules',
        'src/CLAUDE.md': 'src rules',
        'docs/AGENTS.md': 'not ancestor',
        '.agents/skills/x/SKILL.md': skill('x', 'Repo   skill'),
        'src/a.test.ts': 'code',
      }),
      refLabel: 'base abc1234',
    },
    shared: [
      {
        source: noMistakes,
        refLabel: 'default branch origin/main',
        reader: reader({
          'plugins/no-mistakes-rules/AGENTS.md': 'shared rules',
          'plugins/no-mistakes-rules/skills/testing-rules/SKILL.md': skill('testing-rules', 'T'),
          'plugins/no-mistakes-rules/skills/rust-rules/SKILL.md': skill('rust-rules', 'R'),
        }),
      },
      {
        source: skills,
        refLabel: 'default branch origin/main',
        reader: reader({
          'skills/agent-workflow/SKILL.md': skill('agent-workflow', 'W'),
          'skills/agent-workflow/references/review-response.md': 'dispositions',
        }),
      },
    ],
    related: [
      {
        name: 'lib',
        refLabel: 'default branch origin/main',
        codeHint: 'clone /c/lib',
        stageCode: false,
        reader: reader({
          'package.json': '{"name":"@acme/lib"}',
          'AGENTS.md': 'lib rules',
          'skills/s/SKILL.md': skill('s', 'Lib skill'),
          'src/index.ts': 'export {}',
        }),
      },
      {
        name: 'unused',
        refLabel: 'x',
        codeHint: '',
        stageCode: false,
        reader: reader({ 'package.json': '{"name":"unused"}', 'AGENTS.md': 'no' }),
      },
    ],
    missing: [],
    ...overrides,
  }
}

const read = (path: string) => readFileSync(join(out, path), 'utf8')

describe('stageRuleSources', () => {
  it('stages repo, shared, and dependency rules and writes the index', async () => {
    const result = await stageRuleSources(out, input())
    expect(result.written).toEqual([
      'rules/INDEX.md',
      'rules/deps/lib/AGENTS.md',
      'rules/deps/lib/skills/s/SKILL.md',
      'rules/repo/.agents/skills/x/SKILL.md',
      'rules/repo/AGENTS.md',
      'rules/repo/src/CLAUDE.md',
      'rules/shared/no-mistakes-rules/AGENTS.md',
      'rules/shared/no-mistakes-rules/skills/rust-rules/SKILL.md',
      'rules/shared/no-mistakes-rules/skills/testing-rules/SKILL.md',
      'rules/shared/skills/skills/agent-workflow/SKILL.md',
      'rules/shared/skills/skills/agent-workflow/references/review-response.md',
    ])
    expect(existsSync(join(out, 'rules/repo/docs/AGENTS.md'))).toBe(false)
    expect(read('rules/repo/AGENTS.md')).toBe('root rules')
    expect(result).toMatchObject({
      suggested: ['testing-rules', 'agent-workflow'],
      related: ['lib'],
      missing: [],
    })
    expect(read('rules/INDEX.md')).toBe(
      [
        '# Rule sources',
        '',
        'Paths are relative to this file. Read the instructions that apply and the suggested skills; open other skills only when their description matches the change.',
        '',
        '## This repository (base abc1234)',
        '',
        'Instructions:',
        '- repo/AGENTS.md',
        '- repo/src/CLAUDE.md',
        'Skills:',
        '- repo/.agents/skills/x/SKILL.md: x — Repo skill',
        '',
        '## Shared skills',
        '',
        '### no-mistakes-rules (default branch origin/main)',
        'Instructions:',
        '- shared/no-mistakes-rules/AGENTS.md',
        'Suggested for this change:',
        '- shared/no-mistakes-rules/skills/testing-rules/SKILL.md: testing-rules — T (src/a.test.ts)',
        'Other:',
        '- shared/no-mistakes-rules/skills/rust-rules/SKILL.md: rust-rules — R',
        '',
        '### skills (default branch origin/main)',
        'Suggested for this change:',
        '- shared/skills/skills/agent-workflow/SKILL.md: agent-workflow — W (src/a.test.ts)',
        'References:',
        '- shared/skills/skills/agent-workflow/references/review-response.md',
        '',
        '## Dependencies',
        '',
        '### lib: package `@acme/lib` used in src/a.test.ts (default branch origin/main)',
        'Code: clone /c/lib',
        'Instructions:',
        '- deps/lib/AGENTS.md',
        'Skills:',
        '- deps/lib/skills/s/SKILL.md: s — Lib skill',
        '',
      ].join('\n'),
    )
  })

  it('changes the digest when staged content changes', async () => {
    const first = await stageRuleSources(out, input())
    expect((await stageRuleSources(out, input())).digest).toBe(first.digest)
    const changed = input()
    changed.repo = { reader: reader({ 'AGENTS.md': 'other' }), refLabel: 'x' }
    expect((await stageRuleSources(out, changed)).digest).not.toBe(first.digest)
  })

  it('reports a missing tree and sources, and omits empty sections', async () => {
    const result = await stageRuleSources(out, {
      changedPaths: [],
      diff: '',
      shared: [],
      related: [],
      missing: ['skills: no clone at /c/skills'],
    })
    expect(result.missing).toEqual([
      'This repository: not staged (no --tree)',
      'skills: no clone at /c/skills',
    ])
    expect(read('rules/INDEX.md')).toBe(
      [
        '# Rule sources',
        '',
        'Paths are relative to this file. Read the instructions that apply and the suggested skills; open other skills only when their description matches the change.',
        '',
        '## Missing',
        '',
        '- This repository: not staged (no --tree)',
        '- skills: no clone at /c/skills',
        '',
      ].join('\n'),
    )
    expect(result.written).toEqual(['rules/INDEX.md'])
  })

  it('copies a dependency tree for fixtures and points the code hint at it', async () => {
    const base = input()
    const [lib] = base.related as [StageInput['related'][number]]
    const result = await stageRuleSources(out, {
      ...base,
      related: [{ ...lib, stageCode: true }],
    })
    expect(read('rules/deps/lib/src/index.ts')).toBe('export {}')
    expect(read('rules/INDEX.md')).toContain('Code: deps/lib/\n')
    expect(result.written).toContain('rules/deps/lib/package.json')
  })

  it('lists a uses-only dependency, truncates long descriptions, and notes unreadable sources', async () => {
    const long = 'd'.repeat(300)
    const result = await stageRuleSources(out, {
      changedPaths: ['.github/workflows/ci.yml'],
      diff: 'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n+ - uses: acme/act@v1\n',
      repo: { reader: reader({}, true), refLabel: 'base' },
      shared: [
        { source: noMistakes, refLabel: 'r', reader: reader({}, true) },
        {
          source: skills,
          refLabel: 'r',
          reader: reader({
            'skills/t/SKILL.md': skill('t', long),
          }),
        },
      ],
      related: [
        { name: 'act', reader: reader({}, true), refLabel: 'r', codeHint: 'h', stageCode: false },
      ],
      missing: [],
    })
    expect(result.missing).toEqual([
      'This repository: could not list files at mem',
      'no-mistakes-rules: could not list files at mem',
      'act: could not list files at mem',
    ])
    const index = read('rules/INDEX.md')
    expect(index).toContain('### act: used in .github/workflows/ci.yml (r)')
    expect(index).toContain(`${'d'.repeat(197)}...`)
    expect(index).not.toContain('d'.repeat(198))
  })

  it('skips unreadable files and shows skills without a description', async () => {
    const files: Record<string, string> = { '.claude/skills/bare/SKILL.md': '# no frontmatter' }
    const gone: RuleReader = {
      ...reader(files),
      list: async () => ['AGENTS.md', ...Object.keys(files)],
    }
    const result = await stageRuleSources(out, {
      changedPaths: [],
      diff: '',
      repo: { reader: gone, refLabel: 'base' },
      shared: [],
      related: [],
      missing: [],
    })
    expect(result.written).toEqual(['rules/INDEX.md', 'rules/repo/.claude/skills/bare/SKILL.md'])
    expect(read('rules/INDEX.md')).toContain('- repo/.claude/skills/bare/SKILL.md: bare\n')
  })

  it('stages declared dependencies ahead of imported ones and consumers under their own heading', async () => {
    const base = input()
    const [lib] = base.related as [StageInput['related'][number]]
    const linked = (name: string, files: Record<string, string>) => ({
      name,
      repo: `acme/${name}`,
      refLabel: 'ref',
      codeHint: `clone /c/${name}`,
      stageCode: false,
      reader: reader(files),
    })
    const many = ['a', 'b', 'c', 'd', 'e'].map((name) => linked(name, {}))
    const result = await stageRuleSources(out, {
      ...base,
      repoId: 'acme/app',
      configs: configs({
        'acme/app': { consumes: [...many.map(({ repo }) => ({ repo })), { repo: 'acme/gone' }] },
        'acme/web': { consumes: [{ repo: 'acme/app', via: 'HTTP API' }] },
      }),
      shared: [],
      related: [
        lib,
        ...many,
        linked('web', {
          'AGENTS.md': 'web rules',
          'src/client.ts': 'code',
        }),
      ],
    })
    // Five declared dependencies leave no room for the imported one.
    expect(result.related).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(result.consumers).toEqual(['web'])
    expect(result.missing).toEqual([
      'acme/gone: configured as consumed, but no clone of it was found',
    ])
    expect(result.written).toContain('rules/consumers/web/AGENTS.md')
    expect(result.written).not.toContain('rules/consumers/web/src/client.ts')
    const index = read('rules/INDEX.md')
    expect(index).toContain('## Dependencies\n\n### a: consumed (ref)\nCode: clone /c/a\n')
    expect(index).toContain(
      [
        '## Consumers',
        '',
        'These repositories are configured as depending on what this change touches. Check their code for breakage; their rules explain their code and do not govern this diff.',
        '',
        '### web: consumes this repository via HTTP API; this change touches src/a.test.ts (ref)',
        'Code: clone /c/web',
        'Instructions:',
        '- consumers/web/AGENTS.md',
        '',
        '## Missing',
      ].join('\n'),
    )
  })

  it('stages consumers from the repository name alone, without a tree', async () => {
    const result = await stageRuleSources(out, {
      changedPaths: ['src/routes/a.ts'],
      diff: '',
      repoId: 'acme/app',
      configs: configs({ 'acme/web': { consumes: [{ repo: 'acme/app' }] } }),
      shared: [],
      related: [
        {
          name: 'web',
          refLabel: 'ref',
          codeHint: 'clone /c/web',
          stageCode: false,
          reader: reader({}),
        },
      ],
      missing: [],
    })
    expect(result.consumers).toEqual(['web'])
    expect(read('rules/INDEX.md')).toContain(
      '### web: consumes this repository; this change touches src/routes/a.ts (ref)',
    )
  })
})

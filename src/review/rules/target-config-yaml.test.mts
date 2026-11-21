import { describe, expect, it, vi } from 'vitest'

import { apiFileReader, readTargetConfig } from './target-config.mts'

const one = (name: string, text: string) => async () => [{ name, text }]

describe('readTargetConfig with YAML', () => {
  it('reads .code-reviewer.yaml and .code-reviewer.yml', async () => {
    for (const name of ['.code-reviewer.yaml', '.code-reviewer.yml']) {
      const result = await readTargetConfig(one(name, 'consumes:\n  - repo: a/lib\n'), 'a/b')
      expect(result.problems).toEqual([])
      expect(result.config?.consumes.map((c) => c.repo)).toEqual(['a/lib'])
    }
  })

  it('reports a YAML file that does not parse, naming it and the line', async () => {
    const result = await readTargetConfig(one('.code-reviewer.yml', 'a: 1\na: 2\n'), 'a/b')
    expect(result.config?.consumes).toEqual([])
    expect(result.problems).toEqual([
      expect.stringMatching(
        /^a\/b\/\.code-reviewer\.yml: not valid YAML \(.* at line 2\); ignored$/u,
      ),
    ])
  })

  it('reports a repository that keeps the config as YAML and as JSON', async () => {
    const result = await readTargetConfig(
      async () => [
        { name: '.code-reviewer.json', text: '{}' },
        { name: '.code-reviewer.yaml', text: '{}' },
      ],
      'a/b',
    )
    expect(result.problems).toEqual([
      'a/b/.code-reviewer.json and a/b/.code-reviewer.yaml: more than one file for the same config; none is used',
    ])
  })
})

describe('apiFileReader with YAML', () => {
  it('reads every YAML config the root listing holds', async () => {
    const run = vi.fn(async (args: string[]) =>
      args.at(-1)?.endsWith('/contents') === true
        ? 'README.md\n.code-reviewer.yaml\n.code-reviewer.yml\n'
        : 'labels: {}',
    )
    const files = await apiFileReader(run, 'acme/web')()
    expect(files.map((file) => file.name)).toEqual(['.code-reviewer.yaml', '.code-reviewer.yml'])
  })
})

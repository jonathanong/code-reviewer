import { describe, expect, it } from 'vitest'

import { parseEvidence } from './evidence-parse.mts'

const WHERE = 'acme.json evidence'

const AWS = {
  name: 'aws',
  description: 'Production logs and metrics,\n read with the aws CLI.',
  guide: { repo: 'Acme/Infra', path: 'docs/production-data.md' },
  commands: ['aws logs filter-log-events', 'aws cloudwatch get-metric-data'],
  env: { AWS_PROFILE: 'readonly', AWS_REGION: 'us-east-1' },
}

function parse(raw: unknown) {
  const problems: string[] = []
  return { sources: parseEvidence(raw, WHERE, problems), problems }
}

/** The one source `AWS` with a field replaced. */
const with_ = (change: Record<string, unknown>) => [{ ...AWS, ...change }]

describe('parseEvidence', () => {
  it('reads a source, lowercasing the guide repository and flattening the description', () => {
    expect(parse([AWS])).toEqual({
      sources: [
        {
          ...AWS,
          description: 'Production logs and metrics, read with the aws CLI.',
          guide: { repo: 'acme/infra', path: 'docs/production-data.md' },
        },
      ],
      problems: [],
    })
  })

  it('reads a file guide and defaults env to none', () => {
    const { env: _env, ...bare } = AWS
    const { sources } = parse([{ ...bare, guide: { file: '~/guides/aws.md' } }])
    expect(sources?.[0]?.guide).toEqual({ file: '~/guides/aws.md' })
    expect(sources?.[0]?.env).toEqual({})
  })

  it('is undefined when the key is absent and an empty list when it is empty', () => {
    expect(parse(undefined)).toEqual({ sources: undefined, problems: [] })
    expect(parse([])).toEqual({ sources: [], problems: [] })
  })

  it('ignores a list that is not an array', () => {
    expect(parse({})).toEqual({
      sources: undefined,
      problems: [`${WHERE}: must be an array; ignored`],
    })
  })

  it('drops a non-object entry and keeps the others', () => {
    const { sources, problems } = parse(['aws', AWS])
    expect(sources).toHaveLength(1)
    expect(problems).toEqual([`${WHERE}[0]: must be an object; source ignored`])
  })

  it('falls back to the layer below when every source is bad', () => {
    expect(parse(with_({ name: 'two words' })).sources).toBeUndefined()
  })

  it('reports an unknown key and keeps the source', () => {
    const { sources, problems } = parse(with_({ token: 'x' }))
    expect(sources).toHaveLength(1)
    expect(problems).toEqual([`${WHERE}[0]: unknown key "token" ignored`])
  })

  it('reads declared paths and removes repeats', () => {
    const { sources, problems } = parse(with_({ paths: ['src/a.ts', 'docs/', 'src/a.ts'] }))
    expect(sources?.[0]?.paths).toEqual(['src/a.ts', 'docs/'])
    expect(problems).toEqual([])
    expect(parse([AWS]).sources?.[0]).not.toHaveProperty('paths')
  })

  it.each([
    [[]],
    ['src/'],
    [['/etc/passwd']],
    [['../x']],
    [['src/../x']],
    [['./a']],
    [['a//b']],
    [['']],
    [['/']],
    [[3]],
    [['a\\b']],
  ])('drops a source whose paths are %j', (paths) => {
    const { sources, problems } = parse(with_({ paths }))
    expect(sources).toBeUndefined()
    expect(problems).toEqual([expect.stringMatching(/\[0\]: .*paths.*; source ignored$/u)])
  })

  it('drops a duplicate name, case-insensitively', () => {
    const { sources, problems } = parse([AWS, { ...AWS, name: 'AWS' }])
    expect(sources).toHaveLength(1)
    expect(problems).toEqual([`${WHERE}[1]: name "AWS" is already used; source ignored`])
  })

  it.each([
    ['name', { name: 'a b' }, '"name" must be a simple identifier'],
    ['missing name', { name: undefined }, '"name" must be a simple identifier'],
    ['missing description', { description: undefined }, 'one line of at most 300 characters'],
    ['blank description', { description: ' ' }, 'one line of at most 300 characters'],
    ['long description', { description: 'x'.repeat(301) }, 'one line of at most 300 characters'],
    ['guide shape', { guide: 'docs.md' }, '"guide" must be an object'],
    ['guide with both forms', { guide: { file: '/a.md', repo: 'a/b' } }, 'exactly'],
    ['guide repo', { guide: { repo: 'nope', path: 'a.md' } }, '"guide.repo" must be owner/name'],
    ['guide path with ..', { guide: { repo: 'a/b', path: '../x.md' } }, 'relative path'],
    ['absolute guide path', { guide: { repo: 'a/b', path: '/x.md' } }, 'relative path'],
    ['relative file guide', { guide: { file: 'guide.md' } }, 'absolute path or start with ~/'],
    ['no commands', { commands: [] }, 'non-empty array'],
    ['commands not a list', { commands: 'aws logs' }, 'non-empty array'],
    ['a bare binary', { commands: ['aws'] }, 'two or more words'],
    ['a shell metacharacter', { commands: ['aws logs; rm'] }, 'two or more words'],
    ['a pipe', { commands: ['aws logs | sh'] }, 'two or more words'],
    ['a substitution', { commands: ['aws $(id)'] }, 'two or more words'],
    ['double spaces', { commands: ['aws  logs'] }, 'two or more words'],
    ['a non-string command', { commands: [3] }, 'two or more words'],
    ['env not an object', { env: ['A'] }, '"env" must be an object of strings'],
    ['lowercase env name', { env: { aws_profile: 'x' } }, 'must match [A-Z_][A-Z0-9_]*'],
    ['non-string env value', { env: { AWS_PROFILE: 3 } }, '"env" value for AWS_PROFILE'],
    ['NUL in an env value', { env: { AWS_PROFILE: 'a\0b' } }, '"env" value for AWS_PROFILE'],
  ])('drops a source with a bad %s', (_what, change, reason) => {
    const { sources, problems } = parse(with_(change))
    expect(sources).toBeUndefined()
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`${WHERE}[0]: `)
    expect(problems[0]).toContain(reason)
    expect(problems[0]).toContain('source ignored')
  })

  it('never puts an env value in a problem', () => {
    const { problems } = parse(
      with_({ commands: ['aws'], env: { AWS_PROFILE: 'super-secret-value' } }),
    )
    expect(problems.join('\n')).not.toContain('super-secret-value')
  })

  it('accepts flags and paths in a command prefix and removes repeated prefixes', () => {
    const { sources } = parse(
      with_({ commands: ['gcloud logging read', './bin/q --json', 'gcloud logging read'] }),
    )
    expect(sources?.[0]?.commands).toEqual(['gcloud logging read', './bin/q --json'])
  })
})

import { describe, expect, it } from 'vitest'

import { parseReferences } from './references-parse.mts'

const WHERE = 'acme.json references'
const AWS = {
  name: 'aws',
  description: 'AWS service\n documentation',
  domains: ['docs.aws.amazon.com', 'docs.aws.amazon.com', 'aws.amazon.com'],
}

function parse(raw: unknown) {
  const problems: string[] = []
  return { sources: parseReferences(raw, WHERE, problems), problems }
}

describe('parseReferences', () => {
  it('reads a source, flattening the description and dropping a repeated domain', () => {
    expect(parse([AWS])).toEqual({
      sources: [
        {
          name: 'aws',
          description: 'AWS service documentation',
          domains: ['docs.aws.amazon.com', 'aws.amazon.com'],
        },
      ],
      problems: [],
    })
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
    expect(problems).toEqual([`${WHERE}[0]: must be an object; reference ignored`])
  })

  it.each([
    ['https://docs.aws.amazon.com'],
    ['docs.aws.amazon.com/lambda'],
    ['docs.aws.amazon.com:443'],
    ['*.aws.amazon.com'],
    ['*.com'],
    ['com'],
    ['localhost'],
    ['127.0.0.1'],
    ['Docs.AWS.amazon.com'],
    ['docs..aws.com'],
    ['-docs.aws.com'],
    ['docs.aws.com.'],
    ['docs.aws.c0m'],
    [''],
    [42],
    ['a.'.repeat(130) + 'com'],
  ])('drops a source whose domain is %j', (domain) => {
    const { sources, problems } = parse([{ ...AWS, domains: [domain] }])
    expect(sources).toBeUndefined()
    expect(problems).toEqual([expect.stringContaining('every domain must be a lowercase hostname')])
  })

  it('drops a source with no domains or a non-array domains', () => {
    for (const domains of [[], 'docs.aws.com', undefined]) {
      expect(
        parse([
          { ...AWS, domains },
          { ...AWS, name: 'ok' },
        ]).problems,
      ).toEqual([
        `${WHERE}[0]: "domains" must be a non-empty array of hostnames; reference ignored`,
      ])
    }
  })

  it('drops a bad name and a bad description', () => {
    expect(parse([{ ...AWS, name: '1x' }, AWS]).problems).toEqual([
      `${WHERE}[0]: "name" must be a simple identifier; reference ignored`,
    ])
    for (const description of ['', ' ', 'x'.repeat(301), 3]) {
      expect(parse([{ ...AWS, description }, AWS]).problems).toEqual([
        `${WHERE}[0]: "description" must be one line of at most 300 characters; reference ignored`,
      ])
    }
  })

  it('drops a repeated name regardless of case and reports unknown keys', () => {
    const { sources, problems } = parse([AWS, { ...AWS, name: 'AWS', extra: 1 }])
    expect(sources).toHaveLength(1)
    expect(problems).toEqual([
      `${WHERE}[1]: unknown key "extra" ignored`,
      `${WHERE}[1]: name "AWS" is already used; reference ignored`,
    ])
  })

  it('ignores a list whose every source is bad', () => {
    expect(parse([{ name: 'x' }]).sources).toBeUndefined()
  })
})

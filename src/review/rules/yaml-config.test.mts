import { describe, expect, it } from 'vitest'

import { parseConfigText } from './config-files.mts'
import { YamlConfigError, parseYamlConfig } from './yaml-config.mts'

const failure = (text: string): YamlConfigError => {
  try {
    parseYamlConfig(text)
  } catch (error) {
    return error as YamlConfigError
  }
  throw new Error('expected the YAML to be rejected')
}

describe('parseYamlConfig', () => {
  it('reads a mapping with comments, nesting, lists and flow collections', () => {
    const text = '# top\na:\n  - 1\n  - b: [x, y] # inline\nc: {d: null}\n'
    expect(parseYamlConfig(text)).toEqual({ a: [1, { b: ['x', 'y'] }], c: { d: null } })
  })

  it('reads values the core schema types as strings or numbers, not as YAML 1.1 would', () => {
    const text = 'a: yes\nb: no\nc: 2024-01-01\nd: 123/456\ne: 0o17\nf: 010\ng: ~\n'
    expect(parseYamlConfig(text)).toEqual({
      a: 'yes',
      b: 'no',
      c: '2024-01-01',
      d: '123/456',
      e: 15,
      f: 10,
      g: null,
    })
  })

  it('reads an empty file as null, which a caller rejects as not a mapping', () => {
    expect(parseYamlConfig('')).toBeNull()
    expect(parseYamlConfig('# only a comment\n')).toBeNull()
  })

  it('keeps << as a plain key, so merge keys merge nothing', () => {
    expect(parseYamlConfig('base: 1\n<<: {extra: 2}\n')).toEqual({ base: 1, '<<': { extra: 2 } })
  })

  it('rejects a duplicate key, naming its line', () => {
    expect(failure('a: 1\nb: 2\na: 3\n')).toMatchObject({ line: 3, message: expect.any(String) })
  })

  it('rejects a document that is not valid YAML, naming the line', () => {
    expect(failure('a: 1\nb: [\n')).toBeInstanceOf(YamlConfigError)
    expect(failure('a: 1\n\tb: 2\n').line).toBe(2)
  })

  it('rejects more than one document', () => {
    expect(failure('a: 1\n---\nb: 2\n').line).toBe(2)
  })

  it('rejects every tag, including the standard ones, naming the line', () => {
    expect(failure('a: 1\nb: !custom x\n')).toMatchObject({ line: 2 })
    expect(failure('a: !!str 1\n')).toMatchObject({ line: 1 })
    expect(failure('a: !!binary aGk=\n')).toMatchObject({ line: 1 })
  })

  it('rejects an alias, naming the line', () => {
    expect(failure('a: &x [1]\nb: *x\n')).toMatchObject({ line: 2, message: 'ALIAS at line 2' })
  })

  it('rejects a billion-laughs document before expanding it', () => {
    const lines = ['a: &a ["lol", "lol", "lol", "lol", "lol", "lol", "lol", "lol", "lol"]']
    for (const [name, before] of [
      ['b', 'a'],
      ['c', 'b'],
      ['d', 'c'],
      ['e', 'd'],
      ['f', 'e'],
      ['g', 'f'],
      ['h', 'g'],
      ['i', 'h'],
    ] as const) {
      const refs = Array.from({ length: 9 }, () => `*${before}`).join(', ')
      lines.push(`${name}: &${name} [${refs}]`)
    }
    expect(failure(lines.join('\n')).line).toBe(2)
  })
})

describe('parseConfigText for YAML files', () => {
  it('picks the parser by file ending, .yaml and .yml alike', () => {
    expect(parseConfigText('a: 1', 'x.yaml')).toEqual({ a: 1 })
    expect(parseConfigText('a: 1', 'x.yml')).toEqual({ a: 1 })
  })

  it('wraps a failure as a YAML config parse error that keeps the cause', () => {
    expect(() => parseConfigText('a: 1\na: 2', 'x.yml')).toThrow(
      expect.objectContaining({ format: 'YAML', cause: expect.any(YamlConfigError) }),
    )
  })
})

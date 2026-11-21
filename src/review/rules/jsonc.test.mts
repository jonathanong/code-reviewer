import { describe, expect, it } from 'vitest'

import { parseConfigText } from './config-files.mts'

describe('parseConfigText', () => {
  it('parses plain JSON unchanged', () => {
    expect(parseConfigText('{"a":[1,2],"b":{"c":null}}')).toEqual({ a: [1, 2], b: { c: null } })
  })

  it('allows line and block comments, including a comment on the last line', () => {
    const text = '{\n  // the label\n  "a": 1, /* inline */ "b": 2 /* end */\n} // done'
    expect(parseConfigText(text)).toEqual({ a: 1, b: 2 })
  })

  it('allows a block comment over several lines', () => {
    expect(parseConfigText('{\n/* one\n   two */\n"a": 1}')).toEqual({ a: 1 })
  })

  it('allows trailing commas in objects and arrays, also before a comment', () => {
    expect(parseConfigText('{"a":[1,2,],"b":{"c":1,},}')).toEqual({ a: [1, 2], b: { c: 1 } })
    expect(parseConfigText('{"a":[1, // last\n],\n}')).toEqual({ a: [1] })
  })

  it('leaves comment markers and commas inside strings alone', () => {
    const value = { url: 'http://x//y', glob: '/* not a comment */', list: 'a,}', esc: 'q"//"' }
    expect(parseConfigText(JSON.stringify(value))).toEqual(value)
    expect(parseConfigText('{"a":"x, ]", "b": "y",}')).toEqual({ a: 'x, ]', b: 'y' })
  })

  it('does not take a comma before a string or a value as trailing', () => {
    expect(parseConfigText('[1,"a",2]')).toEqual([1, 'a', 2])
  })

  it('still rejects what is not JSON', () => {
    expect(() => parseConfigText('{')).toThrow(SyntaxError)
    expect(() => parseConfigText('{"a":1,,}')).toThrow(SyntaxError)
    expect(() => parseConfigText('{,}')).toThrow(SyntaxError)
    expect(() => parseConfigText('{"a":1} /* open')).toThrow(SyntaxError)
    expect(() => parseConfigText('{"a":"open')).toThrow(SyntaxError)
    expect(() => parseConfigText('{a:1}')).toThrow(SyntaxError)
  })
})

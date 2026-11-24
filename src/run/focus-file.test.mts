import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readFocusFile } from './focus-file.mts'
import { Precondition, parseFlags } from './preflight.mts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-file-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (text: string) => {
  const path = join(dir, 'focus.txt')
  writeFileSync(path, text)
  return path
}

describe('readFocusFile', () => {
  it('reads one point per non-empty line and strips a leading dash', () => {
    const path = write(
      '- the retry is bounded\r\n\n  - logging stays quiet  \nplain point\n-not a bullet\n',
    )
    expect(readFocusFile(path)).toEqual([
      'the retry is bounded',
      'logging stays quiet',
      'plain point',
      '-not a bullet',
    ])
  })

  it('names the file when it is missing', () => {
    const path = join(dir, 'missing.txt')
    expect(() => readFocusFile(path)).toThrow(`--focus ${path}: cannot read the file`)
  })

  it('names the file when it holds no point', () => {
    const path = write('\n  \n- \n')
    expect(() => readFocusFile(path)).toThrow(`--focus ${path}: the file has no focus points.`)
  })

  it('refuses more points, or longer ones, than a review checks', () => {
    const many = write(Array.from({ length: 21 }, (_, i) => `point ${i}`).join('\n'))
    expect(() => readFocusFile(many)).toThrow('21 points; at most 20.')
    const long = write(`ok\n${'x'.repeat(501)}`)
    expect(() => readFocusFile(long)).toThrow('point 2 is over 500 characters.')
  })
})

describe('parseFlags with --focus', () => {
  const base = { repo: ['acme/widgets'], pr: '4' }

  it('has no focus without the flag', () => {
    expect(parseFlags(base)).toEqual({
      pull: { repo: 'acme/widgets', pr: 4 },
      post: 'auto',
      force: false,
    })
  })

  it('carries the points of the file', () => {
    expect(parseFlags({ ...base, focus: write('- a\n- b\n') }).focus).toEqual(['a', 'b'])
  })

  it('is a precondition when the file cannot give a point', () => {
    const missing = join(dir, 'missing.txt')
    expect(() => parseFlags({ ...base, focus: missing })).toThrow(Precondition)
    expect(() => parseFlags({ ...base, focus: write('') })).toThrow('the file has no focus points.')
  })
})

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { EXCERPTS_FILE, excerptWriter, parseExcerpts } from './excerpts.mts'

const PLUGIN = fileURLToPath(new URL('../context/fixtures/plugin', import.meta.url))

describe('parseExcerpts', () => {
  it('is unset without the flag, whatever else is given', () => {
    expect(parseExcerpts(undefined, false, true)).toBeUndefined()
  })

  it('accepts both arms with --select and rejects anything else', () => {
    expect(parseExcerpts('alongside', true, false)).toBe('alongside')
    expect(parseExcerpts('replace', true, false)).toBe('replace')
    expect(() => parseExcerpts('both', true, false)).toThrow('alongside or replace')
  })

  it('needs --select and rules', () => {
    expect(() => parseExcerpts('replace', false, false)).toThrow('needs --select')
    expect(() => parseExcerpts('replace', true, true)).toThrow('--no-rules')
  })
})

describe('excerptWriter', () => {
  const plugins = JSON.stringify([
    { id: 'ratchet-workflows@m', enabled: true, scope: 'user', installPath: PLUGIN },
  ])
  const run = async (mode: 'alongside' | 'replace', selected: string[]) => {
    const written = new Map<string, string>()
    const write = await excerptWriter(mode, {
      exec: async () => plugins,
      readFile: (path) => path,
      writeFile: (path, text) => void written.set(path, text),
    })
    await write('/snap', selected)
    return written
  }

  it('writes the excerpts of the selected skills only, marked in the replace arm', async () => {
    const written = await run('replace', ['ratchet-workflows:sample-prose'])
    const text = written.get(`/snap/${EXCERPTS_FILE}`) as string
    expect(text).toContain('### ratchet-workflows:sample-prose')
    expect(text).toContain('Status: not quoted')
    expect(text).not.toContain('sample-rules')
  })

  it('leaves the alongside arm unmarked and still writes a file when nothing is selected', async () => {
    const marked = await run('alongside', ['ratchet-workflows:sample-prose'])
    expect(marked.get(`/snap/${EXCERPTS_FILE}`)).not.toContain('Status:')
    const empty = await run('replace', [])
    expect(empty.get(`/snap/${EXCERPTS_FILE}`)).toContain('# Review context')
  })
})

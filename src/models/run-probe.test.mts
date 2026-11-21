import { describe, expect, it } from 'vitest'

import {
  errorOutput,
  fakeExec,
  fakeIo,
  hitReply,
  opencodeOutput,
  probeAt,
} from './models-fake-io.mts'
import { readFindings, runProbe } from './run-probe.mts'

const probe = probeAt('/stage/src/pages.js')

async function record(answer: (model: string, cwd: string) => string) {
  const { io, removed } = fakeIo()
  const exec = fakeExec('', answer)
  const result = await runProbe('p/m', probe, io, exec)
  return { result, removed, exec }
}

describe('runProbe', () => {
  it('scores a hit with extra findings, usage and seconds, and cleans up the staged tree', async () => {
    const extra = [{ path: 'src/index.js', line: 1, title: 'other' }]
    const { result, removed, exec } = await record(() => opencodeOutput(hitReply(probe, extra)))
    expect(result).toEqual({
      valid: true,
      found: true,
      extra: 1,
      seconds: 1,
      tokens: 120,
      costUsd: 0.5,
      rateLimited: false,
    })
    expect(removed).toEqual(['src/pages.js'])
    const [command, args, options] = exec.mock.calls[0]! as [
      string,
      string[],
      { cwd?: string; env?: Record<string, string> },
    ]
    expect(command).toBe('opencode')
    expect(args).toContain('p/m')
    expect(options?.cwd).toBe('/stage/src/pages.js')
    expect(JSON.parse(options!.env!.OPENCODE_CONFIG_CONTENT!)).toEqual({
      permission: { '*': 'deny', read: 'allow', grep: 'allow', glob: 'allow', list: 'allow' },
    })
  })

  it('accepts a path spelled with a prefix and a line within two', async () => {
    const reply = JSON.stringify({
      findings: [{ path: `./${probe.planted.path}`, line: probe.planted.line + 2, title: 't' }],
    })
    expect((await record(() => opencodeOutput(reply))).result).toMatchObject({
      found: true,
      extra: 0,
    })
    const absolute = JSON.stringify({
      findings: [{ path: `/tmp/x/${probe.planted.path}`, line: probe.planted.line, title: 't' }],
    })
    expect((await record(() => opencodeOutput(absolute))).result.found).toBe(true)
  })

  it('does not count the wrong file or a line three away', async () => {
    const far = JSON.stringify({
      findings: [{ path: probe.planted.path, line: probe.planted.line + 3, title: 't' }],
    })
    expect((await record(() => opencodeOutput(far))).result).toMatchObject({
      valid: true,
      found: false,
      extra: 1,
    })
    const other = JSON.stringify({
      findings: [{ path: `x${probe.planted.path}`, line: probe.planted.line, title: 't' }],
    })
    expect((await record(() => opencodeOutput(other))).result.found).toBe(false)
  })

  it('marks a reply that parses but breaks the findings schema as not valid', async () => {
    const reply = JSON.stringify({ findings: [{ path: 'a', line: 'one', title: 't' }] })
    const { result } = await record(() => opencodeOutput(reply))
    expect(result).toMatchObject({ valid: false, found: false, extra: 0 })
    expect(result.failure).toContain('findings schema')
  })

  it('keeps a one-line failure and cleans up when the run fails', async () => {
    const { result, removed } = await record(() => errorOutput('quota\nsecond line'))
    expect(result).toMatchObject({ valid: false, found: false, rateLimited: false, tokens: null })
    expect(result.failure).toBe('opencode exited with 1: quota')
    expect(removed).toEqual(['src/pages.js'])
  })

  it('reads a step_finish that reports no tokens as zero tokens', async () => {
    const reply = [
      JSON.stringify({ type: 'step_start' }),
      JSON.stringify({ type: 'text', part: { text: hitReply(probe) } }),
      JSON.stringify({ type: 'step_finish', part: {} }),
    ].join('\n')
    const { result } = await record(() => reply)
    expect(result).toMatchObject({ valid: true, tokens: 0 })
  })
})

describe('readFindings', () => {
  it('returns undefined for anything but a findings list of well-formed items', () => {
    expect(readFindings(null)).toBeUndefined()
    expect(readFindings({})).toBeUndefined()
    expect(readFindings({ findings: [null] })).toBeUndefined()
    expect(readFindings({ findings: [{ path: 'a', line: Infinity, title: 't' }] })).toBeUndefined()
    expect(readFindings({ findings: [{ path: 'a', line: 1 }] })).toBeUndefined()
    expect(readFindings({ findings: [] })).toEqual([])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import { modelsCommand } from './command.mts'
import {
  errorOutput,
  fakeExec,
  fakeIo,
  hitReply,
  opencodeOutput,
  probeAt,
} from './models-fake-io.mts'
import type { ModelsReport } from './types.mts'

const LISTING = 'opencode/big-pickle\nopencode/weak-free\nopencode/broken-free\nanthropic/paid\n'

const answer = (model: string, cwd: string): string => {
  if (model === 'opencode/big-pickle') return opencodeOutput(hitReply(probeAt(cwd)))
  if (model === 'opencode/weak-free') return opencodeOutput('{"findings":[]}')
  return errorOutput('boom')
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => !!out.push(String(chunk)))
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => !!err.push(String(chunk)))
  return { out, err }
}

afterEach(() => vi.restoreAllMocks())

describe('modelsCommand', () => {
  it('lists free models, probes each once per probe, ranks, and writes both outputs', async () => {
    const { out, err } = capture()
    const { io, written } = fakeIo()
    const exec = fakeExec(LISTING, answer)
    const code = await modelsCommand(
      { harness: 'opencode', free: true, jobs: '1', out: 'dir' },
      exec,
      io,
    )
    expect(code).toBe(0)
    const report = JSON.parse(out.join('')) as ModelsReport
    expect(report.harness).toBe('opencode')
    expect(report.models.map((model) => model.id)).toEqual([
      'opencode/big-pickle',
      'opencode/weak-free',
      'opencode/broken-free',
    ])
    expect(report.models[0]).toMatchObject({ runs: 3, valid: 1, found: 1, extra: 0, seconds: 1 })
    expect(report.models[1]).toMatchObject({ valid: 1, found: 0 })
    expect(report.models[2]).toMatchObject({ valid: 0, found: 0, failures: [expect.any(String)] })
    expect(err.join('')).toContain('| opencode/big-pickle | 3 |')
    expect(written.get('dir/models.json')).toBe(out.join(''))
    expect(written.get('dir/models.md')).toBe(err.join(''))
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'run')).toHaveLength(9)
  })

  it('runs each probe --probes times for each --model and skips the listing', async () => {
    capture()
    const { io, written } = fakeIo()
    const exec = fakeExec(LISTING, answer)
    await modelsCommand(
      { harness: 'opencode', model: ['opencode/big-pickle'], probes: '2' },
      exec,
      io,
    )
    expect(exec.mock.calls.filter(([, args]) => args[0] === 'models')).toHaveLength(0)
    expect(exec.mock.calls).toHaveLength(6)
    expect(written.size).toBe(0)
  })

  it('reports a rate-limit style failure apart only when the adapter classifies it', async () => {
    const { out } = capture()
    const { io } = fakeIo()
    await modelsCommand(
      { harness: 'opencode', model: ['p/m'] },
      fakeExec('', () => errorOutput('429 rate limit')),
      io,
    )
    const [model] = (JSON.parse(out.join('')) as ModelsReport).models
    expect(model).toMatchObject({ runs: 3, rateLimited: 0, valid: 0 })
  })

  it('rejects an unsupported or missing harness naming the supported ones', async () => {
    const { io } = fakeIo()
    for (const harness of [undefined, 'claude']) {
      await expect(modelsCommand({ harness }, fakeExec('', answer), io)).rejects.toThrow(
        '--harness opencode',
      )
    }
  })

  it('rejects a bad --probes or --jobs and an empty model list', async () => {
    const { io } = fakeIo()
    const exec = fakeExec('', answer)
    await expect(modelsCommand({ harness: 'opencode', probes: '0' }, exec, io)).rejects.toThrow(
      '--probes',
    )
    await expect(modelsCommand({ harness: 'opencode', jobs: 'x' }, exec, io)).rejects.toThrow(
      '--jobs',
    )
    await expect(modelsCommand({ harness: 'opencode', free: true }, exec, io)).rejects.toThrow(
      'no models',
    )
  })
})

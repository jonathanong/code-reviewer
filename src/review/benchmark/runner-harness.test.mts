import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import type { EvalCase } from './cases.mts'
import { runPillar } from './runner.mts'

const item: EvalCase = {
  id: 'c1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'T',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
}

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1] ?? ''
const codexExec = () =>
  vi.fn(async (_command: string, args: string[], _options?: object) => {
    writeFileSync(
      after(args, '-o'),
      JSON.stringify({ findings: [{ severity: 'low', title: 'T', body: 'B' }] }),
    )
    return JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2 } })
  })
const run = { pillar: 'design', pillarPrompt: 'P', model: 'gpt-x', maxTurns: 5 } as const

describe('runPillar on another harness', () => {
  it('runs the pillar on that harness with its model and reports no cost', async () => {
    const exec = codexExec()
    const output = await runPillar(
      item,
      '/snap',
      { ...run, harness: 'codex', readsOutsideCheckout: true },
      exec,
    )
    const [command, args = [], options] = exec.mock.calls[0] ?? []
    expect(command).toBe('codex')
    expect(after(args, '-m')).toBe('gpt-x')
    expect(options).toStrictEqual({ cwd: '/snap' })
    expect(output.findings).toEqual([{ pillar: 'design', severity: 'low', title: 'T', body: 'B' }])
    expect(output.skills).toEqual([])
    expect(output.usage.costUsd).toBeNull()
  })

  it('is refused without the reads-outside-checkout grant, before any model call', async () => {
    const exec = codexExec()
    await expect(runPillar(item, '/snap', { ...run, harness: 'codex' }, exec)).rejects.toThrow()
    expect(exec).not.toHaveBeenCalled()
  })
})

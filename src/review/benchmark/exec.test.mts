import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { ExecError, defaultExec } from './exec.mts'

describe('defaultExec', () => {
  it('resolves stdout and honors the working directory', async () => {
    const stdout = await defaultExec('node', ['-e', 'process.stdout.write(process.cwd())'], {
      cwd: tmpdir(),
    })
    expect(stdout.length).toBeGreaterThan(0)
    expect(await defaultExec('node', ['-e', 'process.stdout.write("hi")'])).toBe('hi')
  })

  it('closes the input of a child that reads it to the end', async () => {
    const read = 'process.stdin.resume().on("end", () => process.stdout.write("closed"))'
    expect(await defaultExec('node', ['-e', read], { timeoutMs: 20_000 })).toBe('closed')
  })

  it('adds env to the child only', async () => {
    const read = ['-e', 'process.stdout.write(process.env.EVIDENCE_TEST_VAR ?? "unset")']
    expect(await defaultExec('node', read, { env: { EVIDENCE_TEST_VAR: 'set' } })).toBe('set')
    expect(await defaultExec('node', read)).toBe('unset')
    expect(process.env.EVIDENCE_TEST_VAR).toBeUndefined()
  })

  it('kills a run when its signal aborts', async () => {
    const controller = new AbortController()
    const hang = defaultExec('node', ['-e', 'setTimeout(() => {}, 60000)'], {
      signal: controller.signal,
    })
    controller.abort()
    await expect(hang).rejects.toBeInstanceOf(ExecError)
  })

  it('kills a run that outlives its timeout and reports an ExecError', async () => {
    const hang = defaultExec('node', ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 100 })
    await expect(hang).rejects.toBeInstanceOf(ExecError)
  })
})

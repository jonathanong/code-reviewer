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

  it('kills a run that outlives its timeout and reports an ExecError', async () => {
    const hang = defaultExec('node', ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 100 })
    await expect(hang).rejects.toBeInstanceOf(ExecError)
  })
})

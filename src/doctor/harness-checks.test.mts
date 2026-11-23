import { describe, expect, it } from 'vitest'

import { fakeIo } from './doctor-fake-io.mts'
import { harnessChecks } from './harness-checks.mts'

describe('harness binaries', () => {
  it('reports each binary with its version', async () => {
    const { io } = fakeIo({
      exec: {
        'claude --version': '2.1.0 (Claude Code)\n',
        'grok --version': 'grok 0.4\n',
        'codex --version': 'codex-cli 0.171.0\n',
        'agy --version': '1.5.15\n',
      },
    })
    expect(await harnessChecks(io)).toEqual([
      { name: 'harness:claude', status: 'ok', detail: '2.1.0 (Claude Code)' },
      { name: 'harness:grok', status: 'ok', detail: 'grok 0.4' },
      { name: 'harness:codex', status: 'ok', detail: 'codex-cli 0.171.0' },
      { name: 'harness:agy', status: 'ok', detail: '1.5.15' },
    ])
  })

  it('fails only when claude is missing; grok is informational', async () => {
    const { io } = fakeIo()
    const [claude, grok] = await harnessChecks(io)
    expect(claude).toMatchObject({ status: 'fail', detail: 'claude is not on PATH' })
    expect(claude?.fix).toContain('put claude on PATH')
    expect(grok).toEqual({
      name: 'harness:grok',
      status: 'ok',
      detail: 'grok is not on PATH (optional)',
    })
  })

  it('fails claude when --version times out, and still reports grok', async () => {
    const { io } = fakeIo({
      exec: { 'claude --version': new Error('timed out'), 'grok --version': 'grok 1' },
    })
    const [claude, grok] = await harnessChecks(io)
    expect(claude).toMatchObject({ status: 'fail', detail: 'claude did not run' })
    expect(grok?.status).toBe('ok')
  })
})

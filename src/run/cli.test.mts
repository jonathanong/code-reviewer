import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runReviewCommand } from '../cli/command.mts'
import { defaultRunEnv } from './command.mts'
import { fakeDeps } from './fake-deps.mts'

let root: string
let stdout: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-cli-'))
  stdout = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('code-reviewer run', () => {
  it.each([['--bogus'], ['--repo', 'a/b']])(
    'reports a bad invocation (%s) as one JSON line with the precondition exit code',
    async (...args) => {
      const { deps } = fakeDeps({ stateDir: root })
      await expect(runReviewCommand(['run', ...args], deps)).resolves.toBe(12)
      expect(stdout).toHaveLength(1)
      expect(JSON.parse(stdout[0] as string)).toMatchObject({ outcome: 'error', exitCode: 12 })
    },
  )
})

describe('defaultRunEnv', () => {
  it('uses the process, the OS temp directory and the GitHub remote', () => {
    const env = defaultRunEnv()
    expect(env.env).toBe(process.env)
    expect(env.tmp).toBe(tmpdir())
    expect(env.remote('acme/widgets')).toBe('https://github.com/acme/widgets.git')
  })
})

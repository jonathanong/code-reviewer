import { describe, expect, it } from 'vitest'

import { fakeIo, listing } from './doctor-fake-io.mts'
import { mapBounded, reasonOf } from './pool.mts'
import { renderLines, runDoctor } from './run.mts'

const healthy = {
  exec: {
    'git --version': 'git version 2.50.0',
    'gh --version': 'gh version 2.80.0',
    'gh auth status': 'ok',
    'claude --version': '2.1.0',
    'claude plugin list --json': listing({ id: 'no-mistakes-rules@m' }, { id: 'jong-skills@m' }),
  },
  dirs: {
    '/state/code-reviewer': [],
    '/tmp': [],
    '/plugins/no-mistakes-rules/skills': ['a'],
    '/plugins/jong-skills/skills': ['b'],
  },
}

describe('runDoctor', () => {
  it('counts every status and keeps a fixed order', async () => {
    const { io } = fakeIo(healthy)
    const result = await runDoctor({ io, flags: { offline: true } })
    expect(result.fail).toBe(0)
    expect(result.warn).toBe(0)
    expect(result.ok).toBe(result.checks.length)
    expect(result.checks.map((check) => check.name)).toEqual([
      'node',
      'git',
      'gh',
      'github-app',
      'gh-login',
      'machine-config',
      'rule-plugin:no-mistakes-rules',
      'plugin-freshness:no-mistakes-rules',
      'rule-plugin:jong-skills',
      'plugin-freshness:jong-skills',
      'harness:claude',
      'harness:grok',
      'harness:codex',
      'harness:agy',
      'tracker-dir',
      'tmp-dir',
      'clone-root',
    ])
  })

  it('reports each failure and warning, and renders the fix under its line', async () => {
    const { io } = fakeIo({
      ...healthy,
      exec: { ...healthy.exec, 'claude --version': new Error('x') },
    })
    const result = await runDoctor({
      io: { ...io, nodeVersion: '20.0.0' },
      flags: { offline: true },
    })
    expect(result).toMatchObject({ fail: 2, warn: 0 })
    const lines = renderLines(result)
    expect(lines).toContain('ok   git: git version 2.50.0')
    expect(lines).toContain('fail node: Node 20.0.0 is older than >=24')
    expect(lines).toContain('     fix: install Node 24 or newer and put it first on PATH')
  })

  it('turns a group that throws into a fail and still runs the others', async () => {
    const { io } = fakeIo(healthy)
    const broken = {
      ...io,
      fs: {
        ...io.fs,
        mtimeMs: (path: string) => {
          if (path === '/state/code-reviewer') throw new Error('EIO')
          return io.fs.mtimeMs(path)
        },
      },
    }
    const result = await runDoctor({ io: broken, flags: { offline: true } })
    expect(result.checks.find((check) => check.name === 'dirs')).toEqual({
      name: 'dirs',
      status: 'fail',
      detail: 'check failed: EIO',
    })
    expect(result.checks.find((check) => check.name === 'node')?.status).toBe('ok')
  })
})

describe('mapBounded', () => {
  it('keeps order and never runs more than the limit at once', async () => {
    let active = 0
    let peak = 0
    const out = await mapBounded([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      await Promise.resolve()
      active--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBe(2)
  })

  it('handles no items', async () => {
    expect(await mapBounded([], 3, async (n: number) => n)).toEqual([])
  })
})

describe('reasonOf', () => {
  it('is the first line of an error, or the text of anything else', () => {
    expect(reasonOf(new Error('first\nsecond'))).toBe('first')
    expect(reasonOf('plain')).toBe('plain')
  })
})

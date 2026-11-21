import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseRepoConfig } from '../review/rules/config.mts'
import { contextCommand } from './command-context.mts'
import type { ReviewDeps } from './deps.mts'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const installPath = fileURLToPath(new URL('../review/context/fixtures/plugin', import.meta.url))
const unreadablePath = fileURLToPath(
  new URL('../review/context/fixtures/unreadable', import.meta.url),
)
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)

function fake(plugins = ['team']) {
  const calls: string[][] = []
  const deps = {
    exec: async (command: string, args: string[]) => {
      calls.push([command, ...args])
      return `${HEAD}\n`
    },
    runner: (owner: string) => async (args: string[]) => {
      calls.push([`gh(${owner})`, ...args])
      return JSON.stringify({ baseRefOid: BASE })
    },
    configs: () => ({
      byRepo: new Map(),
      byOwner: new Map([
        ['acme', parseRepoConfig(JSON.stringify({ rulePlugins: plugins }), 'acme.json', 'owner')],
      ]),
      problems: [],
    }),
    targetConfig: async () => ({ config: undefined, problems: [] }),
    pluginInfo: async () => ({
      enabled: [],
      installs: [
        { name: 'team', installPath },
        { name: 'broken', installPath: unreadablePath },
      ],
    }),
  } as unknown as ReviewDeps
  return { deps, calls }
}

const base = { repo: ['acme/widgets'], pr: '7', tree: '/work/tree' }

describe('contextCommand', () => {
  it('prints the context of every rule skill, taking the head from the checkout and the base from the pull request', async () => {
    const { deps, calls } = fake()
    const out: string[] = []
    expect(await contextCommand(base, deps, (text) => void out.push(text))).toBe(0)
    expect(out[0]).toContain('## Rule excerpts')
    expect(out[0]).toContain('> - MUST NOT paint a widget twice in one frame.')
    expect(out[0]).toContain('Not quoted: mostly prose')
    expect(calls).toContainEqual(['git', '-C', '/work/tree', 'rev-parse', 'HEAD'])
    expect(calls).toContainEqual([
      'gh(acme)',
      'pr',
      'view',
      '7',
      '-R',
      'acme/widgets',
      '--json',
      'baseRefOid',
    ])
  })

  it('prints to stdout by default', async () => {
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((text) => !!written.push(String(text)))
    await contextCommand(base, fake().deps)
    expect(written.join('')).toContain('## Rule excerpts')
  })

  it('notes a skill that cannot be read and still builds the others', async () => {
    const out: string[] = []
    await contextCommand(
      { ...base, skill: ['team:sample-rules'] },
      fake(['team', 'broken']).deps,
      (text) => void out.push(text),
    )
    expect(out[0]).toContain('### team:sample-rules')
    expect(out[0]).toContain('## Notes')
    expect(out[0]).toContain('- broken:broken could not be read')
  })

  it('limits the skills with --skill', async () => {
    const out: string[] = []
    await contextCommand(
      { ...base, skill: ['team:sample-prose'] },
      fake().deps,
      (text) => void out.push(text),
    )
    expect(out[0]).toContain('### team:sample-prose')
    expect(out[0]).not.toContain('### team:sample-rules')
  })

  it('fails on a --skill that is not a rule skill', async () => {
    await expect(
      contextCommand({ ...base, skill: ['team:nope'] }, fake().deps, () => undefined),
    ).rejects.toThrow('team:nope')
  })

  it('writes context.md to --out instead of printing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'context-cmd-'))
    dirs.push(dir)
    const out: string[] = []
    await contextCommand({ ...base, out: join(dir, 'run') }, fake().deps, (t) => void out.push(t))
    expect(out).toEqual([])
    expect(readFileSync(join(dir, 'run', 'context.md'), 'utf8')).toContain('## Rule excerpts')
  })

  it('requires --repo, --pr and --tree', async () => {
    await expect(contextCommand({ repo: ['acme/widgets'] }, fake().deps)).rejects.toThrow(
      '--repo, --pr and --tree',
    )
  })
})

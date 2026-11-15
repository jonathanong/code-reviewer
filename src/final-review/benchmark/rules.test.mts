import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { EvalCase } from './cases.mts'
import { stageCaseRules } from './rules.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function put(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bench-rules-'))
  dirs.push(dir)
  return dir
}

const DIFF = 'diff --git a/src/a.ts b/src/a.ts\n+import x from "@acme/lib/x"\n'
const base: Pick<EvalCase, 'title' | 'kind' | 'reason' | 'expected'> = {
  title: 't',
  kind: 'negative',
  reason: '',
  expected: [],
}
const git = async () => {
  throw new Error('no git')
}

describe('stageCaseRules', () => {
  it('stages the fixture base, its repos/ dependencies with code, and notes missing clones', async () => {
    const fixtureDir = temp()
    put(fixtureDir, {
      'base/AGENTS.md': 'base rules',
      'head/AGENTS.md': 'head rules',
      'repos/lib/package.json': '{"name":"@acme/lib"}',
      'repos/lib/AGENTS.md': 'lib rules',
      'repos/lib/src/x.ts': 'export {}',
      'repos/other/package.json': '{"name":"other"}',
    })
    const dir = temp()
    const item: EvalCase = { ...base, id: 'f', fixture: 'f', fixtureDir }
    const digest = await stageCaseRules(item, { dir, diff: DIFF, body: '' }, undefined, git)
    expect(digest).toMatch(/^[0-9a-f]{64}$/u)
    const rules = (path: string) => readFileSync(join(dir, '.final-review/rules', path), 'utf8')
    expect(rules('repo/AGENTS.md')).toBe('base rules')
    expect(rules('deps/lib/src/x.ts')).toBe('export {}')
    const index = rules('INDEX.md')
    expect(index).toContain('## This repository (base)')
    expect(index).toContain('Code: deps/lib/')
    expect(index).not.toContain('### other')
    expect(index).toContain('no-mistakes-rules: no clone root')
  })

  it('stages the dependencies and consumers that the fixture configs link to its repoId', async () => {
    const fixtureDir = temp()
    put(fixtureDir, {
      'configs/acme/web.json': '{"consumes":[{"repo":"acme/api","via":"HTTP API"}]}',
      'configs/acme/app.json': '{"consumes":[{"repo":"acme/web"}]}',
      'repos/api/routes.ts': 'export {}',
      'repos/app/src/client.ts': 'fetch()',
    })
    const dir = temp()
    const item: EvalCase = { ...base, id: 'f', fixture: 'f', fixtureDir, repoId: 'acme/web' }
    const snapshot = { dir, diff: 'diff --git a/src/a.ts b/src/a.ts\n+const a = 1\n', body: '' }
    await stageCaseRules(item, snapshot, undefined, git)
    const rules = (path: string) => readFileSync(join(dir, '.final-review/rules', path), 'utf8')
    expect(rules('deps/api/routes.ts')).toBe('export {}')
    expect(rules('consumers/app/src/client.ts')).toBe('fetch()')
    const index = rules('INDEX.md')
    expect(index).toContain('### api: consumed via HTTP API (fixture)')
    expect(index).toContain('### app: consumes this repository; this change touches src/a.ts')
  })

  it('stages the exported head for a repo case and has no related repositories', async () => {
    const dir = temp()
    put(dir, { 'AGENTS.md': 'head rules' })
    const item: EvalCase = {
      ...base,
      id: 'r',
      repo: 'a/b',
      pr: 1,
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
    }
    await stageCaseRules(item, { dir, diff: DIFF, body: '' }, undefined, git)
    const index = readFileSync(join(dir, '.final-review/rules/INDEX.md'), 'utf8')
    expect(index).toContain('## This repository (head (base not exported))')
    expect(index).not.toContain('## Dependencies')
  })

  it('handles a fixture without repos/', async () => {
    const fixtureDir = temp()
    put(fixtureDir, { 'base/a.md': 'x' })
    const dir = temp()
    const item: EvalCase = { ...base, id: 'f', fixture: 'f', fixtureDir }
    await stageCaseRules(item, { dir, diff: DIFF, body: '' }, undefined, git)
    expect(readFileSync(join(dir, '.final-review/rules/INDEX.md'), 'utf8')).not.toContain(
      '## Dependencies',
    )
  })
})

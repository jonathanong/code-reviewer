import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { EvalCase, FixtureCase } from './cases.mts'
import { ExecError, type Exec } from './exec.mts'
import { CONTEXT_DIR, relatedDocs, writeRelatedDocs } from './snapshot-context.mts'
import { defaultExec, prepareSnapshot } from './snapshot.mts'

const DIFF = [
  'diff --git a/src/follow-context.mts b/src/follow-context.mts',
  '--- a/src/follow-context.mts',
  '+++ b/src/follow-context.mts',
  '@@ -1 +1 @@',
  '-one',
  '+two',
  '',
].join('\n')
const HIT = 'docs/guide.md\0 12\0Follow context is shown on every topic.\n'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'snapshot-docs-'))
  mkdirSync(join(root, CONTEXT_DIR), { recursive: true })
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function grepExec(answer: () => Promise<string>, calls: string[][] = []): Exec {
  return async (command, args) => {
    calls.push([command, ...args])
    return answer()
  }
}

describe('writeRelatedDocs', () => {
  it('searches the snapshot tree, leaves out the context directory, and writes the lines found', async () => {
    const calls: string[][] = []
    await writeRelatedDocs(
      root,
      DIFF,
      grepExec(async () => HIT, calls),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 4)).toEqual(['git', '-C', root, 'grep'])
    expect(calls[0]?.at(-1)).toBe(`:(exclude)${CONTEXT_DIR}`)
    const docs = relatedDocs(root)
    expect(docs).toContain('## Documentation that mentions what changed')
    expect(docs).toContain('- `docs/guide.md:12`: Follow context is shown on every topic.')
  })

  it('writes nothing when no line matched', async () => {
    await writeRelatedDocs(
      root,
      DIFF,
      grepExec(async () => ''),
    )
    expect(existsSync(join(root, CONTEXT_DIR, 'docs.md'))).toBe(false)
    expect(relatedDocs(root)).toBeUndefined()
  })

  it('reads git grep exit 1 as no match', async () => {
    await writeRelatedDocs(
      root,
      DIFF,
      grepExec(async () => {
        throw new ExecError('exit 1', 1, '', null)
      }),
    )
    expect(relatedDocs(root)).toBeUndefined()
  })

  it('rethrows every other failure of the search', async () => {
    const failure = new ExecError('exit 128', 128, '', null)
    await expect(
      writeRelatedDocs(
        root,
        DIFF,
        grepExec(async () => {
          throw failure
        }),
      ),
    ).rejects.toBe(failure)
    const plain = new Error('spawn failed')
    await expect(
      writeRelatedDocs(
        root,
        DIFF,
        grepExec(async () => {
          throw plain
        }),
      ),
    ).rejects.toBe(plain)
  })

  it('does not search a diff that changes no multi-word source file', async () => {
    const calls: string[][] = []
    await writeRelatedDocs(
      root,
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n',
      grepExec(async () => HIT, calls),
    )
    expect(calls).toEqual([])
  })
})

describe('the snapshots', () => {
  it('stage the lines for a pull request case', async () => {
    const item: EvalCase = {
      id: 'case-1',
      repo: 'acme/widgets',
      pr: 9,
      title: 'T',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      kind: 'negative',
      reason: '',
      expected: [],
    }
    const exec: Exec = async (command, args) => {
      if (command === 'git' && args.includes('diff')) return DIFF
      if (command === 'git' && args.includes('grep')) return HIT
      if (command === 'gh' && args[0] === 'pr') return '{"body":"b","baseRefName":"main"}'
      if (command === 'gh' && args[0] === 'repo') return 'https://github.com/acme/widgets\n'
      return ''
    }
    const snapshot = await prepareSnapshot(item, join(root, 'cache'), join(root, 'work'), exec)
    expect(relatedDocs(snapshot.dir)).toContain('docs/guide.md:12')
  })

  it('stage the lines for a fixture case, searching its head tree with a real git grep', async () => {
    const dir = join(root, 'fx')
    for (const side of ['base', 'head']) mkdirSync(join(dir, side, 'src'), { recursive: true })
    mkdirSync(join(dir, 'head', 'docs'), { recursive: true })
    writeFileSync(join(dir, 'base/src/follow-context.mts'), 'one\n')
    writeFileSync(join(dir, 'head/src/follow-context.mts'), 'two\n')
    // The document is in both trees: a document the change edits is left out of the search.
    mkdirSync(join(dir, 'base', 'docs'), { recursive: true })
    for (const side of ['base', 'head']) {
      writeFileSync(
        join(dir, side, 'docs/guide.md'),
        'Intro\nThe follow context is shown always.\n',
      )
    }
    writeFileSync(join(dir, 'pr.md'), '# T\n\nBody')
    const item: FixtureCase = {
      id: 'fx-1',
      fixture: 'fx',
      fixtureDir: dir,
      title: 'T',
      kind: 'negative',
      reason: '',
      expected: [],
    }
    const snapshot = await prepareSnapshot(
      item,
      join(root, 'cache'),
      join(root, 'work'),
      defaultExec,
    )
    const docs = relatedDocs(snapshot.dir)
    expect(docs).toContain('`docs/guide.md:2`: The follow context is shown always.')
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'docs.md'), 'utf8')).toBe(docs)
  })
})

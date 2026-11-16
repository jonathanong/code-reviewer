import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { EvalCase } from './cases.mts'
import { caseRevision, describeCase, hashFixture } from './fixture.mts'

function fixtureDir(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-'))
  mkdirSync(join(dir, 'head', 'sub'), { recursive: true })
  writeFileSync(join(dir, 'head', 'sub', 'a.sql'), body)
  writeFileSync(join(dir, 'pr.md'), '# T\n')
  return dir
}

const base = { id: 'x', title: 't', kind: 'negative' as const, reason: '', expected: [] }

describe('fixture identity', () => {
  it('hashes content', () => {
    const dir = fixtureDir('one')
    const first = hashFixture(dir)
    expect(first).toMatch(/^[0-9a-f]{64}$/u)
    expect(hashFixture(dir)).toBe(first)
    expect(hashFixture(fixtureDir('two'))).not.toBe(first)
  })

  it('keys fixture and repo cases', () => {
    const dir = fixtureDir('one')
    const fixture: EvalCase = { ...base, fixture: 'fx/a', fixtureDir: dir }
    expect(caseRevision(fixture)).toEqual({
      repo: 'fixture:fx/a',
      baseSha: '',
      headSha: hashFixture(dir),
    })
    const repo: EvalCase = { ...base, repo: 'a/b', pr: 1, baseSha: 'x', headSha: 'y' }
    expect(caseRevision(repo)).toEqual({ repo: 'a/b', baseSha: 'x', headSha: 'y' })
  })

  it('describes the working directory', () => {
    expect(describeCase({ ...base, fixture: 'fx/a', fixtureDir: '/x' })).toMatch(
      /^Fixture: fx\/a\./u,
    )
    expect(describeCase({ ...base, repo: 'a/b', pr: 1, baseSha: 'x', headSha: 'y' })).toMatch(
      /^Repository: a\/b\./u,
    )
  })
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { changeFacts, runFacts } from './facts.mts'
import { DEFAULT_RUN } from '../review/rules/run-parse.mts'
import { holdRules } from './hold.mts'
import { stageRun, type RunOverrides } from './fixture-run.mts'

const dirs: string[] = []

function facts(overrides?: RunOverrides) {
  const out = join(mkdtempSync(join(tmpdir(), 'run-facts-')), 'run')
  dirs.push(out)
  stageRun(out, overrides)
  return runFacts(out)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(join(dir, '..'), { recursive: true, force: true })
})

describe('runFacts', () => {
  it('reports a clean run with its questions, author and token totals', () => {
    expect(facts()).toEqual({
      questions: 0,
      flags: [],
      partial: [],
      truncated: [],
      author: 'octocat',
      tokens: { input: 150, output: 30 },
    })
  })

  it('counts the open questions of the review', () => {
    const questions = [{ question: 'Who clears it?', askOf: 'author', why: 'Sets the TTL.' }]
    expect(facts({ review: { questions } }).questions).toBe(1)
  })

  it('lists the kind of each flag of the review', () => {
    const flags = [
      { kind: 'irreversible', concern: 'Drops a column.' },
      { kind: 'design', concern: 'Odd.', where: 'a.ts:1' },
    ]
    expect(facts({ review: { flags } }).flags).toEqual(['irreversible', 'design'])
  })

  it('names a failed pillar, a failed or blocked evidence source and a verifier that did not run', () => {
    const report = {
      pillars: [{ pillar: 'security', error: 'timed out', failedAttempts: [], findings: [] }],
      evidence: {
        error: 'failed twice',
        sources: [
          { name: 'aws', status: 'blocked', queries: [] },
          { name: 'logs', status: 'checked', queries: [] },
        ],
      },
      verifier: null,
    }
    expect(facts({ report }).partial).toEqual([
      'pillar security failed',
      'evidence run failed',
      'evidence source aws blocked',
      'verifier did not run',
    ])
  })

  it('names a cut-short conversation and a stack member whose diff was skipped', () => {
    const stack = { members: [{ number: 3 }, { number: 4, diffSkipped: 'over 20 MB' }] }
    expect(facts({ context: { truncated: true }, stack }).truncated).toEqual([
      'the conversation is longer than the digest reads',
      'diff of stack member #4 was skipped',
    ])
  })

  it('has no author when the account is gone', () => {
    expect(facts({ context: { author: null } }).author).toBeNull()
  })
})

describe('changeFacts', () => {
  const files = [
    { path: 'src/auth/login.ts', lines: 30 },
    { path: 'package.json', lines: 2 },
    { path: 'pnpm-lock.yaml', lines: 900 },
  ]

  it('counts files and reviewable lines and lists the risky paths, not manifests', () => {
    expect(changeFacts(files, 'octocat')).toEqual({
      files: 3,
      lines: 32,
      riskyPaths: ['src/auth/login.ts'],
    })
  })

  it('does not count pure renames toward files, and still lists their paths as risky', () => {
    const moved = [
      { path: 'src/auth/moved.ts', lines: 0 },
      { path: 'a.ts', lines: 4 },
    ]
    expect(changeFacts(moved, 'octocat')).toEqual({
      files: 1,
      lines: 4,
      riskyPaths: ['src/auth/moved.ts'],
    })
  })

  it('holds a rename-only move of many files only when edits go over the file limit', () => {
    const renames = Array.from({ length: 921 }, (_, i) => ({ path: `moved/f${i}.ts`, lines: 0 }))
    const edits = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ path: `e${i}.ts`, lines: 1 }))
    const held = (list: typeof renames) =>
      holdRules(
        {
          ...changeFacts(list, 'octocat'),
          questions: 0,
          truncated: [],
          partial: [],
          authMode: 'app',
          tooLong: [],
        },
        DEFAULT_RUN,
      ).map((h) => h.rule)
    expect(held([...renames, ...edits(90)])).toEqual(['large-change'])
    expect(held([...renames, ...edits(50)])).toEqual([])
  })

  it('does not count the workflow files a Dependabot pull request edits', () => {
    const bump = [{ path: '.github/workflows/ci.yml', lines: 2 }, ...files]
    expect(changeFacts(bump, 'octocat').riskyPaths).toEqual([
      '.github/workflows/ci.yml',
      'src/auth/login.ts',
    ])
    expect(changeFacts(bump, 'dependabot').riskyPaths).toEqual(['src/auth/login.ts'])
  })

  it('takes the configured globs in place of the defaults', () => {
    expect(changeFacts(files, 'octocat', ['*.json']).riskyPaths).toEqual(['package.json'])
  })
})

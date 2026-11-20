import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { changeFacts, runFacts } from './facts.mts'
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

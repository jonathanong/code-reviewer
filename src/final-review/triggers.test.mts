import { describe, expect, it } from 'vitest'

import {
  historyHits,
  isDocPath,
  isDocsOnly,
  isLockfile,
  isTestOrDocsOnly,
  isTestPath,
  securityTriggers,
} from './triggers.mts'

describe('isDocPath', () => {
  it.each(['README.md', 'a/b.mdx', 'x.rst', 'notes.txt', 'docs/guide.MD'])(
    'treats %s as a doc',
    (path) => expect(isDocPath(path)).toBe(true),
  )
  it.each([
    'src/a.ts',
    'docs/guide.png',
    'pkg/docs/a.ts',
    'requirements.txt',
    'py/requirements-dev.txt',
    'CMakeLists.txt',
    'lib/cmakelists.txt',
  ])('treats %s as code', (path) => expect(isDocPath(path)).toBe(false))
})

describe('isTestPath', () => {
  it.each([
    'a.test.ts',
    'a.spec.mjs',
    'src/__tests__/a.ts',
    'tests/a.ts',
    'test/a.py',
    'fixtures/a.json',
    'a/__snapshots__/b.snap',
    'foo_test.go',
    'foo_test.rs',
    'foo_test.py',
    'FooTests.swift',
    'FooTest.cs',
    'FooTests.kt',
  ])('treats %s as a test', (path) => expect(isTestPath(path)).toBe(true))
  it.each(['src/a.ts', 'latest/a.ts'])('treats %s as non-test', (path) =>
    expect(isTestPath(path)).toBe(false),
  )
})

describe('isDocsOnly and isTestOrDocsOnly', () => {
  it('is false for an empty list', () => {
    expect(isDocsOnly([])).toBe(false)
    expect(isTestOrDocsOnly([])).toBe(false)
  })
  it('requires every path to match', () => {
    expect(isDocsOnly(['a.md', 'b.txt'])).toBe(true)
    expect(isDocsOnly(['a.md', 'docs/b.ts'])).toBe(false)
    expect(isDocsOnly(['a.md', 'b.ts'])).toBe(false)
    expect(isTestOrDocsOnly(['a.md', 'b.test.ts'])).toBe(true)
    expect(isTestOrDocsOnly(['a.md', 'b.ts'])).toBe(false)
  })
})

describe('securityTriggers', () => {
  it('flags security-relevant paths', () => {
    const paths = [
      '.github/workflows/ci.yml',
      'action.yml',
      'sub/action.yaml',
      'Dockerfile',
      'svc/Dockerfile.dev',
      'run.sh',
      'q.sql',
      'db/migrations/001.ts',
      'src/auth/login.ts',
      'src/api/handlers.ts',
      'src/routes.ts',
      'package.json',
      'pnpm-lock.yaml',
      'Cargo.toml',
      'App.csproj',
    ]
    expect(securityTriggers(paths)).toEqual(paths)
  })
  it('ignores ordinary files and docs, even when named like triggers', () => {
    expect(securityTriggers(['src/a.ts', 'docs/auth.md', 'auth.md'])).toEqual([])
    expect(securityTriggers(['requirements.txt', 'py/requirements-dev.txt'])).toEqual([
      'requirements.txt',
      'py/requirements-dev.txt',
    ])
    expect(isDocsOnly(['requirements.txt'])).toBe(false)
  })
})

describe('historyHits', () => {
  it('keeps revert and hotfix subjects', () => {
    const subjects = [
      'Revert "feat: x"',
      'hotfix: y',
      'fix: x',
      'prevent crash',
      'this was reverted',
      'apply hotfix now',
      'it reverts a thing',
    ]
    expect(historyHits(subjects)).toEqual([
      'Revert "feat: x"',
      'hotfix: y',
      'this was reverted',
      'apply hotfix now',
      'it reverts a thing',
    ])
  })
})

describe('isLockfile', () => {
  it.each([
    'pnpm-lock.yaml',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'Cargo.lock',
    'Package.resolved',
    'packages.lock.json',
    'Gemfile.lock',
    'poetry.lock',
    'uv.lock',
    'go.sum',
    '.terraform.lock.hcl',
    'apps/web/pnpm-lock.yaml',
  ])('treats %s as a lockfile', (path) => {
    expect(isLockfile(path)).toBe(true)
  })

  it.each([
    'package.json',
    'pnpm-lock.yaml.bak',
    'src/lock.ts',
    'docs/yarn.lock.md',
    'a/Cargo.toml',
  ])('does not treat %s as a lockfile', (path) => {
    expect(isLockfile(path)).toBe(false)
  })
})

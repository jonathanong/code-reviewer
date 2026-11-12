import { describe, expect, it } from 'vitest'

import { suggestSkills } from './topics.mts'

const names = (paths: string[]) => [...suggestSkills(paths).keys()]

describe('suggestSkills', () => {
  it('always suggests git-rules and agent-workflow, even with no paths', () => {
    expect(names([])).toEqual(['git-rules', 'agent-workflow'])
    expect(suggestSkills([]).get('git-rules')).toBe('')
  })

  it('maps test files and records the first matching path', () => {
    const found = suggestSkills(['src/a.ts', 'src/a.test.ts', 'src/b.spec.ts'])
    expect(found.get('typescript-rules')).toBe('src/a.ts')
    expect(found.get('testing-rules')).toBe('src/a.test.ts')
    expect(found.get('vitest-test-authoring')).toBe('src/a.test.ts')
    expect(names(['tests/x.py'])).toContain('test-authoring')
    expect(names(['tests/x.py'])).not.toContain('vitest-test-authoring')
  })

  it.each([
    ['e2e/login.ts', 'playwright-authoring'],
    ['db/migrations/1.sql', 'postgres-schema-design'],
    ['src/user-repository.ts', 'bounded-iteration'],
    ['src/queue/worker.ts', 'glide-mq'],
    ['app/page.tsx', 'react-rules'],
    ['next.config.mjs', 'react-rules'],
    ['src/lib.rs', 'rust-rules'],
    ['crates/a/Cargo.toml', 'rust-rules'],
    ['.github/workflows/ci.yml', 'github-actions-authoring'],
    ['action.yml', 'github-actions-checklist'],
    ['package.json', 'package-json-checklist'],
    ['pnpm-lock.yaml', 'dependency-rules'],
    ['.github/dependabot.yml', 'dependabot'],
    ['Dockerfile', 'infra-rules'],
    ['scripts/run.sh', 'infra-rules'],
    ['src/webhook.ts', 'integrations-rules'],
    ['src/flags.ts', 'rollout-rules'],
    ['src/metrics.ts', 'observability-rules'],
    ['App.swift', 'native-app-rules'],
    ['src/auth/session.ts', 'security-rules'],
    ['.github/workflows/ci.yml', 'review-ci-logs'],
    ['.github/CODEOWNERS', 'review-ci-logs'],
    ['vitest.config.mts', 'review-ci-logs'],
    ['packages/a/jest.config.js', 'review-ci-logs'],
  ])('maps %s to %s', (path, skill) => {
    expect(suggestSkills([path]).get(skill)).toBe(path)
  })
})

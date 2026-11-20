import { describe, expect, it } from 'vitest'

import { riskyPaths } from './risky.mts'

const NOT_RISKY = [
  'playwright/tests/auth/login.spec.mts',
  '.github/workflows/__tests__/area-ci-triggers.test.mts',
  '.github/workflows/ci-detect-changes/docs-check.sh',
  'backend/api/package.json',
  'backend/scripts/package.json',
  'pnpm-lock.yaml',
  'docs/auth.md',
  'web/components/auth/oauth-login-button.stories.tsx',
  'backend/api/v1/copyright-notices/copyright-notice-match-routes.mts',
  'src/webhook-handler.mts',
  'src/token-parser.mts',
  'src/authors.mts',
  'scripts/deploy.sh',
  'scripts/rotate-secrets.sh',
  'auth/package.json',
  'auth/pnpm-lock.yaml',
  'web/components/iam/role-picker.stories.tsx',
  'src/authored-by.mts',
]

const RISKY = [
  'web/components/auth/oauth-login-button.tsx',
  '.github/workflows/ci.yml',
  '.github/actions/setup/action.yaml',
  'action.yml',
  'backend/data-stores/psql/config-driven/0060-00-01-topic-reference-lifecycle-guards.sql',
  'db/migrations/0001_init.ts',
  'db/migration/0001_init.ts',
  'backend/services/embeddings/vertex-credentials.mts',
  'src/Session.mts',
  'src/crypto/keys.mts',
  'opentofu/modules/iam/main.tf',
  'infra/vars.tfvars',
  'infra/main.tofu',
  'Dockerfile',
  'services/api/Dockerfile.prod',
  'build/api.dockerfile',
  'infra/iam-roles.mts',
  'src/authorization.ts',
  'src/authorize.mts',
  'src/authorise.mts',
  'db/Migrations/001_Initial.cs',
]

describe('riskyPaths', () => {
  it.each(NOT_RISKY)('does not flag %s', (path) => {
    expect(riskyPaths([path])).toEqual([])
  })

  it.each(RISKY)('flags %s', (path) => {
    expect(riskyPaths([path])).toEqual([path])
  })

  it('keeps input order and drops the rest', () => {
    expect(riskyPaths(['a.md', 'x/Dockerfile', 'package.json', 'b.sql'])).toEqual([
      'x/Dockerfile',
      'b.sql',
    ])
  })

  it('lets configured globs replace the defaults', () => {
    const paths = ['src/auth/login.ts', 'infra/main.tf', 'src/payments/charge.mts']
    expect(riskyPaths(paths, ['src/payments/**'])).toEqual(['src/payments/charge.mts'])
    expect(riskyPaths(paths, ['**/*.tf', 'src/auth/**'])).toEqual([
      'src/auth/login.ts',
      'infra/main.tf',
    ])
  })

  it('treats an empty list as nothing risky', () => {
    expect(riskyPaths(['src/auth/login.ts', 'Dockerfile'], [])).toEqual([])
  })

  it('still skips test and doc paths under configured globs', () => {
    expect(riskyPaths(['src/a.test.mts', 'docs/a.md', 'src/a.mts'], ['src/**', 'docs/**'])).toEqual(
      ['src/a.mts'],
    )
  })
})

import { vi } from 'vitest'

import { memoryTracker } from '../review/earlier-fake-io.mts'
import { DEFAULT_LABELS, type LabelNames } from '../review/index.mts'
import { parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import { DEFAULT_MAX_COST_USD } from '../review/rules/limits-parse.mts'
import { defaultReferencesDir } from '../review/targets.mts'
import type { ReviewDeps } from './deps.mts'

export const BOB = { repo: 'bob/c', pr: 4 }

export const BOB_LABELS: LabelNames = { ...DEFAULT_LABELS, requested: 'review me' }

function config(file: string, json: unknown, scope?: 'owner') {
  return parseRepoConfig(JSON.stringify(json), file, scope)
}

/** bob.json relabels and adds a check run for bob; acme/b relabels its own processing label and acme/h its held label. */
const CONFIGS: RepoConfigs = {
  byOwner: new Map([
    [
      'bob',
      config(
        'bob.json',
        {
          labels: { requested: 'review me' },
          checkRun: { name: 'Code review' },
          analysis: [
            {
              name: 'graph',
              description: 'Code graph.',
              guide: { text: 'Use it.' },
              commands: ['graph dependents'],
            },
          ],
          evidence: [
            {
              name: 'aws',
              description: 'Production logs.',
              guide: { file: '/guides/aws.md' },
              commands: ['aws logs filter-log-events'],
              env: { AWS_PROFILE: 'secret-profile-name' },
            },
          ],
          references: [
            { name: 'aws-docs', description: 'AWS docs.', domains: ['docs.aws.amazon.com'] },
          ],
          approvalCheck: false,
          rulePlugins: ['team-rules'],
          limits: { maxCostUsd: 1.5 },
          models: {
            tiers: { small: [{ harness: 'claude', model: 'sonnet' }] },
            steps: { select: 'small', 'pillar.design': [{ harness: 'claude', model: 'opus' }] },
            retry: { maxWaitSeconds: 30 },
          },
        },
        'owner',
      ),
    ],
  ]),
  byRepo: new Map([
    ['acme/b', config('acme/b.json', { labels: { processing: 'busy' } })],
    ['acme/h', config('acme/h.json', { labels: { held: 'parked' } })],
  ]),
  problems: [],
}

/** acme/c keeps its own file: it renames the requested label and sets a check run. */
export const targetConfig = vi.fn(async (repo: string) =>
  repo === 'acme/c'
    ? {
        config: parseRepoConfig(
          '{"labels":{"requested":"please review"},"checkRun":{"name":"Own"}}',
          'acme/c/.code-reviewer.json',
        ),
        problems: ['acme/c/.code-reviewer.json: unknown key "x" ignored'],
      }
    : { config: undefined, problems: [] },
)

/** `problems` are the machine config's problems; none unless a test is about them. */
export function fakeDeps(mode: 'app' | 'gh' = 'app', problems: string[] = []) {
  const labelIo = { labels: vi.fn(), add: vi.fn(), remove: vi.fn() }
  const prepareIo = {} as ReturnType<ReviewDeps['createPrepareIo']>
  const run = vi.fn(async (_args: readonly string[]) => 'https://example.test/check\n')
  const runner = vi.fn(() => run)
  const createLabelIo = vi.fn(() => labelIo)
  const configs = vi.fn(() => ({ ...CONFIGS, problems }))
  const deps = {
    authMode: vi.fn(() => mode),
    checkInstallation: vi.fn(async () => undefined),
    authIdentity: vi.fn(async () => (mode === 'app' ? { login: 'my-app[bot]' } : {})),
    configs,
    targetConfig,
    createLabelIo,
    createIo: vi.fn(() => ({ headSha: async () => 'h'.repeat(40) })),
    createPrepareIo: vi.fn(() => prepareIo),
    runner,
    references: vi.fn(() => defaultReferencesDir()),
    tracker: vi.fn(() => memoryTracker([])),
  } as unknown as ReviewDeps
  return { deps, labelIo, prepareIo, run, runner, createLabelIo, configs }
}

/** `settings` prints these limits when no machine file sets them. */

export const LIMIT_DEFAULTS = {
  maxCostUsd: DEFAULT_MAX_COST_USD,
  runTimeoutSeconds: 1800,
  selectTimeoutSeconds: 120,
  contextDeadlineSeconds: 60,
  pillarJobs: 3,
}

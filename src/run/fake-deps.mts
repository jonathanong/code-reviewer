import { readFileSync } from 'node:fs'
import { vi, type Mock } from 'vitest'

import type { ReviewDeps } from '../cli/deps.mts'
import type { ListedReview } from '../review/github.mts'
import type { LabelIo, PrepareIo, ReviewIo } from '../review/index.mts'
import { parseRepoConfig, NO_CONFIGS, type RepoConfigs } from '../review/rules/config.mts'
import { createTrackerIo } from '../tracker/io.mts'
import type { TrackerIo } from '../tracker/types.mts'

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : never
}

export const HEAD = 'a'.repeat(40)
export const APP = 'reviewer[bot]'

export type FakeOptions = {
  stateDir: string
  labels?: string[]
  /** Review bodies by the trusted App, oldest first. */
  reviews?: string[]
  plugins?: string[]
  /** Machine config problems to report, as a config file text that fails to parse. */
  ownerConfig?: unknown
  authMode?: 'app' | 'gh'
  loginError?: string
  files?: Array<{ path: string; lines: number }>
  postFails?: boolean
  /** The post succeeds but the review list never shows it. */
  unconfirmed?: boolean
  trackerPostedFails?: boolean
}

/** Dependencies for `run`: GitHub and `claude` are fakes; the tracker and files are real, under `stateDir`. */
export function fakeDeps(options: FakeOptions) {
  const labels = [...(options.labels ?? [])]
  const labelIo: Mocked<LabelIo> = {
    labels: vi.fn(async () => [...labels]),
    add: vi.fn(async (names) => void labels.push(...names)),
    remove: vi.fn(async (name) => {
      labels.splice(labels.indexOf(name), 1)
    }),
  }
  const listed: ListedReview[] = (options.reviews ?? []).map((body, index) => ({
    id: index + 1,
    url: `https://github.example/review/old-${index + 1}`,
    body,
    author: APP,
  }))
  const io: Mocked<ReviewIo> = {
    headSha: vi.fn(async () => HEAD),
    diff: vi.fn(),
    listFiles: vi.fn(async () => []),
    listReviews: vi.fn(async () => listed),
    changesRequested: vi.fn(async () => []),
    dismissReview: vi.fn(),
    pullAuthor: vi.fn(async () => 'dev'),
    trustedAuthors: vi.fn(async () => new Set([APP])),
    hasApprovalLabel: vi.fn(async () => false),
    postReview: vi.fn(async (review) => {
      if (options.postFails === true) throw new Error('GitHub is down')
      const id = listed.length + 1
      const url = `https://github.example/review/${id}`
      // A review that lands is what the read-back finds; `unconfirmed` leaves it out.
      if (options.unconfirmed !== true) listed.push({ id, url, body: review.body, author: APP })
      return url
    }),
    addApprovalLabel: vi.fn(async () => undefined),
    removeApprovalLabel: vi.fn(),
  }
  const real = createTrackerIo({ CODE_REVIEWER_STATE_DIR: options.stateDir })
  const tracker: TrackerIo = {
    ...real,
    append: (path, text) => {
      if (options.trackerPostedFails === true && text.includes('"state":"posted"')) {
        throw new Error('disk full')
      }
      real.append(path, text)
    },
  }
  const configs: RepoConfigs =
    options.ownerConfig === undefined
      ? NO_CONFIGS
      : {
          ...NO_CONFIGS,
          byOwner: new Map([
            ['acme', parseRepoConfig(JSON.stringify(options.ownerConfig), 'acme.json', 'owner')],
          ]),
          problems: parseRepoConfig(JSON.stringify(options.ownerConfig), 'acme.json', 'owner')
            .problems,
        }
  const plugins = (options.plugins ?? ['no-mistakes-rules', 'jong-skills']).map((name) => ({
    id: `${name}@market`,
    version: '1.0.0',
  }))
  const deps: Mocked<ReviewDeps> = {
    authMode: vi.fn(() => options.authMode ?? 'app'),
    checkInstallation: vi.fn().mockResolvedValue(undefined),
    authIdentity: vi.fn(async () =>
      options.loginError === undefined ? { login: APP } : { loginError: options.loginError },
    ),
    configs: vi.fn(() => configs),
    targetConfig: vi.fn(async () => ({ config: undefined, problems: [] })),
    createIo: vi.fn(() => io),
    createLabelIo: vi.fn(() => labelIo),
    createAnswerIo: vi.fn(),
    createPrepareIo: vi.fn(
      () => ({ files: async () => options.files ?? [] }) as unknown as PrepareIo,
    ),
    guideReader: vi.fn(),
    runner: vi.fn(),
    readFile: vi.fn((path) => readFileSync(path, 'utf8')),
    writeFile: vi.fn(),
    findClone: vi.fn(),
    tracker: vi.fn(() => tracker),
    listPlugins: vi.fn(),
    pluginInfo: vi.fn(async () => ({
      enabled: plugins,
      installs: plugins.map((plugin) => ({
        name: plugin.id.split('@')[0] as string,
        installPath: `/plugins/${plugin.id}`,
      })),
    })),
    exec: vi.fn(async () => ''),
    progress: vi.fn(),
    references: vi.fn(),
    runBench: vi.fn(),
    runVerifierBench: vi.fn(),
    runSelectionBench: vi.fn(),
    runContextBench: vi.fn(),
    runFocusBench: vi.fn(),
  }
  return { deps, io, labels, labelIo }
}

export const marker = (verdict: string, sha = HEAD) =>
  `<!-- final-review sha=${sha} verdict=${verdict} effort=high -->`

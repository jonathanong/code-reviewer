import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  conflictProblem,
  groupConfigFiles,
  invalidProblem,
  listConfigFiles,
  notObjectProblem,
  parseConfigText,
} from './config-files.mts'
import type { AnswersConfig } from './answers-parse.mts'
import type { IssuesConfig } from '../../issues/config-parse.mts'
import type { ModelConfig } from '../models.mts'
import { defaultReferencesDir, targetNamesIn } from '../targets.mts'
import { consumesList } from './consumes-parse.mts'
import type { AnalysisTool } from './analysis-parse.mts'
import type { EvidenceSource } from './evidence-parse.mts'
import type { ReferenceSource } from './references-parse.mts'
import type { LimitsConfig } from './limits-parse.mts'
import { parseMachineKeys } from './machine-keys.mts'
import { parsePillars, type PillarsConfig } from './pillars-parse.mts'
import { parsePlan, type PlanConfig } from './plan-parse.mts'
import type { RunConfig } from './run-parse.mts'
import {
  parseCheckRun,
  parseLabels,
  type CheckRunSettings,
  type LabelNames,
} from './settings-parse.mts'
import { parseTargets, type TargetsConfig } from './targets-parse.mts'

/** The reviewer's config home, `code-reviewer` under the XDG config home; the App config lives here. */
export function configHome(env: Record<string, string | undefined>): string {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'code-reviewer')
}

/**
 * The machine config directory: `CODE_REVIEWER_CONFIG_DIR`, else `repos` in the config home. It
 * holds one `<owner>/<name>.json` (or `.jsonc`, `.yaml`, `.yml`) per repository, and `<owner>.json`
 * beside that directory for the settings every repository of the owner shares.
 */
export function machineConfigDir(env: Record<string, string | undefined>): string {
  return env.CODE_REVIEWER_CONFIG_DIR || join(configHome(env), 'repos')
}

/** Another repository this one depends on without a package import (an HTTP API, a schema). */
export type Consumes = {
  /** `owner/name`, lowercased. */
  repo: string
  /** Globs in the consumed repository that this one depends on; empty means all of it. */
  paths: string[]
  /** How it is consumed, in a few words; empty when not given. */
  via: string
}

export type RepoConfig = {
  consumes: Consumes[]
  labels?: Partial<LabelNames>
  checkRun?: CheckRunSettings
  /** Machine config only: `true` lets the repository's own file set `evidence`, `references` and `rulePlugins`. */
  trustRepoConfig?: boolean
  /** Machine config, or the repository's own file when `trustRepoConfig` is on for it. */
  evidence?: EvidenceSource[]
  /** Machine config only, even for a trusted repository file: it grants the pillars and the verifier shell commands. */
  analysis?: AnalysisTool[]
  /** Machine config, or a trusted repository's own file: it grants network access. */
  references?: ReferenceSource[]
  /** Machine config only: `false` switches off the second check on an approval. */
  approvalCheck?: boolean
  /** The plugins whose skills hold the shared rules, replacing the default list; an enabled plugin loads its hooks too. */
  rulePlugins?: string[]
  /** Machine config only: it decides what the reviewer posts unattended. */
  run?: RunConfig
  /** Machine config only: it picks the harness and model of every step, so a reviewed repository cannot. */
  models?: ModelConfig
  /** Machine config only: the cost ceiling spends the operator's money, so a reviewed repository cannot raise it. */
  limits?: LimitsConfig
  /** Machine config only: it files issues in other repositories, so a reviewed repository cannot turn it on. */
  issues?: IssuesConfig
  /** Machine config only: it replies in other reviewers' threads, so a reviewed repository cannot. */
  answers?: AnswersConfig
  /** Built-in pillars to skip and extra pillars to run; a reviewed repository's own file may set it. */
  pillars?: PillarsConfig
  /** Built-in targeted checks to skip; a reviewed repository's own file may set it. */
  targets?: TargetsConfig
  plan?: PlanConfig
  problems: string[]
}

/**
 * A repository file holds every key; an owner file holds only the settings repositories share; the
 * reviewed repository's own file (`target`) holds only the settings it may choose, plus `evidence`,
 * `references` and `rulePlugins` when it is `trusted`.
 */
export type ConfigScope = 'repo' | 'owner' | 'target' | 'trusted'

const KEYS = new Set([
  'trustRepoConfig',
  'consumes',
  'labels',
  'checkRun',
  'evidence',
  'analysis',
  'references',
  'approvalCheck',
  'rulePlugins',
  'run',
  'models',
  'limits',
  'issues',
  'answers',
  'pillars',
  'targets',
  'plan',
])

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unknownKeys(record: Json, known: ReadonlySet<string>, where: string): string[] {
  return Object.keys(record)
    .filter((key) => !known.has(key))
    .map((key) => `${where}: unknown key "${key}" ignored`)
}

/** Parses one config file's text; errors become problems that name `file`. */
export function parseRepoConfig(
  text: string,
  file: string,
  scope: ConfigScope = 'repo',
  knownTargets: readonly string[] = targetNamesIn(defaultReferencesDir()),
): RepoConfig {
  let raw: unknown
  try {
    raw = parseConfigText(text, file)
  } catch (error) {
    return { consumes: [], problems: [invalidProblem(file, error)] }
  }
  if (!isRecord(raw)) return { consumes: [], problems: [notObjectProblem(file)] }
  const problems = unknownKeys(raw, KEYS, file)
  const labels = parseLabels(raw.labels, `${file} labels`, problems)
  const checkRun = parseCheckRun(raw.checkRun, `${file} checkRun`, problems)
  if (scope === 'owner' && raw.consumes !== undefined) {
    problems.push(`${file}: "consumes" is repo-level only; ignored`)
  }
  const machine = parseMachineKeys(scope, raw, file, problems)
  const pillars = parsePillars(raw.pillars, `${file} pillars`, problems)
  const targets = parseTargets(raw.targets, `${file} targets`, problems, knownTargets)
  const plan = parsePlan(scope, raw.plan, `${file} plan`, problems)
  return {
    consumes: scope === 'owner' ? [] : consumesList(raw.consumes, file, problems),
    ...(labels === undefined ? {} : { labels }),
    ...(checkRun === undefined ? {} : { checkRun }),
    ...machine,
    ...(pillars === undefined ? {} : { pillars }),
    ...(targets === undefined ? {} : { targets }),
    ...(plan === undefined ? {} : { plan }),
    problems,
  }
}

export type RepoConfigs = {
  /** Lowercased `owner/name` to that repository's config. */
  byRepo: ReadonlyMap<string, RepoConfig>
  /** Lowercased owner to the shared settings in `<owner>.json`. */
  byOwner: ReadonlyMap<string, RepoConfig>
  problems: string[]
}

export const NO_CONFIGS: RepoConfigs = { byRepo: new Map(), byOwner: new Map(), problems: [] }

/** Reads every `<owner>` and `<owner>/<name>` config file under `dir`; a missing directory has none. */
export function loadRepoConfigs(dir: string, referencesDir = defaultReferencesDir()): RepoConfigs {
  const byRepo = new Map<string, RepoConfig>()
  const byOwner = new Map<string, RepoConfig>()
  const problems: string[] = []
  const files = listConfigFiles(dir)
  if (files.length === 0) return { byRepo, byOwner, problems }
  const knownTargets = targetNamesIn(referencesDir)
  for (const [key, group] of groupConfigFiles(files)) {
    if (group.length > 1) {
      problems.push(conflictProblem(group))
      continue
    }
    const file = group[0] as string
    const scope = key.includes('/') ? 'repo' : 'owner'
    const config = parseRepoConfig(readFileSync(join(dir, file), 'utf8'), file, scope, knownTargets)
    problems.push(...config.problems)
    ;(scope === 'repo' ? byRepo : byOwner).set(key, config)
  }
  return { byRepo, byOwner, problems }
}

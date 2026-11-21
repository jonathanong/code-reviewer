import { HARNESS_NAMES } from '../../harness/registry.mts'
import { modelConfigProblems } from '../models-check.mts'
import { TIERS, isStepName, type Candidate, type ModelConfig, type Tier } from '../models.mts'
import { isRecord, unknownKeys } from './settings-parse.mts'

const isTier = (value: unknown): value is Tier => TIERS.some((tier) => tier === value)

function candidate(raw: unknown, where: string, problems: string[]): Candidate | undefined {
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object with "harness" and "model"`)
    return undefined
  }
  const before = problems.length
  problems.push(...unknownKeys(raw, ['harness', 'model', 'readsOutsideCheckout'], where))
  const { harness, model } = raw
  if (typeof harness !== 'string' || !HARNESS_NAMES.includes(harness)) {
    problems.push(`${where}: "harness" must be one of ${HARNESS_NAMES.join(', ')}`)
  }
  if (typeof model !== 'string' || model.trim() === '') {
    problems.push(`${where}: "model" must be a non-empty string`)
  }
  if (raw.readsOutsideCheckout !== undefined && raw.readsOutsideCheckout !== true) {
    problems.push(`${where}: "readsOutsideCheckout" must be true when set`)
  }
  return problems.length === before ? (raw as Candidate) : undefined
}

function candidates(raw: unknown, where: string, problems: string[]): Candidate[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push(`${where}: must be a non-empty list of {harness, model}`)
    return undefined
  }
  const list = raw.map((entry, at) => candidate(entry, `${where}[${at}]`, problems))
  return list.every((entry) => entry !== undefined) ? (list as Candidate[]) : undefined
}

function parseTiers(raw: unknown, where: string, problems: string[]): ModelConfig['tiers'] {
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object`)
    return undefined
  }
  problems.push(...unknownKeys(raw, TIERS, where))
  const tiers: Partial<Record<Tier, Candidate[]>> = {}
  for (const tier of TIERS) {
    if (raw[tier] === undefined) continue
    const list = candidates(raw[tier], `${where}.${tier}`, problems)
    if (list !== undefined) tiers[tier] = list
  }
  return tiers
}

function parseSteps(raw: unknown, where: string, problems: string[]): ModelConfig['steps'] {
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object`)
    return undefined
  }
  const names = Object.keys(raw).filter(isStepName)
  problems.push(...unknownKeys(raw, names, where))
  const steps: NonNullable<ModelConfig['steps']> = {}
  for (const step of names) {
    const value = raw[step]
    if (typeof value === 'string') {
      if (isTier(value)) steps[step] = value
      else problems.push(`${where}.${step}: unknown tier "${value}"; use ${TIERS.join(', ')}`)
      continue
    }
    const list = candidates(value, `${where}.${step}`, problems)
    if (list !== undefined) steps[step] = list
  }
  return steps
}

function parseRetry(raw: unknown, where: string, problems: string[]): ModelConfig['retry'] {
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object`)
    return undefined
  }
  problems.push(...unknownKeys(raw, ['maxWaitSeconds'], where))
  const wait = raw.maxWaitSeconds
  if (!Number.isInteger(wait) || (wait as number) < 0) {
    problems.push(`${where}.maxWaitSeconds: must be a whole number of seconds, 0 or more`)
    return undefined
  }
  return { maxWaitSeconds: wait as number }
}

/**
 * The `models` key: tiers (ordered fallback lists), the steps that use a tier or their own list,
 * and the rate-limit wait budget. A key with any problem is ignored whole, so a typo cannot
 * quietly send a step to a model nobody chose.
 */
export function parseModels(
  raw: unknown,
  where: string,
  problems: string[],
): ModelConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  const found: string[] = []
  found.push(...unknownKeys(raw, ['tiers', 'steps', 'retry'], where))
  const tiers = raw.tiers === undefined ? undefined : parseTiers(raw.tiers, `${where}.tiers`, found)
  const steps = raw.steps === undefined ? undefined : parseSteps(raw.steps, `${where}.steps`, found)
  const retry = raw.retry === undefined ? undefined : parseRetry(raw.retry, `${where}.retry`, found)
  const config: ModelConfig = {
    ...(tiers === undefined ? {} : { tiers }),
    ...(steps === undefined ? {} : { steps }),
    ...(retry === undefined ? {} : { retry }),
  }
  if (found.length === 0) found.push(...modelConfigProblems(config).map((m) => `${where}: ${m}`))
  if (found.length > 0) {
    problems.push(...found.map((problem) => `${problem}; models ignored`))
    return undefined
  }
  return config
}

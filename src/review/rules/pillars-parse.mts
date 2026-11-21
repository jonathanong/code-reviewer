import {
  DISPATCHED_PILLARS,
  EXTRA_PILLAR_NAME,
  PILLARS,
  extraPillar,
  type DispatchedPillar,
  type ExtraPillar,
} from '../pillar-name.mts'
import { isRecord, unknownKeys } from './settings-parse.mts'

export const PILLAR_MODES = ['light', 'full'] as const
export type PillarMode = (typeof PILLAR_MODES)[number]

/** A pillar the config adds, run like a built-in one. */
export type ExtraPillarConfig = {
  name: ExtraPillar
  /** The review modes it runs in. */
  modes: readonly PillarMode[]
  /** A plain-language trigger the pillar's own run decides; only with `prompt`. */
  when?: string
  /** `prompt` is the pillar's instructions; `run` is a command the harness runs as the whole prompt. */
  source: { prompt: string } | { run: string }
}

/** The `pillars` key as a config file sets it; either part may be absent. */
export type PillarsConfig = {
  disabled?: DispatchedPillar[]
  extra?: ExtraPillarConfig[]
}

const EXTRA_KEYS = ['name', 'prompt', 'when', 'modes', 'run']

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

function parseDisabled(raw: unknown, where: string, problems: string[]): DispatchedPillar[] {
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be an array of built-in pillar names`)
    return []
  }
  const names: DispatchedPillar[] = []
  for (const entry of raw) {
    const name = DISPATCHED_PILLARS.find((pillar) => pillar === entry)
    if (name === undefined) {
      problems.push(
        `${where}: unknown built-in pillar ${JSON.stringify(entry)}; use ${DISPATCHED_PILLARS.join(', ')}`,
      )
    } else if (names.includes(name)) problems.push(`${where}: "${name}" is listed more than once`)
    else names.push(name)
  }
  return names
}

function parseModes(raw: unknown, where: string, problems: string[]): PillarMode[] {
  if (raw === undefined) return ['full']
  const modes: PillarMode[] = []
  const valid = Array.isArray(raw) && raw.length > 0
  if (!valid)
    problems.push(`${where}.modes: must be a non-empty array of ${PILLAR_MODES.join(', ')}`)
  for (const entry of valid ? raw : []) {
    const mode = PILLAR_MODES.find((candidate) => candidate === entry)
    if (mode === undefined)
      problems.push(
        `${where}.modes: unknown mode ${JSON.stringify(entry)}; use ${PILLAR_MODES.join(', ')}`,
      )
    else if (modes.includes(mode))
      problems.push(`${where}.modes: "${mode}" is listed more than once`)
    else modes.push(mode)
  }
  return modes
}

function parseName(raw: unknown, where: string, taken: readonly string[], problems: string[]) {
  if (typeof raw !== 'string' || !EXTRA_PILLAR_NAME.test(raw)) {
    problems.push(`${where}.name: must match [a-z][a-z0-9-]*`)
  } else if (PILLARS.some((builtin) => builtin === raw)) {
    problems.push(`${where}.name: "${raw}" is a built-in pillar; choose another name`)
  } else if (taken.includes(raw)) problems.push(`${where}.name: "${raw}" is used more than once`)
  else return extraPillar(raw)
  return undefined
}

function parseSource(raw: Record<string, unknown>, where: string, problems: string[]) {
  const { prompt, run, when } = raw
  if ((prompt === undefined) === (run === undefined)) {
    problems.push(`${where}: set exactly one of "prompt" and "run"`)
    return undefined
  }
  if (when !== undefined && !isText(when))
    problems.push(`${where}.when: must be a non-empty string`)
  if (run !== undefined && when !== undefined) {
    problems.push(`${where}.when: only works with "prompt"; a "run" command is the whole prompt`)
  }
  const key = prompt === undefined ? 'run' : 'prompt'
  const value = raw[key]
  if (!isText(value)) {
    problems.push(`${where}.${key}: must be a non-empty string`)
    return undefined
  }
  return key === 'run' ? { run: value.trim() } : { prompt: value.trim() }
}

function parseExtra(raw: unknown, where: string, taken: readonly string[], problems: string[]) {
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object`)
    return undefined
  }
  const before = problems.length
  problems.push(...unknownKeys(raw, EXTRA_KEYS, where))
  const name = parseName(raw.name, where, taken, problems)
  const source = parseSource(raw, where, problems)
  const modes = parseModes(raw.modes, where, problems)
  if (problems.length > before || name === undefined || source === undefined) return undefined
  const when = typeof raw.when === 'string' ? { when: raw.when.trim() } : {}
  return { name, modes, ...when, source } satisfies ExtraPillarConfig
}

function parseExtras(raw: unknown, where: string, problems: string[]): ExtraPillarConfig[] {
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be an array of objects`)
    return []
  }
  const extras: ExtraPillarConfig[] = []
  raw.forEach((entry, index) => {
    const taken = extras.map((extra) => extra.name)
    const extra = parseExtra(entry, `${where}[${index}]`, taken, problems)
    if (extra !== undefined) extras.push(extra)
  })
  return extras
}

/**
 * The `pillars` key: built-in pillars to skip and extra pillars to run. A key with any problem is
 * ignored whole, so a typo cannot quietly switch off a review or run one nobody wrote.
 */
export function parsePillars(
  raw: unknown,
  where: string,
  problems: string[],
): PillarsConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  const found = unknownKeys(raw, ['disabled', 'extra'], where)
  const disabled =
    raw.disabled === undefined ? undefined : parseDisabled(raw.disabled, `${where}.disabled`, found)
  const extra =
    raw.extra === undefined ? undefined : parseExtras(raw.extra, `${where}.extra`, found)
  if (found.length > 0) {
    problems.push(
      ...found.map((problem) =>
        problem.endsWith('ignored') ? problem : `${problem}; ${where} ignored`,
      ),
    )
    return undefined
  }
  return {
    ...(disabled === undefined ? {} : { disabled }),
    ...(extra === undefined ? {} : { extra }),
  }
}

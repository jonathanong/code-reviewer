import { isRecord, parseSwitch, unknownKeys } from './settings-parse.mts'

/** The `answers` key. Absent means no thread of another reviewer is ever answered. */
export type AnswersConfig = { enabled: boolean }

/** The `answers` key; one with any problem is ignored whole, which leaves answering off. */
export function parseAnswers(
  raw: unknown,
  where: string,
  problems: string[],
): AnswersConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  const found = unknownKeys(raw, ['enabled'], where)
  const enabled = parseSwitch(raw.enabled, `${where}.enabled`, found)
  if (raw.enabled === undefined) found.push(`${where}.enabled: is required`)
  if (found.length > 0 || enabled === undefined) {
    problems.push(...found.map((problem) => `${problem}; answers ignored`))
    return undefined
  }
  return { enabled }
}

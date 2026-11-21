import { asNumber, asRecord, asString } from '../tracker/json.mts'
import type { Reactions } from './types.mts'

export const noReactions = (): Reactions => ({ up: 0, down: 0, other: {} })

/** Totals from GraphQL `reactionGroups { content reactors { totalCount } }`. */
export function readReactions(groups: unknown): Reactions {
  const result = noReactions()
  for (const group of Array.isArray(groups) ? groups : []) {
    const record = asRecord(group)
    const content = asString(record.content) ?? ''
    const count = asNumber(asRecord(record.reactors).totalCount) ?? 0
    if (count === 0) continue
    if (content === 'THUMBS_UP') result.up += count
    else if (content === 'THUMBS_DOWN') result.down += count
    else result.other[content] = (result.other[content] ?? 0) + count
  }
  return result
}

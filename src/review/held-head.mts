import type { LabelIo } from './labels.mts'
import type { LabelNames } from './settings.mts'

/** One timeline row: the event name and the one value that matters for it. */
export type TimelineRow = { event: string; value: string }

/** The current hold's head, and how many times the timeline shows the held label added. */
export type Held = { head: string | undefined; placements: number }

/**
 * Which head the current hold was placed on, read from the pull request timeline, which GitHub
 * orders by when each thing happened (a push cannot be moved before a label). The head is the
 * newest commit or force-push target before the last `held` label; undefined when the label is
 * not on the timeline last as added, or no head precedes it.
 */

export function heldFrom(rows: readonly TimelineRow[], heldLabel: string): Held {
  let head: string | undefined
  let held: string | undefined
  let placements = 0
  for (const { event, value } of rows) {
    if (event === 'committed' || event === 'head_ref_force_pushed') head = value
    else if (value === heldLabel && event === 'labeled') {
      held = head
      placements += 1
    } else if (value === heldLabel && event === 'unlabeled') held = undefined
  }
  return { head: held?.toLowerCase(), placements }
}

/** The actor of the newest `labeled` row for `label`, from rows of `label<TAB>actor`; undefined when there is none or its actor is gone. */
export function lastLabeledBy(rows: readonly TimelineRow[], label: string): string | undefined {
  const actor = rows.findLast((row) => row.event === label)?.value
  return actor === '' ? undefined : actor
}

/** Parses `event<TAB>value` lines, the shape the timeline query prints. */
export function parseTimelineRows(text: string): TimelineRow[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [event = '', value = ''] = line.split('\t')
      return { event, value: value.trim() }
    })
}

/**
 * Whether a hold is out of date: it was placed on a head other than `headSha`, so its review is
 * stale and the new head may be reviewed. Anything unknown (no head given, a failed or empty
 * timeline read) keeps the hold, and the reason says so.
 */
export async function holdStatus(
  io: LabelIo,
  names: LabelNames,
  headSha: string | undefined,
): Promise<{ stale: true; held: Held } | { stale: false; reason: string }> {
  const held =
    headSha === undefined ? undefined : await io.heldHead(names.held).catch(() => undefined)
  if (held?.head === undefined || headSha === undefined) {
    return { stale: false, reason: 'held for a person (the held head could not be determined)' }
  }
  if (held.head === headSha.toLowerCase()) return { stale: false, reason: 'held for a person' }
  return { stale: true, held }
}

import { join } from 'node:path'

import type { PushFile } from '../push-file.mts'

const SECOND_CHECK =
  "Second, decide whether what came in from the base breaks this pull request's own change; the base's own commits are not under review."

const job = (push: PushFile) => [
  push.kind === 'base-merges-only'
    ? 'Your job here is two checks. First, judge each merge resolution listed below against the Merge resolutions rule.'
    : 'Your job here is two checks. First, judge the range-diff listed below, if there is one, against the Merge resolutions rule.',
  SECOND_CHECK,
]

function opening(push: PushFile): string {
  if (push.kind === 'base-merges-only') {
    return `Since the last reviewed commit ${push.reviewedSha}, this pull request only received merges of the base. Its own change is unchanged from that review.`
  }
  if (push.kind === 'rebase-same-change') {
    return `Since the last reviewed commit ${push.reviewedSha}, history was rewritten, and the pull request's own change against the base is the same.`
  }
  return `The commits since the last reviewed commit ${push.reviewedSha} include merges whose conflict resolutions changed code.`
}

/** True when the run has something to say about merges: a light push, or a hand-made resolution. */
function hasMergeBlock(push: PushFile | undefined): push is PushFile {
  if (push === undefined) return false
  return push.kind !== 'substantive' || push.merges.some((merge) => merge.resolution === 'resolved')
}

/**
 * The "Merge resolutions" block of a pillar or verifier prompt. Empty for a first review, a push
 * with no hand-made resolution that is reviewed in full, and any run with no `push.json`, so those
 * prompts do not change; the rule itself is in `_contract.md`.
 */
export function mergeLines(push: PushFile | undefined, out: string): string[] {
  if (!hasMergeBlock(push)) return []
  const merged = push.merges.filter((merge) => merge.resolution === 'resolved').length
  const clean = push.merges.length - merged
  const files = [
    ...(push.merges.length === 0
      ? []
      : [
          `- \`${join(out, 'merges', 'INDEX.md')}\`: ${push.merges.length} merge(s), ${merged} with a hand-made resolution (one numbered patch each beside the index) and ${clean} clean.${push.mergesCapped ? ` ${push.mergesTotal - push.merges.length} more were not read.` : ''}`,
        ]),
    ...(push.rangeDiff === undefined
      ? []
      : [
          `- \`${join(out, push.rangeDiff)}\`: \`git range-diff\` of the old commits against the new ones, where they do not pair up with an identical patch.`,
        ]),
    ...(push.incoming === undefined
      ? []
      : [
          `- \`${join(out, push.incoming)}\`: what the base changed since the last review, with one numbered patch per file beside the index. Read it for the second check, and read only the patches that bear on this pull request's change.`,
        ]),
  ]
  const nothing =
    merged === 0 && push.rangeDiff === undefined
      ? ['No merge had a hand-made resolution, so only the second check applies.']
      : []
  return [
    '## Merge resolutions',
    opening(push),
    ...(push.kind === 'substantive' ? [] : job(push)),
    ...nothing,
    files.join('\n'),
  ]
}

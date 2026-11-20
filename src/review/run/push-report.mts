import type { PushFile } from '../push-file.mts'
import type { PushKind } from '../push-types.mts'

/** The push since the last review as `report.json` shows it. */
export type ReportPush = {
  kind: PushKind
  reason: string
  merges: { sha: string; resolution: 'clean' | 'resolved' }[]
  mergesTotal: number
  mergesCapped: boolean
  rangeDiff: boolean
  problems: string[]
}

export function reportPush(push: PushFile): ReportPush {
  return {
    kind: push.kind,
    reason: push.reason,
    merges: push.merges.map(({ sha, resolution }) => ({ sha, resolution })),
    mergesTotal: push.mergesTotal,
    mergesCapped: push.mergesCapped,
    rangeDiff: push.rangeDiff !== undefined,
    problems: push.problems,
  }
}

export function renderPush(push: ReportPush): string[] {
  const merges = push.merges.map(
    (merge) =>
      `- \`${merge.sha.slice(0, 7)}\`: ${merge.resolution === 'clean' ? 'clean merge' : 'conflict resolution reviewed'}`,
  )
  return [
    `### Push since the last review: ${push.kind}`,
    push.reason,
    ...(push.merges.length === 0
      ? []
      : [
          `Merges checked (${push.merges.length} of ${push.mergesTotal}${push.mergesCapped ? ', capped' : ''}):\n\n${merges.join('\n')}`,
        ]),
    ...(push.rangeDiff ? ['The range-diff of the rewrite was reviewed.'] : []),
    ...push.problems.map((problem) => `Problem: ${problem}`),
  ]
}

/** What the commits pushed since the last trusted review amount to. */
export type PushKind = 'base-merges-only' | 'rebase-same-change' | 'substantive'

/** The kinds that are re-reviewed light, on the merge resolutions and what came in from the base. */
export type LightPush = Exclude<PushKind, 'substantive'>

/** A merge commit pushed since the review, and what its conflict resolution changed. */
export type MergeResolution = {
  sha: string
  /** `git show --remerge-diff` output; empty when the merge was clean. */
  resolution: string
  /** The resolution was cut at `MAX_RESOLUTION_BYTES`. */
  truncated: boolean
}

/** The push since the last trusted review, as local git reported it. */
export type PushInspection = {
  kind: PushKind
  reason: string
  reviewedSha: string
  headSha: string
  /** The merge commits on the first-parent chain after the reviewed head, at most `MAX_MERGES`. */
  merges: MergeResolution[]
  /** How many merge commits there are, before the cap. */
  mergesTotal: number
  /** A rebase's `git range-diff`, only when the old and new commits do not pair up one to one. */
  rangeDiff?: string
  /** What the base changed between the old and the new fork point, for the semantic check. */
  incoming?: { from: string; to: string; diff: string }
  /** Why git could not answer part of the question; the push is then `substantive`. */
  problems: string[]
}

/** More merge commits than this are not all checked, so the push is reviewed in full. */
export const MAX_MERGES = 20
/** One merge's resolution is cut here, and the push is then reviewed in full. */
export const MAX_RESOLUTION_BYTES = 200_000
/** What came in from the base is not listed above this size, and the push is reviewed in full. */
export const MAX_INCOMING_BYTES = 5_000_000
/** The range-diff is cut here; it never changes the kind. */
export const MAX_RANGE_DIFF_BYTES = 200_000

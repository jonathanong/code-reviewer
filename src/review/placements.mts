import type { CommentableIndex } from '../review-payload/index.mts'
import { placeFindings } from './build.mts'
import type { Finding } from './finding.mts'

/** Where a finding went when posted: an inline comment, or a block in the review body. */
export type Placement = 'inline' | 'body'

/** The placement of each finding, in the order given, by the same rule the posted review uses. */
export function findingPlacements(
  findings: readonly Finding[],
  index: CommentableIndex,
): Placement[] {
  const inBody = new Set<Finding>(placeFindings(findings, index).offDiff)
  return findings.map((finding) => (inBody.has(finding) ? 'body' : 'inline'))
}

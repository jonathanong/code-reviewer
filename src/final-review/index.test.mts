import { describe, expect, it } from 'vitest'

import * as api from './index.mts'

describe('final-review index', () => {
  it('exports the public surface', () => {
    expect(Object.keys(api).sort()).toEqual([
      'COMPLETE_LABEL',
      'DEFAULT_LIMITS',
      'EFFORTS',
      'FINAL_APPROVAL_LABEL',
      'FinalReviewError',
      'IN_PROGRESS_LABEL',
      'MARKER_RE',
      'NUMBERED_DIFF_LEGEND',
      'PART_MARKER_RE',
      'PILLARS',
      'REQUESTED_LABEL',
      'SEVERITIES',
      'abortReview',
      'assertPullTarget',
      'buildFinalReviews',
      'buildFollowUpContext',
      'claimReview',
      'completeReview',
      'createGhFinalReviewIo',
      'createGhLabelIo',
      'createGhPrepareIo',
      'deriveVerdict',
      'fetchConversation',
      'finalReviewStatus',
      'listQueue',
      'numberDiff',
      'packBodies',
      'parseFinalReviewInput',
      'placeFindings',
      'planReview',
      'postFinalReview',
      'prepareReview',
      'renderBodyFinding',
      'renderFindingBody',
      'renderFollowUpContext',
      'renderHeader',
      'resolveThreads',
      'reviewMarker',
      'revokeFinalApproval',
      'scopeQualifier',
      'squash',
    ])
  })
})

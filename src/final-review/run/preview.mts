import type { PostOutcome } from '../post.mts'

/** The reviews `post` would send, as Markdown: each body, then each inline comment with its place. */
export function renderPreview(outcome: Pick<PostOutcome, 'verdict' | 'reviews'>): string {
  const total = outcome.reviews.length
  const parts = outcome.reviews.map((review, index) => {
    const comments = review.comments.map((comment) => {
      const range = comment.start_line === undefined ? '' : `${comment.start_line}-`
      return `#### \`${comment.path}:${range}${comment.line}\` (${comment.side})\n\n${comment.body}`
    })
    return [
      `## Review part ${index + 1} of ${total}`,
      review.body,
      ...(comments.length === 0 ? [] : [`### Inline comments (${comments.length})`, ...comments]),
    ].join('\n\n')
  })
  return `# Preview: ${outcome.verdict}\n\n${parts.join('\n\n')}\n`
}

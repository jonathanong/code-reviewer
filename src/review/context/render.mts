import type { BuiltContext, ContextSection } from './types.mts'

export const CONTEXT_MAX_CHARS = 60_000

const marker = (omitted: number) =>
  `\n\n[truncated: ${omitted} characters omitted to fit the context size cap]`

function render(sections: readonly ContextSection[], notes: readonly string[]): string {
  const parts = ['# Review context', ...sections.map((s) => `## ${s.title}\n\n${s.body}`)]
  if (notes.length > 0) parts.push(`## Notes\n\n${notes.map((note) => `- ${note}`).join('\n')}`)
  return `${parts.join('\n\n')}\n`
}

/** One markdown document; over `max` characters, the largest sections are cut first, at a line. */
export function renderContext(built: BuiltContext, max = CONTEXT_MAX_CHARS): string {
  const sections = built.sections.map((section) => ({ ...section }))
  let excess = render(sections, built.notes).length - max
  for (const section of [...sections].sort((a, b) => b.body.length - a.body.length)) {
    if (excess <= 0) break
    const keep = section.body.slice(
      0,
      Math.max(0, section.body.length - excess - marker(section.body.length).length),
    )
    const cut = keep.slice(0, Math.max(0, keep.lastIndexOf('\n')))
    const next = `${cut}${marker(section.body.length - cut.length)}`
    if (next.length >= section.body.length) continue
    excess -= section.body.length - next.length
    section.body = next
  }
  return render(sections, built.notes)
}

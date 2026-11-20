/** The Notes block of the review body; empty without notes, so the body does not change. */
export function notesSection(notes: readonly string[] | undefined): string[] {
  if (notes === undefined || notes.length === 0) return []
  return [`**Notes**\n\n${notes.map((note) => `- ${note}`).join('\n')}`]
}

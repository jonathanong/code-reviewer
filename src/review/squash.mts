const NOTE_CHARS = 360

/** Collapses a third-party comment to plain text: no HTML comments, collapsed details, bounded. */
export function squash(body: string, max = NOTE_CHARS): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<details>\s*<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/gu, ' [$1] ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

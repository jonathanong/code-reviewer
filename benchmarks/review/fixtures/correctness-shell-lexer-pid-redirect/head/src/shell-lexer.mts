/**
 * The commands a shell runs, split at newlines, `;`, `&&`, `||` and each stage of a pipeline.
 * Text inside quotes is never split.
 */
export function splitSegments(script: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: string | undefined
  for (let index = 0; index < script.length; index++) {
    const char = script[index]!
    if (char === '\\' && quote !== "'") {
      current += char + (script[index + 1] ?? '')
      index++
      continue
    }
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    const boundary =
      char === ';' || char === '\n' || (char === '&' && script[index + 1] === '&') || char === '|'
    if (!boundary) {
      current += char
      continue
    }
    segments.push(current)
    current = ''
    const next = script[index + 1]
    if ((char === '&' || char === '|') && (next === char || next === '&')) index++
  }
  segments.push(current)
  return segments.map((segment) => segment.trim()).filter((segment) => segment !== '')
}

function nameAt(text: string, index: number): string {
  const start = text[index] === '{' ? index + 1 : index
  return /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(start))?.[0] ?? ''
}

/** Whether the segment expands `$variable` or `${variable}`: not in single quotes, not escaped. */
export function expandsVariable(segment: string, variable: string): boolean {
  let quote: string | undefined
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index]!
    if (char === '\\' && quote !== "'") {
      index++
    } else if ((char === "'" || char === '"') && (quote === undefined || quote === char)) {
      quote = quote === undefined ? char : undefined
    } else if (char === '$' && quote !== "'" && nameAt(segment, index + 1) === variable) {
      return true
    }
  }
  return false
}

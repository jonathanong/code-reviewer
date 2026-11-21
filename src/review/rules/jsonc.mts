/**
 * Turns JSONC into JSON text: comments become blanks, so error offsets still point at the source,
 * and a comma directly before `}` or `]` is dropped. String contents are never touched.
 */
export function jsoncToJson(text: string): string {
  const out: string[] = []
  let comma = -1
  let last = '{'
  let index = 0
  const blank = (to: number) => {
    for (; index < to; index += 1) out.push(text[index] === '\n' ? '\n' : ' ')
  }
  while (index < text.length) {
    const char = text[index] as string
    const pair = text.slice(index, index + 2)
    if (pair === '//') {
      const end = text.indexOf('\n', index)
      blank(end === -1 ? text.length : end)
    } else if (pair === '/*') {
      const end = text.indexOf('*/', index + 2)
      // An unterminated comment stays in the text, so parsing fails on it.
      if (end === -1) break
      blank(end + 2)
    } else if (char === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      out.push(text.slice(index, end + 1))
      index = end + 1
      comma = -1
      last = '"'
    } else {
      if ((char === '}' || char === ']') && comma !== -1) out[comma] = ' '
      if (!/\s/u.test(char)) {
        // A comma with nothing before it, or after another comma, is not a trailing one.
        comma = char === ',' && !'{[,'.includes(last) ? out.length : -1
        last = char
      }
      out.push(char)
      index += 1
    }
  }
  return out.join('') + text.slice(index)
}

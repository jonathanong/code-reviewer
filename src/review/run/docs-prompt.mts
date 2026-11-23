/**
 * The document lines that mention what changed, as a section of the verifier's prompt. The text
 * is already a section, with its heading. Empty without any, so the prompt of a pull request that
 * no document mentions does not change.
 */
export function docsLines(docs: string | undefined): string[] {
  const text = docs?.trim() ?? ''
  return text === '' ? [] : [text]
}

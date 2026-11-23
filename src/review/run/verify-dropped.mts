/** The reason the verifier gave for each input finding it dropped, by input index; bad entries are ignored. */
export function droppedReasons(raw: unknown, inputCount: number): Map<number, string> {
  const dropped = new Map<number, string>()
  const entries = Array.isArray(raw) ? (raw as unknown[]) : []
  for (const entry of entries) {
    const { index, reason } = (entry ?? {}) as { index?: unknown; reason?: unknown }
    const valid =
      typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < inputCount
    if (valid && typeof reason === 'string' && reason.trim() !== '') {
      dropped.set(index, reason.trim())
    }
  }
  return dropped
}

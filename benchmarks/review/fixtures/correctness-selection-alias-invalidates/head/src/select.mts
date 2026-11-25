import { overlaps } from './pointers.mts'
import { scan } from './trace.mts'

export type TestTrace = {
  test: string
  fixtures: string[]
  /** The test file's source, scanned for the pointers it reads. */
  source: string
}

const LOADER = 'loadFixture'

/**
 * The proof that a test reads only the pointers its source names. Without it the test must run
 * for any change to the fixture file.
 */
function proofHolds(source: string): boolean {
  const scanned = scan(source, LOADER)
  const loaderCalls = scanned.calls.filter((call) => call.callee === LOADER)
  // A bare reference or an alias is a mention that is not a call; any of them voids the proof.
  if (scanned.loaderMentions !== loaderCalls.length || loaderCalls.length === 0) return false
  return loaderCalls.every((call) => call.pointer !== undefined)
}

/**
 * Tests that read the changed fixture file. When the proof holds for a test, it is kept only if
 * a pointer it reads overlaps a changed pointer.
 */
export function selectTests(
  changedFixture: string,
  changedPointers: string[],
  traces: TestTrace[],
): string[] {
  return traces
    .filter((trace) => trace.fixtures.includes(changedFixture))
    .filter((trace) => {
      if (!proofHolds(trace.source)) return true
      const reads = scan(trace.source, LOADER)
        .calls.filter((call) => call.callee === LOADER)
        .map((call) => call.pointer ?? '')
      return reads.some((read) => changedPointers.some((changed) => overlaps(read, changed)))
    })
    .map((trace) => trace.test)
}

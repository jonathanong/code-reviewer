import { ReviewError } from '../finding.mts'
import { parseFocus, type FocusAnswer } from '../focus.mts'

/** One link the verifier is expected to return: check `check` is disproved by input finding `finding`. */
export type DisprovedPair = { check: number; finding: number }

/** The focus answers a verifier case shows the verifier, and the links it should return for them. */
export type VerifierFocusFields = {
  /** Shown to the verifier as the review does; not the `focus` points `bench-focus` grades. */
  verifierFocus?: FocusAnswer[]
  /** Pairs of (position in `verifierFocus`, index in `## Pillar findings`); empty when none is disproved. */
  expectedDisproved?: DisprovedPair[]
}

type Json = Record<string, unknown>

const index = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Parses a case's `verifierFocus` and `expectedDisproved`; the second needs the first. */
export function parseVerifierFocus(raw: Json, where: string): VerifierFocusFields {
  const { verifierFocus, expectedDisproved } = raw
  if (verifierFocus === undefined) {
    if (expectedDisproved !== undefined) {
      throw new ReviewError(`${where}: expectedDisproved needs verifierFocus`)
    }
    return {}
  }
  const { focus } = parseFocus(verifierFocus)
  if (focus === undefined) throw new ReviewError(`${where}: verifierFocus must list focus answers`)
  if (expectedDisproved === undefined) return { verifierFocus: focus }
  if (!Array.isArray(expectedDisproved)) {
    throw new ReviewError(`${where}: expectedDisproved must be an array`)
  }
  const pairs = expectedDisproved.map((entry: unknown, at): DisprovedPair => {
    const here = `${where}.expectedDisproved[${at}]`
    const { check, finding } = (entry ?? {}) as Json
    if (!index(check) || check >= focus.length) {
      throw new ReviewError(`${here}: check must be a position in verifierFocus`)
    }
    if (!index(finding)) throw new ReviewError(`${here}: finding must be a non-negative integer`)
    return { check, finding }
  })
  return { verifierFocus: focus, expectedDisproved: pairs }
}

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { parseReviewInput, type Finding } from './finding.mts'
import type { Question } from './question.mts'
import type { Write } from './write-diff.mts'

/**
 * `earlier.json`, written by `prepare` when this machine holds a whole review of an earlier head
 * that was never posted and git proved the push since is light. The findings and questions are
 * that review's, as its `review.json` saved them.
 */
export type EarlierFile = {
  sha: string
  /** The earlier review's run directory, where its saved evidence is. */
  runDir: string
  verdict: string | null
  findings: Finding[]
  questions: Question[]
}

const EARLIER_FILE = 'earlier.json'

export function clearEarlier(out: string): void {
  rmSync(join(out, EARLIER_FILE), { force: true })
}

export function writeEarlier(out: string, file: EarlierFile, write: Write): void {
  write(join(out, EARLIER_FILE), `${JSON.stringify(file, null, 2)}\n`)
}

/** Reads `earlier.json`; undefined when `prepare` found no unposted review to build on. */
export function readEarlierFile(out: string): EarlierFile | undefined {
  const path = join(out, EARLIER_FILE)
  if (!existsSync(path)) return undefined
  const raw = JSON.parse(readFileSync(path, 'utf8')) as EarlierFile
  const { findings, questions } = parseReviewInput({
    findings: raw.findings,
    questions: raw.questions,
  })
  return { ...raw, findings, questions }
}

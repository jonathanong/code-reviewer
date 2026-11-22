import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearComplete, completedHead, markComplete } from './complete-file.mts'
import { clearEarlier, readEarlierFile, writeEarlier } from './earlier-file.mts'
import { EARLIER_HEAD, FINDING, QUESTION, RUN_DIR } from './earlier-fake-io.mts'
import { ReviewError } from './finding.mts'

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'earlier-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

describe('the completion mark', () => {
  it('names the head of a finished review until the next run clears it', () => {
    expect(completedHead(read, out)).toBeUndefined()
    markComplete(out, EARLIER_HEAD)
    expect(completedHead(read, out)).toBe(EARLIER_HEAD)
    clearComplete(out)
    expect(completedHead(read, out)).toBeUndefined()
  })
})

describe('earlier.json', () => {
  const file = {
    sha: EARLIER_HEAD,
    runDir: RUN_DIR,
    verdict: 'Comment',
    findings: [FINDING],
    questions: [QUESTION],
  }

  it('round-trips the findings and questions, and is gone once cleared', () => {
    expect(readEarlierFile(out)).toBeUndefined()
    writeEarlier(out, file, (path, text) => writeFileSync(path, text))
    expect(readEarlierFile(out)).toEqual(file)
    clearEarlier(out)
    expect(readEarlierFile(out)).toBeUndefined()
  })

  it('refuses a file whose findings are not a review', () => {
    writeFileSync(join(out, 'earlier.json'), JSON.stringify({ ...file, findings: [{}] }))
    expect(() => readEarlierFile(out)).toThrow(ReviewError)
  })
})

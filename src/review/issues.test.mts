import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearIssues, ISSUES_FILE, readIssues } from './issues.mts'

describe('issues.json', () => {
  let out: string
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'issues-'))
  })
  afterEach(() => rmSync(out, { recursive: true, force: true }))

  it('reads what prepare wrote, is undefined without it, and is cleared on a rerun', () => {
    const issues = [{ ref: 'a/b#1', state: 'open', title: 'T', body: 'B' }]
    expect(readIssues(out)).toBeUndefined()
    writeFileSync(join(out, ISSUES_FILE), JSON.stringify(issues))
    expect(readIssues(out)).toEqual(issues)
    clearIssues(out)
    expect(readIssues(out)).toBeUndefined()
  })
})

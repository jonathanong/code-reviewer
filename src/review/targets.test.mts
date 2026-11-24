import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ReviewError } from './finding.mts'
import { builtInTargetNames, builtInTargets, loadTargets, parseTargetFile } from './targets.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const VALID = [
  '---',
  'name: check-guard',
  'when: The change adds a concurrency guard.',
  '---',
  '',
  'Check whether two runs can overlap. Keep this text verbatim.',
].join('\n')

describe('parseTargetFile', () => {
  it('reads name, normalized when, and verbatim trimmed body', () => {
    expect(parseTargetFile(VALID, 'check-guard.md')).toEqual({
      name: 'check-guard',
      when: 'The change adds a concurrency guard.',
      point: 'Check whether two runs can overlap. Keep this text verbatim.',
    })
  })

  it.each([
    ['no frontmatter', 'just body', 'begin with YAML frontmatter'],
    ['bad yaml', '---\nname: [unclosed\n---\nbody', 'invalid frontmatter'],
    ['scalar frontmatter', '---\nhello\n---\nbody', 'must be a mapping'],
    ['unknown key', '---\nname: ok\nwhen: x\nextra: 1\n---\nbody', 'unknown frontmatter key extra'],
    ['bad name', '---\nname: BadName\nwhen: x\n---\nbody', 'name must match'],
    ['empty when', '---\nname: ok\nwhen: "  "\n---\nbody', 'when must be a non-empty string'],
    ['empty body', '---\nname: ok\nwhen: x\n---\n   \n', 'body must not be empty'],
    ['two paragraphs', '---\nname: ok\nwhen: x\n---\nfirst\n\nsecond\n', 'must be one paragraph'],
    ['over 500 chars', `---\nname: ok\nwhen: x\n---\n${'a'.repeat(501)}\n`, 'max is 500'],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseTargetFile(text, 'f.md')).toThrow(ReviewError)
    expect(() => parseTargetFile(text, 'f.md')).toThrow(message)
  })
})

describe('loadTargets', () => {
  it('returns empty when the targets directory does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'targets-empty-'))
    dirs.push(dir)
    expect(loadTargets(dir)).toEqual([])
  })

  it('loads markdown targets sorted by name and ignores other files or subdirectories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'targets-load-'))
    dirs.push(dir)
    const targetsDir = join(dir, 'targets')
    mkdirSync(join(targetsDir, 'nested'), { recursive: true })
    writeFileSync(join(targetsDir, 'notes.txt'), 'ignored')
    writeFileSync(join(targetsDir, 'b.md'), '---\nname: zebra\nwhen: Z.\n---\nCheck zebra.\n')
    writeFileSync(join(targetsDir, 'a.md'), '---\nname: alpha\nwhen: A.\n---\nCheck alpha.\n')
    expect(loadTargets(dir).map((target) => target.name)).toEqual(['alpha', 'zebra'])
  })

  it('rejects duplicate target names across files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'targets-dup-'))
    dirs.push(dir)
    const targetsDir = join(dir, 'targets')
    mkdirSync(targetsDir, { recursive: true })
    writeFileSync(join(targetsDir, 'a.md'), VALID)
    writeFileSync(join(targetsDir, 'b.md'), VALID)
    expect(() => loadTargets(dir)).toThrow('duplicate target name "check-guard"')
  })
})

describe('builtInTargets', () => {
  it('ships unneeded-concurrency-guard with its verbatim point text', () => {
    expect(builtInTargetNames()).toContain('unneeded-concurrency-guard')
    const guard = builtInTargets().find((target) => target.name === 'unneeded-concurrency-guard')
    expect(guard).toEqual({
      name: 'unneeded-concurrency-guard',
      when: 'The change adds a new lock, compare-and-set, retry on conflict, or other guard against two runs of the same code overlapping. Not when it only removes, moves or renames an existing one.',
      point:
        'The change adds a guard against two runs of the same code overlapping. Find every caller of the guarded code and how each is scheduled or enqueued, then look for what already serialises them: a queue ordering or group key with concurrency 1, a fixed job id or dedupe key, a single schedule, a unique constraint, an existing lock. Claim to test: two runs can overlap, so the guard is needed.',
    })
  })
})

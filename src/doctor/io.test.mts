import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { NO_CONFIGS } from '../review/rules/config.mts'
import { createDoctorIo, enginesNode, realFs } from './io.mts'

const FIXTURES = resolve(import.meta.dirname, 'fixtures')
const TREE = join(FIXTURES, 'tree')
const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('realFs', () => {
  it('reads files and directories, and reports absence as undefined', () => {
    expect(realFs.readText(join(TREE, 'file.txt'))).toBe('hi\n')
    expect(realFs.readText(join(TREE, 'nope'))).toBeUndefined()
    expect(realFs.list(join(TREE, 'dir'))).toEqual(['.keep'])
    expect(realFs.list(join(TREE, 'nope'))).toBeUndefined()
    expect(realFs.mtimeMs(TREE)).toBeGreaterThan(0)
    expect(realFs.mtimeMs(join(TREE, 'nope'))).toBeUndefined()
    expect(realFs.isDirectory(TREE)).toBe(true)
    expect(realFs.isDirectory(join(TREE, 'file.txt'))).toBe(false)
  })

  it('rethrows an error that is not absence', () => {
    const file = join(TREE, 'file.txt')
    expect(() => realFs.mtimeMs(join(file, 'under'))).toThrow()
    expect(() => realFs.list(file)).toThrow()
    expect(() => realFs.readText(TREE)).toThrow()
  })

  it('asks whether a path is writable without creating anything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-'))
    made.push(dir)
    expect(realFs.writable(dir)).toBe(true)
    chmodSync(dir, 0o500)
    expect(realFs.writable(dir)).toBe(process.getuid?.() === 0)
    chmodSync(dir, 0o700)
    expect(realFs.writable(join(dir, 'missing'))).toBe(false)
    expect(realFs.list(dir)).toEqual([])
  })
})

describe('enginesNode', () => {
  it('reads the range from package.json', () => {
    expect(enginesNode(() => join(FIXTURES, 'root-with-engines'))).toBe('>=99')
  })

  it('is empty when there is no range or no manifest', () => {
    expect(enginesNode(() => join(FIXTURES, 'root-without-engines'))).toBe('')
    expect(enginesNode(() => join(FIXTURES, 'no-such-root'))).toBe('')
    expect(
      enginesNode(() => {
        throw new Error('no plugin root')
      }),
    ).toBe('')
  })

  it("defaults to this package's own range", () => {
    expect(enginesNode()).toBe('>=24')
  })
})

describe('createDoctorIo', () => {
  it('resolves the directories from the environment', () => {
    const exec = async () => ''
    const io = createDoctorIo(
      { exec, configs: () => NO_CONFIGS, authModeFor: async () => 'gh' },
      {
        HOME: '/home/u',
        XDG_CONFIG_HOME: '/cfg',
        CODE_REVIEWER_STATE_DIR: '/state',
        CLAUDE_CONFIG_DIR: '/claude',
      },
    )
    expect(io).toMatchObject({
      configDir: '/cfg/code-reviewer/repos',
      stateDir: '/state',
      claudeHome: '/claude',
      nodeVersion: process.versions.node,
      exec,
    })
    expect(io.loadApp()).toBeUndefined()
    expect(io.now().getTime()).toBeGreaterThan(0)
    expect(
      createDoctorIo(
        { exec, configs: () => NO_CONFIGS, authModeFor: async () => 'gh' },
        { HOME: '/home/u' },
      ).claudeHome,
    ).toBe('/home/u/.claude')
  })

  it('finds no clone under a root with none', async () => {
    const io = createDoctorIo(
      { exec: async () => '', configs: () => NO_CONFIGS, authModeFor: async () => 'gh' },
      {},
    )
    expect(await io.findClone(TREE, 'acme/widgets')).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'

import { parsePnpmLockfile } from './lockfile.mts'
import { compareVersions, crossesPreOne, isPackageName, parseVersion } from './version.mts'

const V9 = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      left-pad:
        specifier: ^1.0.0
        version: 1.3.0

packages:

  '@atproto/oauth-types@0.8.0':
    resolution: {integrity: sha512-AAAA}

  react-dom@18.2.0(react@18.2.0):
    resolution: {integrity: sha512-BBBB}

  react-dom@17.0.0:
    resolution: {integrity: sha512-CCCC}

  gitdep@1.0.0:
    resolution: {tarball: https://example.com/gitdep.tgz}

  fromgit@2.0.0:
    resolution: {commit: abcdef, repo: https://github.com/a/b}

  'https://example.com/x.tgz':
    resolution: {integrity: sha512-DDDD}

  Upper@1.0.0:
    resolution: {integrity: sha512-EEEE}

  loose@1.0.0:
    resolution: {integrity: not-sha512}

snapshots:

  ignored@9.9.9:
    resolution: {integrity: sha512-FFFF}
`

describe('parsePnpmLockfile', () => {
  it('reads registry packages with their integrity, peers stripped, several versions kept', () => {
    const { packages, problem } = parsePnpmLockfile(V9)
    expect(problem).toBeUndefined()
    expect(packages.get('@atproto/oauth-types')?.get('0.8.0')).toEqual({ integrity: 'sha512-AAAA' })
    expect([...(packages.get('react-dom')?.keys() ?? [])].toSorted()).toEqual(['17.0.0', '18.2.0'])
    expect(packages.get('loose')?.get('1.0.0')).toEqual({ integrity: undefined })
  })

  it('counts the entries it leaves out, so a caller can say they were not compared', () => {
    expect(parsePnpmLockfile(V9).ignored).toBeGreaterThan(0)
    expect(parsePnpmLockfile("lockfileVersion: '9.0'\npackages:\n").ignored).toBe(0)
  })

  it('leaves out non-registry resolutions, invalid names and versions, and other sections', () => {
    const names = [...parsePnpmLockfile(V9).packages.keys()]
    expect(names.toSorted()).toEqual(['@atproto/oauth-types', 'loose', 'react-dom'])
  })

  it('reads the version 6 key form with a leading slash and a quoted key', () => {
    const text = `lockfileVersion: '6.0'\npackages:\n  /@scope/name@1.2.3(peer@1.0.0):\n    resolution: {integrity: sha512-A}\n  "/other@2.0.0":\n    resolution: {integrity: sha512-B}\n`
    const { packages } = parsePnpmLockfile(text)
    expect(packages.get('@scope/name')?.has('1.2.3')).toBe(true)
    expect(packages.get('other')?.has('2.0.0')).toBe(true)
  })

  it.each([
    ['an old lockfile', "lockfileVersion: '5.4'\npackages:\n  /a/1.0.0:\n", '5 is not read'],
    ['no version', 'packages:\n', '(none)'],
  ])('reports %s as a problem and reads nothing', (_name, text, expected) => {
    const parsed = parsePnpmLockfile(text)
    expect(parsed.packages.size).toBe(0)
    expect(parsed.problem).toContain(expected)
  })
})

describe('versions', () => {
  it('parses and orders versions, and rejects anything else', () => {
    const [a, b] = [parseVersion('0.8.0'), parseVersion('0.10.1-beta.1')]
    expect(a).toMatchObject({ major: 0, minor: 8, patch: 0 })
    expect(compareVersions(a!, b!)).toBeLessThan(0)
    for (const bad of ['1.2', 'latest', '1.2.3.4', 'https://x/y.tgz', '1.2.3\n']) {
      expect(parseVersion(bad)).toBeUndefined()
    }
  })

  it('crosses pre-1.0 on a minor, or on leaving 0.x, never on a patch or after 1.0', () => {
    const cross = (from: string, to: string) =>
      crossesPreOne(parseVersion(from)!, parseVersion(to)!)
    expect(cross('0.7.1', '0.8.0')).toBe(true)
    expect(cross('0.8.0', '0.7.1')).toBe(true)
    expect(cross('0.9.4', '1.0.0')).toBe(true)
    expect(cross('0.8.0', '0.8.1')).toBe(false)
    expect(cross('1.2.0', '1.3.0')).toBe(false)
  })

  it('accepts registry package names only', () => {
    expect(isPackageName('@atproto/oauth-types')).toBe(true)
    for (const bad of ['', 'Upper', '../x', 'a/b', '@s/', 'a b', 'x'.repeat(215)]) {
      expect(isPackageName(bad)).toBe(false)
    }
  })
})

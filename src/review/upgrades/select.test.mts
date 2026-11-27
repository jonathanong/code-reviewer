import { describe, expect, it } from 'vitest'

import type { LockedPackages } from './lockfile.mts'
import { capUpgrades, isSecurityPackage, MAX_PACKAGES, selectUpgrades } from './select.mts'

const locked = (spec: Record<string, string[]>): LockedPackages =>
  new Map(
    Object.entries(spec).map(([name, versions]) => [
      name,
      new Map(versions.map((version) => [version, { integrity: `sha512-${name}${version}` }])),
    ]),
  )

const pick = (
  base: Record<string, string[]>,
  head: Record<string, string[]>,
  extra: string[] = [],
) => selectUpgrades(locked(base), locked(head), extra)

describe('selectUpgrades', () => {
  it('picks a transitive pre-1.0 minor bump, as in the oauth-types miss', () => {
    const { selected } = pick(
      { '@atproto/oauth-types': ['0.7.1'], 'left-pad': ['1.0.0'] },
      { '@atproto/oauth-types': ['0.8.0'], 'left-pad': ['1.1.0'] },
    )
    expect(selected).toHaveLength(1)
    expect(selected[0]).toMatchObject({
      name: '@atproto/oauth-types',
      reasons: ['security', 'pre-1.0'],
      fromIntegrity: 'sha512-@atproto/oauth-types0.7.1',
      toIntegrity: 'sha512-@atproto/oauth-types0.8.0',
    })
  })

  it('does not pick a pre-1.0 patch bump or a stable package off a security path', () => {
    expect(
      pick({ tiny: ['0.3.1'], big: ['2.0.0'] }, { tiny: ['0.3.2'], big: ['3.0.0'] }).selected,
    ).toEqual([])
  })

  it('picks an auth package on any change, and says why', () => {
    const { selected } = pick({ jsonwebtoken: ['9.0.1'] }, { jsonwebtoken: ['9.0.2'] })
    expect(selected.map((upgrade) => upgrade.reasons)).toEqual([['security']])
  })

  it('pairs each new version with the newest removed one of its major, among several versions', () => {
    const { selected } = pick(
      { 'next-auth': ['3.1.0', '4.0.0', '4.1.0'], weird: ['0.1.0', '1.0.0'] },
      { 'next-auth': ['3.1.0', '4.2.0'], weird: ['0.2.0', '1.0.0'] },
    )
    expect(selected.map((u) => `${u.name} ${u.from.text} ${u.to.text}`)).toEqual([
      'next-auth 4.1.0 4.2.0',
      'weird 0.1.0 0.2.0',
    ])
  })

  it('falls back to the newest lower version when the major is new, and skips a new version with none lower', () => {
    expect(pick({ passport: ['0.9.0'] }, { passport: ['1.0.0'] }).selected).toHaveLength(1)
    expect(pick({ passport: ['2.0.0'] }, { passport: ['1.0.0'] }).selected).toEqual([])
  })

  it('counts packages added or removed outright as unpaired and picks none of them', () => {
    const result = pick(
      { 'old-auth': ['1.0.0'], same: ['1.0.0'] },
      { 'new-auth': ['1.0.0'], same: ['1.0.0'] },
    )
    expect(result).toEqual({ selected: [], unpaired: 2 })
  })

  it('counts a version added to a package that kept its old one as unpaired', () => {
    expect(pick({ session: ['1.0.0'] }, { session: ['1.0.0', '2.0.0'] }).unpaired).toBe(1)
  })

  it('takes configured globs as security packages', () => {
    expect(pick({ '@acme/kit': ['1.0.0'] }, { '@acme/kit': ['1.1.0'] }).selected).toEqual([])
    expect(
      pick({ '@acme/kit': ['1.0.0'] }, { '@acme/kit': ['1.1.0'] }, ['@acme/*']).selected,
    ).toHaveLength(1)
  })
})

describe('isSecurityPackage', () => {
  it('matches a name segment, not a substring', () => {
    for (const name of ['next-auth', '@atproto/oauth-client-node', 'express-session', 'bcrypt']) {
      expect(isSecurityPackage(name, [])).toBe(true)
    }
    for (const name of ['authors', 'author-list', 'sessions-store', 'left-pad']) {
      expect(isSecurityPackage(name, [])).toBe(false)
    }
  })
})

describe('capUpgrades', () => {
  it('keeps security packages first and the cap, and counts what it left out', () => {
    const upgrade = (name: string, reasons: ('security' | 'pre-1.0')[]) =>
      ({ name, reasons }) as Parameters<typeof capUpgrades>[0][number]
    const many = Array.from({ length: MAX_PACKAGES + 2 }, (_, i) =>
      upgrade(`p${String(i).padStart(2, '0')}`, ['pre-1.0']),
    )
    const { selected, omitted } = capUpgrades([...many, upgrade('zz-auth', ['security'])])
    expect(selected).toHaveLength(MAX_PACKAGES)
    expect(selected[0]?.name).toBe('zz-auth')
    expect(omitted).toBe(3)
    expect(capUpgrades([upgrade('a', ['pre-1.0'])]).omitted).toBe(0)
  })
})

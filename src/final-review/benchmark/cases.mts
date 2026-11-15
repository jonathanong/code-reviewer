import { resolve } from 'node:path'

import { FinalReviewError, PILLARS, SEVERITIES, type Pillar, type Severity } from '../finding.mts'

export type ExpectedFinding = {
  pillar: Pillar
  severity: Severity
  path: string | null
  lines: [number, number] | null
  claim: string
}

type CaseBase = {
  id: string
  title: string
  kind: 'positive' | 'negative'
  reason: string
  expected: ExpectedFinding[]
}

/** A real pull request, cloned and exported with git. */
export type RepoCase = CaseBase & {
  repo: string
  pr: number
  baseSha: string
  headSha: string
}

/** A synthetic case: a directory holding `base/`, `head/`, `pr.md`, and optional `context.md`. */
export type FixtureCase = CaseBase & {
  fixture: string
  fixtureDir: string
  /** The fixture repository's `owner/name`, for config files in `repos/` that name it. */
  repoId?: string
}

export type EvalCase = RepoCase | FixtureCase

export function isFixtureCase(item: EvalCase): item is FixtureCase {
  return 'fixture' in item
}

const REPO_FIELDS = ['repo', 'pr', 'baseSha', 'headSha'] as const

type Json = Record<string, unknown>

const SHA_RE = /^[0-9a-f]{40}$/u
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(where: string, message: string): never {
  throw new FinalReviewError(`${where}: ${message}`)
}

function str(record: Json, field: string, where: string): string {
  const value = record[field]
  if (typeof value !== 'string') fail(where, `${field} must be a string`)
  return value
}

function lines(value: unknown, where: string): [number, number] | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value) || value.length !== 2) fail(where, 'lines must be [start, end] or null')
  const [start, end] = value as unknown[]
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    (start as number) < 1 ||
    (end as number) < (start as number)
  ) {
    fail(where, 'lines must be ascending positive integers')
  }
  return [start as number, end as number]
}

function expected(raw: unknown, where: string): ExpectedFinding {
  if (!isRecord(raw)) fail(where, 'must be an object')
  const pillar = PILLARS.find((name) => name === raw.pillar) ?? fail(where, 'unknown pillar')
  const severity =
    SEVERITIES.find((name) => name === raw.severity) ?? fail(where, 'unknown severity')
  const path = typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : null
  return { pillar, severity, path, lines: lines(raw.lines, where), claim: str(raw, 'claim', where) }
}

function source(
  raw: Json,
  where: string,
  baseDir: string,
): Omit<RepoCase, keyof CaseBase> | Pick<FixtureCase, 'fixture' | 'fixtureDir' | 'repoId'> {
  if (raw.fixture !== undefined) {
    if (REPO_FIELDS.some((field) => raw[field] !== undefined))
      fail(where, 'a fixture case must not set repo, pr, baseSha, or headSha')
    const fixture = str(raw, 'fixture', where)
    if (fixture.length === 0) fail(where, 'fixture must be a directory')
    if (raw.repoId === undefined) return { fixture, fixtureDir: resolve(baseDir, fixture) }
    const repoId = str(raw, 'repoId', where)
    if (!REPO_RE.test(repoId)) fail(where, 'repoId must be owner/name')
    return { fixture, fixtureDir: resolve(baseDir, fixture), repoId }
  }
  const repo = str(raw, 'repo', where)
  if (!REPO_RE.test(repo)) fail(where, 'repo must be owner/name')
  const baseSha = str(raw, 'baseSha', where)
  const headSha = str(raw, 'headSha', where)
  if (!SHA_RE.test(baseSha) || !SHA_RE.test(headSha))
    fail(where, 'baseSha and headSha must be full SHAs')
  if (!Number.isInteger(raw.pr) || (raw.pr as number) <= 0)
    fail(where, 'pr must be a positive integer')
  return { repo, pr: raw.pr as number, baseSha, headSha }
}

function evalCase(raw: unknown, index: number, baseDir: string): EvalCase {
  const where = `cases[${index}]`
  if (!isRecord(raw)) fail(where, 'must be an object')
  const origin = source(raw, where, baseDir)
  if (raw.kind !== 'positive' && raw.kind !== 'negative')
    fail(where, 'kind must be positive or negative')
  const items = Array.isArray(raw.expected)
    ? raw.expected
    : fail(where, 'expected must be an array')
  const parsed = items.map((item, at) => expected(item, `${where}.expected[${at}]`))
  if (raw.kind === 'positive' && parsed.length === 0)
    fail(where, 'a positive case needs an expected finding')
  if (raw.kind === 'negative' && parsed.length > 0)
    fail(where, 'a negative case has no expected findings')
  return {
    id: str(raw, 'id', where),
    ...origin,
    title: str(raw, 'title', where),
    kind: raw.kind,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    expected: parsed,
  }
}

/** Parses labeled eval cases; ids must be unique. Fixture paths resolve against `baseDir`. */
export function parseEvalCases(raw: unknown, baseDir = '.'): EvalCase[] {
  if (!Array.isArray(raw)) throw new FinalReviewError('Eval cases must be a JSON array.')
  const cases = raw.map((item, index) => evalCase(item, index, baseDir))
  const seen = new Set<string>()
  for (const item of cases) {
    if (seen.has(item.id)) throw new FinalReviewError(`Duplicate eval case id: ${item.id}`)
    seen.add(item.id)
  }
  return cases
}

/** Cases that exercise one pillar: its positives plus every negative. */
export function casesForPillar(cases: readonly EvalCase[], pillar: Pillar): EvalCase[] {
  return cases.filter(
    (item) => item.kind === 'negative' || item.expected.some((entry) => entry.pillar === pillar),
  )
}

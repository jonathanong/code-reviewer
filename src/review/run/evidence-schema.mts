import { ReviewError } from '../finding.mts'
import { isObject } from '../../harness/json.mts'
import {
  EVIDENCE_EFFECTS,
  EVIDENCE_STATUSES,
  type EvidenceClaimNote,
  type EvidenceCommand,
  type EvidenceEffect,
  type EvidenceFindingNote,
  type EvidenceOutput,
  type EvidenceQuery,
  type EvidenceSourceReport,
  type EvidenceStatus,
} from './evidence-types.mts'

const COMMAND = {
  type: 'object',
  required: ['command', 'result'],
  additionalProperties: false,
  properties: { command: { type: 'string' }, result: { type: 'string' } },
} as const
const EFFECT = { type: 'string', enum: [...EVIDENCE_EFFECTS] } as const

/** Output schema of the evidence run. */
export const EVIDENCE_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['sources', 'findings', 'claims'],
  additionalProperties: false,
  properties: {
    sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'status', 'queries'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          status: { type: 'string', enum: [...EVIDENCE_STATUSES] },
          reason: { type: 'string' },
          queries: {
            type: 'array',
            items: {
              ...COMMAND,
              properties: { ...COMMAND.properties, control: COMMAND },
            },
          },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'effect', 'note'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          effect: EFFECT,
          note: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'effect', 'note'],
        additionalProperties: false,
        properties: { claim: { type: 'string' }, effect: EFFECT, note: { type: 'string' } },
      },
    },
  },
} as const

const LIMITS = { command: 1000, result: 2000, note: 300, reason: 500, claim: 500 }

function text(value: unknown, limit: number): string {
  const flat = (typeof value === 'string' ? value : '').replace(/\s+/gu, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

function array(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new ReviewError(`Evidence run returned no "${what}" array.`)
  return value
}

function entries(value: unknown, what: string): Record<string, unknown>[] {
  return array(value, what).filter((item) => isObject(item)) as Record<string, unknown>[]
}

function oneOf<T extends string>(values: readonly T[], value: unknown, what: string): T {
  const found = values.find((candidate) => candidate === value)
  if (found === undefined) throw new ReviewError(`Evidence run returned an invalid ${what}.`)
  return found
}

function commandOf(raw: unknown): EvidenceCommand | undefined {
  if (!isObject(raw)) return undefined
  const command = text(raw.command, LIMITS.command)
  return command === '' ? undefined : { command, result: text(raw.result, LIMITS.result) }
}

function queryOf(raw: unknown): EvidenceQuery | undefined {
  const query = commandOf(raw)
  const control = commandOf(isObject(raw) ? raw.control : undefined)
  return query === undefined
    ? undefined
    : { ...query, ...(control === undefined ? {} : { control }) }
}

/** `checked` needs a recorded query and `blocked` needs the error, or the answer is rejected. */
function sourceOf(raw: Record<string, unknown>): EvidenceSourceReport {
  const name = text(raw.name, 64)
  const status: EvidenceStatus = oneOf(EVIDENCE_STATUSES, raw.status, `status for "${name}"`)
  const queries = array(raw.queries, 'queries').flatMap((item) => queryOf(item) ?? [])
  const reason = text(raw.reason, LIMITS.reason)
  if (status === 'checked' && queries.length === 0) {
    throw new ReviewError(`Evidence source "${name}" is checked without a recorded query.`)
  }
  if (status === 'blocked' && reason === '') {
    throw new ReviewError(`Evidence source "${name}" is blocked without an error.`)
  }
  return { name, status, ...(reason === '' ? {} : { reason }), queries }
}

function effectOf(raw: Record<string, unknown>): EvidenceEffect {
  return oneOf(EVIDENCE_EFFECTS, raw.effect, 'effect')
}

/**
 * Validates the evidence run's answer. Sources and findings the run was not given are dropped; a
 * malformed shape, or a `checked` or `blocked` source without its proof, throws so the run is
 * retried.
 */
export function validateEvidenceOutput(
  structured: unknown,
  known: { sources: readonly string[]; findings: readonly string[] },
): EvidenceOutput {
  if (!isObject(structured)) throw new ReviewError('Evidence run returned no structured output.')
  const given = new Set<string>()
  const sources = entries(structured.sources, 'sources')
    .filter((item) => {
      const name = text(item.name, 64)
      const fresh = known.sources.includes(name) && !given.has(name)
      given.add(name)
      return fresh
    })
    .map(sourceOf)
  const findings = entries(structured.findings, 'findings')
    .filter((item) => known.findings.includes(text(item.id, 16)))
    .map((item): EvidenceFindingNote => {
      const named = Array.isArray(item.sources)
        ? item.sources.filter((name): name is string => known.sources.includes(name as string))
        : undefined
      return {
        id: text(item.id, 16),
        effect: effectOf(item),
        note: text(item.note, LIMITS.note),
        ...(named === undefined ? {} : { sources: named }),
      }
    })
  const claims = entries(structured.claims, 'claims').map((item): EvidenceClaimNote => ({
    claim: text(item.claim, LIMITS.claim),
    effect: effectOf(item),
    note: text(item.note, LIMITS.note),
  }))
  return { sources, findings, claims }
}

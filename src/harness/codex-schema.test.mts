import { describe, expect, it } from 'vitest'

import { APPROVAL_CHECK_SCHEMA } from '../review/run/approval-check-prompt.mts'
import { EVIDENCE_OUTPUT_SCHEMA } from '../review/run/evidence-schema.mts'
import { PILLAR_OUTPUT_SCHEMA } from '../review/run/pillar-schema.mts'
import { REVIEW_VERIFIER_SCHEMA } from '../review/run/verify.mts'
import { dropOptionalNulls, strictSchema } from './codex-schema.mts'

type Json = Record<string, unknown>

/** Every object schema reachable through properties, items and anyOf. */
function objects(node: unknown): Json[] {
  if (typeof node !== 'object' || node === null) return []
  const schema = node as Json
  const properties = Object.values((schema.properties ?? {}) as Json)
  const nested = [schema.items, ...((schema.anyOf ?? []) as unknown[]), ...properties]
  const here = schema.properties === undefined ? [] : [schema]
  return [...here, ...nested.flatMap(objects)]
}

describe('strictSchema', () => {
  const schema = {
    type: 'object',
    required: ['a'],
    properties: {
      a: { type: 'string' },
      b: { type: 'integer', minimum: 1 },
      c: { type: 'array', items: { type: 'object', properties: { d: { type: 'string' } } } },
      e: { anyOf: [{ type: 'object', properties: { f: { type: 'string' } } }, 5] },
    },
  }

  it('requires every property and forbids others', () => {
    expect(strictSchema(schema)).toMatchObject({
      required: ['a', 'b', 'c', 'e'],
      additionalProperties: false,
    })
  })

  it('leaves a required property as it was and makes an optional one accept null', () => {
    const strict = strictSchema(schema) as { properties: Json }
    expect(strict.properties.a).toStrictEqual({ type: 'string' })
    expect(strict.properties.b).toStrictEqual({
      anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
    })
  })

  it('reaches objects inside arrays and anyOf, and leaves non-schemas alone', () => {
    const nodes = objects(strictSchema(schema))
    expect(nodes.length).toBeGreaterThan(2)
    for (const node of nodes) {
      expect(node.additionalProperties).toBe(false)
      expect(node.required).toStrictEqual(Object.keys(node.properties as Json))
    }
    expect(strictSchema({ type: 'string' })).toStrictEqual({ type: 'string' })
  })

  it('does not change the schema it was given', () => {
    const copy = structuredClone(schema)
    strictSchema(schema)
    expect(schema).toStrictEqual(copy)
  })

  it.each([
    ['pillar', PILLAR_OUTPUT_SCHEMA],
    ['verifier', REVIEW_VERIFIER_SCHEMA],
    ['evidence', EVIDENCE_OUTPUT_SCHEMA],
    ['approval check', APPROVAL_CHECK_SCHEMA],
  ])('makes every object in the real %s schema strict', (_name, real) => {
    const nodes = objects(strictSchema(real))
    expect(nodes.length).toBeGreaterThan(1)
    for (const node of nodes) {
      expect(node.additionalProperties).toBe(false)
      expect([...(node.required as string[])].sort()).toStrictEqual(
        Object.keys(node.properties as Json).sort(),
      )
    }
  })

  it('makes the real pillar schema optional properties nullable', () => {
    const strict = strictSchema(PILLAR_OUTPUT_SCHEMA) as {
      properties: { findings: { items: { properties: Json } } }
    }
    expect(strict.properties.findings.items.properties.path).toStrictEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    })
    expect(strict.properties.findings.items.properties.title).toStrictEqual({ type: 'string' })
  })
})

describe('dropOptionalNulls', () => {
  const schema = {
    type: 'object',
    required: ['a'],
    properties: {
      a: { type: 'string' },
      b: { type: 'string' },
      list: {
        type: 'array',
        items: { type: 'object', required: ['x'], properties: { x: {}, y: {} } },
      },
    },
  }

  it('drops a null the schema left optional, at any depth, and keeps the rest', () => {
    const answer = { a: 'k', b: null, list: [{ x: 1, y: null }, { x: null }], extra: null }
    expect(dropOptionalNulls(answer, schema)).toStrictEqual({
      a: 'k',
      list: [{ x: 1 }, { x: null }],
      extra: null,
    })
  })

  it('returns values the schema does not describe as they are', () => {
    expect(dropOptionalNulls([1, null], {})).toStrictEqual([1, null])
    expect(dropOptionalNulls('x', schema)).toBe('x')
    expect(dropOptionalNulls({ a: null }, { type: 'object' })).toStrictEqual({ a: null })
    expect(dropOptionalNulls([{ a: null }], { type: 'array' })).toStrictEqual([{ a: null }])
  })
})

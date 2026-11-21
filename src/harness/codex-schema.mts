import { isObject } from './json.mts'

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => isObject(value) && !Array.isArray(value)

function requiredKeys(schema: Json): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : []
}

function strictNode(node: unknown): unknown {
  if (!isRecord(node)) return node
  const out: Json = { ...node }
  if (isRecord(node.items)) out.items = strictNode(node.items)
  if (Array.isArray(node.anyOf)) out.anyOf = node.anyOf.map(strictNode)
  if (!isRecord(node.properties)) return out
  const required = new Set(requiredKeys(node))
  const properties = Object.entries(node.properties).map(([key, value]): [string, unknown] => {
    const strict = strictNode(value)
    return [key, required.has(key) ? strict : { anyOf: [strict, { type: 'null' }] }]
  })
  out.properties = Object.fromEntries(properties)
  out.required = properties.map(([key]) => key)
  out.additionalProperties = false
  return out
}

/**
 * The schema in the form Codex's strict structured outputs accept: every object lists all its
 * properties as required and forbids others, and a property that was optional also accepts null.
 * Other keywords are left as they are.
 */
export function strictSchema(schema: object): object {
  return strictNode(schema) as object
}

/** The answer without the null a strict schema forced on each property the original left optional. */
export function dropOptionalNulls(value: unknown, schema: unknown): unknown {
  if (!isRecord(schema)) return value
  if (Array.isArray(value) && isRecord(schema.items)) {
    return value.map((item) => dropOptionalNulls(item, schema.items))
  }
  if (!isRecord(value) || !isRecord(schema.properties)) return value
  const properties = schema.properties
  const required = new Set(requiredKeys(schema))
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => entry !== null || required.has(key) || !(key in properties))
      .map(([key, entry]) => [key, dropOptionalNulls(entry, properties[key])]),
  )
}

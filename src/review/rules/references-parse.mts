import { isRecord, unknownKeys, type Json } from './settings-parse.mts'

/** A site the reviewer may read documentation from, and the only hosts it may fetch for it. */
export type ReferenceSource = {
  name: string
  description: string
  /** Lowercase hostnames; each becomes one `WebFetch(domain:<host>)` allow rule. */
  domains: string[]
}

const SOURCE_KEYS = ['name', 'description', 'domains']
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
// At least two labels and an alphabetic top-level label: no bare TLD, no IP address, no wildcard.
const HOST_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z]{2,63}$`, 'u')
const MAX_HOST = 253
const MAX_DESCRIPTION = 300

function domains(raw: unknown): string[] | string {
  const list: unknown[] = Array.isArray(raw) ? raw : []
  if (list.length === 0) return '"domains" must be a non-empty array of hostnames'
  const hosts = list.map((entry) => (typeof entry === 'string' ? entry : ''))
  const valid = hosts.every((host) => host.length <= MAX_HOST && HOST_RE.test(host))
  if (!valid) {
    return 'every domain must be a lowercase hostname such as docs.example.com, with no scheme, port, path or wildcard'
  }
  return [...new Set(hosts)]
}

/** One source, or the reason it is dropped. */
function source(raw: Json): ReferenceSource | string {
  const { name, description } = raw
  if (typeof name !== 'string' || !NAME_RE.test(name)) return '"name" must be a simple identifier'
  const oneLine = typeof description === 'string' ? description.replace(/\s+/gu, ' ').trim() : ''
  if (oneLine === '' || oneLine.length > MAX_DESCRIPTION) {
    return `"description" must be one line of at most ${MAX_DESCRIPTION} characters`
  }
  const hosts = domains(raw.domains)
  if (typeof hosts === 'string') return hosts
  return { name, description: oneLine, domains: hosts }
}

/**
 * Parses a `references` list. A bad source is dropped with a problem and the rest stay; a list in
 * which every source is bad is ignored as a whole, so a typo falls back to the layer below instead
 * of switching references off.
 */
export function parseReferences(
  raw: unknown,
  where: string,
  problems: string[],
): ReferenceSource[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be an array; ignored`)
    return undefined
  }
  const sources: ReferenceSource[] = []
  raw.forEach((item: unknown, index) => {
    const here = `${where}[${index}]`
    if (!isRecord(item)) {
      problems.push(`${here}: must be an object; reference ignored`)
      return
    }
    problems.push(...unknownKeys(item, SOURCE_KEYS, here))
    const parsed = source(item)
    if (typeof parsed === 'string') {
      problems.push(`${here}: ${parsed}; reference ignored`)
    } else if (sources.some((known) => known.name.toLowerCase() === parsed.name.toLowerCase())) {
      problems.push(`${here}: name "${parsed.name}" is already used; reference ignored`)
    } else {
      sources.push(parsed)
    }
  })
  return sources.length === 0 && raw.length > 0 ? undefined : sources
}

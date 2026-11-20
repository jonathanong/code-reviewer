const BODY_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input'])

/** `gh api` flags that take a value, so the value is not mistaken for the endpoint. */
const VALUE_FLAGS = new Set([
  ...BODY_FLAGS,
  '--method',
  '-X',
  '-q',
  '--jq',
  '-H',
  '--header',
  '--hostname',
  '-t',
  '--template',
  '--cache',
])

/** Reads a `gh pr` run can repeat freely. */
const READ_COMMANDS = new Set(['view', 'diff', 'list', 'status'])

/** Writes that leave GitHub in the same state when applied twice. */
const IDEMPOTENT_WRITES: readonly { method: string; path: RegExp }[] = [
  // Adding a label that is already there changes nothing.
  { method: 'POST', path: /\/issues\/\d+\/labels$/u },
  // A commit status is set, and the newest one wins.
  { method: 'POST', path: /\/statuses\/[0-9a-f]{40}$/u },
  // Dismissing one named review; dismissing it again leaves it dismissed.
  { method: 'PUT', path: /\/pulls\/\d+\/reviews\/\d+\/dismissals$/u },
]

export type CallKind = 'read' | 'idempotent-write' | 'write'

type ApiCall = { method: string; endpoint: string; hasBody: boolean; query: string | undefined }

function parseApi(args: readonly string[]): ApiCall {
  let method = ''
  let endpoint = ''
  let query: string | undefined
  for (let at = 1; at < args.length; at += 1) {
    const arg = String(args[at])
    const value = String(args[at + 1] ?? '')
    if (arg === '--method' || arg === '-X') method = value.toUpperCase()
    if (arg === '-f' && value.startsWith('query=')) query = value
    if (VALUE_FLAGS.has(arg)) at += 1
    else if (!arg.startsWith('-') && endpoint === '') endpoint = arg
  }
  return { method, endpoint, hasBody: args.some((arg) => BODY_FLAGS.has(arg)), query }
}

/**
 * What a `gh` call does, read from its arguments. Only a read or an idempotent write is retried
 * automatically. Anything unrecognised is a `write`, the safe side: a review POST that timed out
 * may have landed, and repeating a check-run POST would make a second check run.
 */
export function callKind(args: readonly string[]): CallKind {
  const [command, subcommand = ''] = args
  if (command === 'pr') return READ_COMMANDS.has(subcommand) ? 'read' : 'write'
  if (command !== 'api') return 'write'
  const { method, endpoint, hasBody, query } = parseApi(args)
  if (endpoint === '') return 'write'
  if (endpoint === 'graphql' && query !== undefined) {
    return /\bmutation\b/u.test(query) ? 'write' : 'read'
  }
  if (method === 'DELETE') return 'idempotent-write'
  if ((method === '' || method === 'GET') && !hasBody) return 'read'
  const path = endpoint.replace(/\?.*$/u, '')
  const same = IDEMPOTENT_WRITES.some((write) => write.method === method && write.path.test(path))
  return same ? 'idempotent-write' : 'write'
}

/**
 * Whether a failed repeat of an idempotent write only means an earlier try already did the job:
 * a DELETE whose target is gone (404), or a dismissal of a review that is already dismissed (422
 * saying so). Only a repeat qualifies; on a first try the same answer is a real error.
 */
export function settledByEarlierTry(
  args: readonly string[],
  reason: string,
  text: string,
): boolean {
  const { method, endpoint } = parseApi(args)
  if (method === 'DELETE') return reason === 'HTTP 404'
  const dismissal = IDEMPOTENT_WRITES[2]?.path.test(endpoint) === true
  return method === 'PUT' && dismissal && reason === 'HTTP 422' && /dismissed/iu.test(text)
}

import { oneOf, ReviewError, text, type Finding } from './finding.mts'

type Json = Record<string, unknown>

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ReviewError(`${field} must be a positive integer.`)
  }
  return value
}

export function parseLocation(record: Json, where: string): Partial<Finding> {
  if (record.path === undefined) {
    if (record.line !== undefined) throw new ReviewError(`${where}.line needs a path.`)
    return {}
  }
  const path = text(record, 'path', where)
  if (path.includes('\0')) throw new ReviewError(`${where}.path is invalid.`)
  if (record.line === undefined) return { path }
  const line = positiveInt(record.line, `${where}.line`)
  const side =
    record.side === undefined ? 'RIGHT' : oneOf(['LEFT', 'RIGHT'], record.side, `${where}.side`)
  if (record.startLine === undefined) return { path, line, side }
  const startLine = positiveInt(record.startLine, `${where}.startLine`)
  // Models often send a one-line range or reversed bounds; normalize instead of rejecting.
  if (startLine === line) return { path, line, side }
  if (startLine > line) return { path, line: startLine, side, startLine: line }
  return { path, line, side, startLine }
}

export class PolicyError extends Error {}

export type Operand = number | string
export type Op = '==' | '!=' | '<' | '>' | '<=' | '>='

const ORDER = ['low', 'medium', 'high']

function rank(value: Operand): number {
  if (typeof value === 'number') return value
  const index = ORDER.indexOf(value)
  if (index === -1) throw new PolicyError(`not an ordinal: ${value}`)
  return index
}

export function evalCondition(left: Operand, op: Op, right: Operand): boolean {
  if (op === '==') return left === right
  if (op === '!=') return left !== right
  if (op === '<' || op === '>' || op === '<=' || op === '>=') {
    if (typeof left !== typeof right)
      throw new PolicyError(`cannot order ${typeof left} against ${typeof right}`)
    const a = rank(left)
    const b = rank(right)
    if (op === '<') return a < b
    if (op === '>') return a > b
    if (op === '<=') return a <= b
    return a >= b
  }
  throw new PolicyError(`unknown operator ${String(op)}`)
}

export class PolicyError extends Error {}

export type Operand = number | string
export type Op = '==' | '!='

export function evalCondition(left: Operand, op: Op, right: Operand): boolean {
  if (op === '==') return left === right
  if (op === '!=') return left !== right
  throw new PolicyError(`unknown operator ${String(op)}`)
}

export type Callee = {
  type: 'Identifier' | 'CallExpression'
  name?: string
  callee?: Callee
  arguments?: Callee[]
}
export type CallNode = { callee: Callee; arguments: unknown[] }

// A mock factory is the second argument of `mock(...)`, or of `hoisted(mock)(...)`: the name
// `mock` may be the callee itself or an argument of the wrapper call that produces the callee.
function namesMock(callee: Callee): boolean {
  if (callee.type === 'Identifier') return callee.name === 'mock'
  return (
    (callee.arguments ?? []).some(namesMock) ||
    (callee.callee !== undefined && namesMock(callee.callee))
  )
}

export function isMockFactoryCall(node: CallNode): boolean {
  return namesMock(node.callee)
}

export function factoryOf(node: CallNode): unknown {
  return isMockFactoryCall(node) ? node.arguments[1] : undefined
}

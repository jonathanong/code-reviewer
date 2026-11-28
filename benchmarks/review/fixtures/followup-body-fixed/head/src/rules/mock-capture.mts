export type CallNode = {
  callee: { type: 'Identifier' | 'CallExpression'; name?: string; callee?: CallNode['callee'] }
  arguments: unknown[]
}

// A mock factory is the second argument of `mock(...)`; the rule reports state it shares.
export function isMockFactoryCall(node: CallNode): boolean {
  let callee = node.callee
  while (callee.type === 'CallExpression' && callee.callee !== undefined) callee = callee.callee
  return callee.type === 'Identifier' && callee.name === 'mock'
}

export function factoryOf(node: CallNode): unknown {
  return isMockFactoryCall(node) ? node.arguments[1] : undefined
}

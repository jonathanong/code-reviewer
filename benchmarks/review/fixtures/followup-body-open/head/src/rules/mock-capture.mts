export type CallNode = {
  callee: { type: 'Identifier' | 'CallExpression'; name?: string; callee?: CallNode['callee'] }
  arguments: unknown[]
}

// A mock factory is the second argument of `mock(...)`; the rule reports state it shares.
export function isMockFactoryCall(node: CallNode): boolean {
  return node.callee.type === 'Identifier' && node.callee.name === 'mock'
}

export function factoryOf(node: CallNode): unknown {
  return isMockFactoryCall(node) ? node.arguments[1] : undefined
}

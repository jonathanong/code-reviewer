export type Resolved = { kind: 'inline'; body: any } | { kind: 'unanalyzable'; node: any } | null

// The callback of a `test(...)` call: an inline function, or a function declared in this file.
export function resolveCallback(arg: any, scope: any): any {
  if (arg?.type === 'ArrowFunctionExpression' || arg?.type === 'FunctionExpression') return arg
  if (arg?.type === 'Identifier') {
    const def = scope.set.get(arg.name)?.defs[0]?.node
    if (def?.type === 'FunctionDeclaration') return def
  }
  return undefined
}

// Reports `run()` calls that are not awaited when `run` was destructured from a task runner
// (`const { run } = createRunner()`), because the runner's `run` returns a promise.

function findDeclarator(scope: any, name: string): any {
  for (let s = scope; s; s = s.upper) {
    const variable = s.set.get(name)
    if (variable) return variable.defs[0]?.node
  }
  return undefined
}

// The key the identifier `name` is bound from in `pattern`, or null for a computed key.
function boundKey(pattern: any, name: string): string | null {
  const match = pattern.properties.find(
    (property: any) =>
      property.type === 'Property' &&
      property.value.type === 'Identifier' &&
      property.value.name === name,
  )
  return match.computed ? null : match.key.name
}

export const noUnawaitedRun = {
  meta: { type: 'problem', messages: { unawaited: 'Await the runner call.' }, schema: [] },
  create(context: any) {
    return {
      CallExpression(node: any) {
        if (node.callee.type !== 'Identifier') return
        if (node.parent.type === 'AwaitExpression') return
        const declarator = findDeclarator(context.sourceCode.getScope(node), node.callee.name)
        if (declarator?.type !== 'VariableDeclarator') return
        if (declarator.id.type !== 'ObjectPattern') return
        if (boundKey(declarator.id, node.callee.name) === 'run') {
          context.report({ node, messageId: 'unawaited' })
        }
      },
    }
  },
}

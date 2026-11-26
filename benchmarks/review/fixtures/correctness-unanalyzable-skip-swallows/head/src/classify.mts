import { resolveCallback, type Resolved } from './resolve.mts'

const isStatic = (arg: any) => arg?.type === 'Literal' || arg?.type === 'TemplateLiteral'

// Classify a `test(name, fn)` or `test.skip(...)` call for the coverage rule.
export function classify(call: any, scope: any): Resolved {
  const [first, second] = call.arguments
  const callee = call.callee
  const isSkip = callee.type === 'MemberExpression' && callee.property.name === 'skip'
  // A skipped test with a runtime condition is not analyzed.
  if (isSkip && !isStatic(first)) return null
  const fn = resolveCallback(second, scope)
  if (!fn) return { kind: 'unanalyzable', node: call }
  return { kind: 'inline', body: fn.body }
}

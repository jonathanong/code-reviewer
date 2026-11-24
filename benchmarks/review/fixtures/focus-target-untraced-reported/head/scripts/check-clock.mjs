import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { listSources } from './list-sources.mjs'

const CLOCK = resolve('lib/clock.mjs')
const MAX_DEPTH = 8
// Registry packages cannot re-export lib/clock.mjs. Anything else that is not a relative path
// (a `#subpath` import, a workspace package) could, so it is not assumed clean.
const REGISTRY = new Set(Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).dependencies))

function isRegistryOrBuiltin(source) {
  if (source.startsWith('node:')) return true
  const parts = source.split('/')
  return REGISTRY.has(source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
}

function load(file, read) {
  try {
    return parse(read(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    return undefined
  }
}

/** Where a module's export `name` comes from: 'clock', 'other' or 'unknown'. */
function exportOrigin(file, name, read, depth) {
  if (file === CLOCK) return name === 'now' ? 'clock' : 'other'
  if (depth >= MAX_DEPTH) return 'unknown'
  const tree = load(file, read)
  if (tree === undefined) return 'unknown'
  const stars = []
  for (const node of tree.body) {
    if (node.type === 'ExportAllDeclaration') stars.push(node)
    if (node.type !== 'ExportNamedDeclaration') continue
    if (node.declaration?.type === 'FunctionDeclaration' && node.declaration.id.name === name) {
      // A wrapper function is its own call site; this file is checked for it.
      return 'other'
    }
    for (const decl of node.declaration?.declarations ?? []) {
      if (decl.id.type === 'Identifier' && decl.id.name === name) {
        return decl.init?.type === 'Identifier'
          ? localOrigin(file, tree, decl.init.name, read, depth + 1)
          : 'unknown'
      }
    }
    for (const spec of node.specifiers) {
      if (spec.exported.name !== name) continue
      return node.source === null
        ? localOrigin(file, tree, spec.local.name, read, depth + 1)
        : sourceOrigin(file, node.source.value, spec.local.name, read, depth + 1)
    }
  }
  // `export *` may or may not carry the name: every star must be ruled out.
  const viaStars = stars.map((star) => sourceOrigin(file, star.source.value, name, read, depth + 1))
  if (viaStars.includes('clock')) return 'clock'
  return 'unknown'
}

function sourceOrigin(file, source, name, read, depth) {
  if (!source.startsWith('.')) return isRegistryOrBuiltin(source) ? 'other' : 'unknown'
  return exportOrigin(resolve(dirname(file), source), name, read, depth)
}

/** Origin of a top-level binding `name` inside `file`. */
function localOrigin(file, tree, name, read, depth) {
  for (const node of tree.body) {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        if (spec.local.name !== name) continue
        if (spec.type === 'ImportNamespaceSpecifier') return 'unknown'
        const imported = spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported.name
        return sourceOrigin(file, node.source.value, imported, read, depth)
      }
    }
    if (node.type === 'FunctionDeclaration' && node.id.name === name) return 'other'
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type !== 'Identifier' || decl.id.name !== name) continue
        return decl.init?.type === 'Identifier'
          ? localOrigin(file, tree, decl.init.name, read, depth + 1)
          : 'unknown'
      }
    }
  }
  return 'unknown'
}

function importedNames(tree) {
  const names = new Map()
  for (const node of tree.body) {
    if (node.type !== 'ImportDeclaration') continue
    for (const spec of node.specifiers) names.set(spec.local.name, { node, spec })
  }
  return names
}

/** Top-level names holding the result of calling an imported function: `const t = make()`. */
function builtByImportedCall(tree, imports) {
  const built = new Map()
  for (const node of tree.body) {
    if (node.type !== 'VariableDeclaration') continue
    for (const decl of node.declarations) {
      const callee = decl.init?.type === 'CallExpression' ? decl.init.callee : undefined
      const root = callee?.type === 'MemberExpression' ? callee.object : callee
      if (decl.id.type === 'Identifier' && root?.type === 'Identifier' && imports.has(root.name)) {
        built.set(decl.id.name, imports.get(root.name).node.source.value)
      }
    }
  }
  return built
}

export function checkFile(file, read = readFileSync) {
  const path = resolve(file)
  const tree = load(path, read)
  if (tree === undefined) return [{ file, line: 1, kind: 'unresolved', name: file }]
  const imports = importedNames(tree)
  const built = builtByImportedCall(tree, imports)
  const problems = []
  const report = (node, name, origin) => {
    if (origin === 'other') return
    const kind = origin === 'clock' ? 'clock-call' : 'unresolved'
    problems.push({ file, line: lineOf(read(path, 'utf8'), node.start), kind, name })
  }
  simple(tree, {
    ImportExpression(node) {
      report(node, 'import()', 'unknown')
    },
    CallExpression(node) {
      const callee = node.callee
      const root = callee.type === 'MemberExpression' ? callee.object : callee
      const inner = root.type === 'CallExpression' ? root.callee : undefined
      const innerRoot = inner?.type === 'MemberExpression' ? inner.object : inner
      if (innerRoot?.type === 'Identifier' && imports.has(innerRoot.name)) {
        // `make()()` and `make().now()`: the same rule as a name holding the call's result.
        const source = imports.get(innerRoot.name).node.source.value
        report(node, `${innerRoot.name}()`, isRegistryOrBuiltin(source) ? 'other' : 'unknown')
        return
      }
      if (root.type === 'Identifier' && built.has(root.name)) {
        // What an imported function returned is not followed: clean only for a registry package.
        report(node, root.name, isRegistryOrBuiltin(built.get(root.name)) ? 'other' : 'unknown')
        return
      }
      if (callee.type === 'Identifier' && imports.has(callee.name)) {
        report(node, callee.name, localOrigin(path, tree, callee.name, read, 0))
      }
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        imports.has(callee.object.name)
      ) {
        const { node: decl, spec } = imports.get(callee.object.name)
        const member = callee.computed ? undefined : callee.property.name
        const label = `${callee.object.name}.${member ?? '[computed]'}`
        if (spec.type !== 'ImportNamespaceSpecifier') {
          // A method on an imported object is not followed: clean only for a registry package.
          report(node, label, isRegistryOrBuiltin(decl.source.value) ? 'other' : 'unknown')
          return
        }
        const origin =
          member === undefined ? 'unknown' : sourceOrigin(path, decl.source.value, member, read, 0)
        report(node, label, origin)
      }
    },
  })
  return problems
}

function lineOf(text, offset) {
  return text.slice(0, offset).split('\n').length
}

if (import.meta.main) {
  const problems = listSources().flatMap((file) => checkFile(file))
  for (const problem of problems) {
    const what =
      problem.kind === 'clock-call'
        ? `calls the wall clock through ${problem.name}`
        : `cannot trace ${problem.name}; import it directly or pass the time in`
    console.error(`${problem.file}:${problem.line} ${what}`)
  }
  process.exitCode = problems.length === 0 ? 0 : 1
}

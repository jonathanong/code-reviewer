import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { checkFile } from '../scripts/check-clock.mjs'

function tree(files) {
  const byPath = new Map(Object.entries(files).map(([file, text]) => [resolve(file), text]))
  return (path) => {
    if (!byPath.has(path)) throw new Error(`ENOENT ${path}`)
    return byPath.get(path)
  }
}

const clock = { 'lib/clock.mjs': 'export function now() { return Date.now() }\n' }

function kinds(files, file = 'app/a.mjs') {
  return checkFile(file, tree({ ...clock, ...files })).map((problem) => problem.kind)
}

it('reports a direct import', () => {
  expect(kinds({ 'app/a.mjs': "import { now } from '../lib/clock.mjs'\nnow()\n" })).toEqual([
    'clock-call',
  ])
})

it('reports a renamed import', () => {
  expect(kinds({ 'app/a.mjs': "import { now as t } from '../lib/clock.mjs'\nt()\n" })).toEqual([
    'clock-call',
  ])
})

it('follows a re-export and an alias in another module', () => {
  const files = {
    'app/time.mjs': "import { now } from '../lib/clock.mjs'\nexport const stamp = now\n",
    'app/index.mjs': "export { stamp as tick } from './time.mjs'\n",
    'app/a.mjs': "import { tick } from './index.mjs'\ntick()\n",
  }
  expect(kinds(files)).toEqual(['clock-call'])
})

it('follows export star', () => {
  const files = {
    'app/index.mjs': "export * from '../lib/clock.mjs'\n",
    'app/a.mjs': "import { now } from './index.mjs'\nnow()\n",
  }
  expect(kinds(files)).toEqual(['clock-call'])
})

it('reports a namespace member call', () => {
  expect(kinds({ 'app/a.mjs': "import * as c from '../lib/clock.mjs'\nc.now()\n" })).toEqual([
    'clock-call',
  ])
})

it('reports an import built by a call in another module as unresolved', () => {
  const files = {
    'app/time.mjs': "import { make } from './make.mjs'\nexport const stamp = make()\n",
    'app/make.mjs': 'export function make() { return () => 0 }\n',
    'app/a.mjs': "import { stamp } from './time.mjs'\nstamp()\n",
  }
  expect(kinds(files)).toEqual(['unresolved'])
})

it('reports an import from a missing module as unresolved', () => {
  expect(kinds({ 'app/a.mjs': "import { stamp } from './gone.mjs'\nstamp()\n" })).toEqual([
    'unresolved',
  ])
})

it('reports a dynamic import as unresolved', () => {
  expect(kinds({ 'app/a.mjs': "await import('./x.mjs')\n" })).toEqual(['unresolved'])
})

it('reports a subpath or workspace import as unresolved', () => {
  expect(kinds({ 'app/a.mjs': "import { now } from '#lib/clock'\nnow()\n" })).toEqual([
    'unresolved',
  ])
  expect(kinds({ 'app/a.mjs': "import { now } from '@app/time'\nnow()\n" })).toEqual(['unresolved'])
})

it('reports a method call on an imported local object as unresolved', () => {
  expect(kinds({ 'app/a.mjs': "import clock from './c.mjs'\nclock.now()\n" })).toEqual([
    'unresolved',
  ])
  expect(kinds({ 'app/a.mjs': "import { time } from './c.mjs'\ntime.now()\n" })).toEqual([
    'unresolved',
  ])
  expect(kinds({ 'app/a.mjs': "import path from 'node:path'\npath.join('a')\n" })).toEqual([])
})

it('reports a call on what a local imported function returned as unresolved', () => {
  const make = { 'app/make.mjs': 'export function make() { return () => 0 }\n' }
  const use = (body) => ({ ...make, 'app/a.mjs': `import { make } from './make.mjs'\n${body}` })
  expect(kinds(use('const stamp = make()\nstamp()\n'))).toEqual(['unresolved'])
  expect(kinds(use('const c = make()\nc.now()\n'))).toEqual(['unresolved'])
  expect(kinds(use('make()()\nmake().now()\n'))).toEqual(['unresolved', 'unresolved'])
  const registry = "import { parse } from 'acorn'\nconst tree = parse('')\ntree.body.at(0)\n"
  expect(kinds({ 'app/a.mjs': registry })).toEqual([])
})

it('stays quiet on a package import and a local wrapper function', () => {
  const files = {
    'app/time.mjs': 'export function stamp() { return 0 }\n',
    'app/a.mjs':
      "import { stamp } from './time.mjs'\nimport { join } from 'node:path'\nimport { parse } from 'acorn'\nstamp()\njoin('a')\nparse('')\n",
  }
  expect(kinds(files)).toEqual([])
})

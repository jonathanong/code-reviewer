import { describe, expect, it } from 'vitest'

import { MAX_COMMIT_FILES, MAX_REFERENCES, linkedRegressions } from './linked-regressions.mts'
import type { ContextDeps, ContextInput } from './types.mts'

const input: ContextInput = {
  repo: 'o/r',
  pr: 1,
  tree: '/tree',
  baseSha: 'base',
  headSha: 'head',
  out: '/out',
  skills: [],
}

const US = '\u001f'
const RS = '\u001e'
const FULL_A = 'a'.repeat(40)
const FULL_B = 'b'.repeat(40)

type Routes = {
  log: string
  diff?: string
  known: Record<
    string,
    { full: string; short: string; date: string; subject: string; files: string[] }
  >
  grep?: Record<string, string>
  failDiff?: boolean
}

function fake(routes: Routes): ContextDeps {
  const exec: ContextDeps['exec'] = async (_cmd, args) => {
    const git = args.slice(2)
    if (git[0] === 'log' && git.at(-1) === 'base..head') return routes.log
    if (git[0] === 'log') {
      const grep = git.find((a) => a.startsWith('--grep='))?.slice(7) ?? ''
      return routes.grep?.[grep] ?? ''
    }
    if (git[0] === 'diff') {
      if (routes.failDiff) throw new Error('diff broke')
      return routes.diff ?? ''
    }
    const sha = git.at(-1)?.replace('^{commit}', '') ?? ''
    const commit = routes.known[sha]
    if (git[0] === 'cat-file') {
      if (commit === undefined) throw new Error('missing')
      return ''
    }
    if (commit === undefined) throw new Error('missing')
    return `${[commit.full, commit.short, commit.date, commit.subject].join(US)}\n\n${commit.files.join('\n')}\n`
  }
  return { exec, readFile: async () => '' }
}

const aCommit = {
  full: FULL_A,
  short: 'aaaaaaa',
  date: '2024-02-03',
  subject: 'Add widget',
  files: ['src/a.mts', 'src/b.mts'],
}

describe('linkedRegressions', () => {
  it('is empty when the commits reference nothing', async () => {
    const deps = fake({ log: `Add feature (#3)${RS}`, known: {} })
    expect(await linkedRegressions.build(input, deps)).toBeNull()
  })

  it('describes a revert by sha, with overlap against this pull request', async () => {
    const deps = fake({
      log: `Revert "Add widget"\n\nThis reverts commit ${FULL_A}.${RS}`,
      diff: 'src/b.mts\nsrc/z.mts\n',
      known: { [FULL_A]: aCommit },
    })
    expect((await linkedRegressions.build(input, deps))?.body).toBe(
      [
        '### `aaaaaaa` 2024-02-03 Add widget',
        `Referenced as \`${FULL_A}\`; touches 1 file(s) this pull request also changes: src/b.mts.`,
        'Files: src/a.mts, src/b.mts',
      ].join('\n'),
    )
  })

  it('resolves a revert subject and a regression number on the base branch, once per commit', async () => {
    const deps = fake({
      log: `Revert "Add widget"\n${RS}Fix regression from #7${RS}`,
      known: { [FULL_A]: aCommit },
      grep: { 'Add widget': `${FULL_A}${US}Add widget\n`, '(#7)$': `${FULL_A}\n` },
    })
    const body = (await linkedRegressions.build(input, deps))?.body ?? ''
    expect(body.match(/### /gu)).toHaveLength(1)
    expect(body).toContain('touches none of the files this pull request changes')
    expect(body).toContain('Referenced as revert of "Add widget"')
  })

  it('lists what it cannot resolve instead of calling the API', async () => {
    const deps = fake({
      log: `Revert "Gone"\n${RS}regression from #9 and abc1234${RS}`,
      known: {},
      grep: { Gone: `${FULL_B}${US}Other subject\n` },
    })
    expect((await linkedRegressions.build(input, deps))?.body).toBe(
      'Not found in local history: revert of "Gone"; #9; `abc1234`.',
    )
  })

  it('keeps going when one lookup fails or the pull request diff fails', async () => {
    const deps = fake({
      log: `regression in abc1234 and #5${RS}`,
      known: {},
      failDiff: true,
      grep: {},
    })
    const body = (await linkedRegressions.build(input, deps))?.body
    expect(body).toBe('Not found in local history: #5; `abc1234`.')
  })

  it('reports a git failure for one reference as unresolved', async () => {
    const failing: ContextDeps = {
      readFile: async () => '',
      exec: async (_cmd, args) => {
        const git = args.slice(2)
        if (git[0] === 'log' && git.at(-1) === 'base..head')
          return `Revert "S"\n${RS}Fixes: abc1234${RS}`
        if (git[0] === 'log') throw new Error('grep failed\nmore')
        if (git[0] === 'cat-file') return ''
        throw 'plain failure'
      },
    }
    expect((await linkedRegressions.build(input, failing))?.body).toBe(
      'Not found in local history: revert of "S" (grep failed); `abc1234` (plain failure).',
    )
  })

  it('caps the references described and the files listed', async () => {
    const files = Array.from({ length: MAX_COMMIT_FILES + 3 }, (_, i) => `f${i}.mts`)
    const shas = Array.from({ length: MAX_REFERENCES + 1 }, (_, i) => `${i}${'d'.repeat(6)}`)
    const known = Object.fromEntries(
      shas.map((sha, i) => [sha, { ...aCommit, full: `${i}`.repeat(40), short: sha, files }]),
    )
    const deps = fake({
      log: `${shas.map((sha) => `Fixes ${sha}`).join('\n')}${RS}`,
      diff: `${files.join('\n')}\n`,
      known,
    })
    const body = (await linkedRegressions.build(input, deps))?.body ?? ''
    expect(body.match(/### /gu)).toHaveLength(MAX_REFERENCES)
    expect(body).toContain('1 more reference(s) not described.')
    expect(body).toContain(', and 3 more')
    expect(body).toContain('f0.mts, f1.mts, f2.mts, f3.mts, f4.mts, ...')
  })

  it('shows none for a commit that touched no files', async () => {
    const deps = fake({
      log: `Fixes abc1234${RS}`,
      known: { abc1234: { ...aCommit, files: [] } },
    })
    expect((await linkedRegressions.build(input, deps))?.body).toContain('Files: none')
  })
})

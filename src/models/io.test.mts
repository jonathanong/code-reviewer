import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { defaultModelsIo } from './io.mts'

describe('defaultModelsIo', () => {
  const io = defaultModelsIo()

  it('stages a probe tree in a temporary directory and removes it', async () => {
    const staged = await io.stage([{ path: 'a/b.js', content: 'x\n' }])
    expect(readFileSync(join(staged.dir, 'a/b.js'), 'utf8')).toBe('x\n')
    await staged.remove()
    expect(existsSync(staged.dir)).toBe(false)
  })

  it('writes an output file, creating its directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'models-io-test-'))
    try {
      await io.writeOut(join(root, 'out'), 'models.json', '{}\n')
      expect(readFileSync(join(root, 'out/models.json'), 'utf8')).toBe('{}\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('loads the shipped probes and tells time', () => {
    expect(io.probes().length).toBeGreaterThanOrEqual(3)
    expect(io.now()).toBeGreaterThan(0)
  })
})

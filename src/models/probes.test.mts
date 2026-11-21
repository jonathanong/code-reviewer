import { describe, expect, it } from 'vitest'

import { loadProbes } from './probes.mts'

describe('loadProbes', () => {
  const probes = loadProbes()

  it('ships at least three distinct small probes', () => {
    expect(probes.length).toBeGreaterThanOrEqual(3)
    expect(new Set(probes.map((probe) => probe.name)).size).toBe(probes.length)
    for (const probe of probes) {
      expect(probe.files.length).toBeGreaterThanOrEqual(2)
      expect(probe.files.length).toBeLessThanOrEqual(3)
    }
  })

  it('plants each defect on a real line of a real file', () => {
    for (const probe of probes) {
      const file = probe.files.find((entry) => entry.path === probe.planted.path)
      expect(file, probe.name).toBeDefined()
      const lines = file!.content.trimEnd().split('\n')
      expect(probe.planted.line, probe.name).toBeGreaterThanOrEqual(1)
      expect(probe.planted.line, probe.name).toBeLessThanOrEqual(lines.length)
    }
  })

  it('asks for the findings schema', () => {
    for (const probe of probes) expect(probe.prompt).toContain('"findings"')
  })
})

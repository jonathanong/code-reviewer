import { describe, expect, it, vi } from 'vitest'

import type { GhAuth } from '../gh-cli/index.mts'
import { createDefaultDeps } from './deps.mts'

describe('createDefaultDeps createAnswerIo', () => {
  it('replies through the runner of the target repository', async () => {
    const run = vi.fn(async (_args: string[]) => '')
    const runner = vi.fn(() => run)
    const auth: GhAuth = {
      mode: 'gh',
      identity: async () => undefined,
      runner,
      checkInstallation: async () => undefined,
    }
    const deps = createDefaultDeps(() => auth)
    await deps.createAnswerIo({ repo: 'acme/widgets', pr: 4 }).reply('PRT_1', 'No lock.')
    expect(runner).toHaveBeenLastCalledWith('acme', 'widgets')
    expect(run.mock.calls[0]?.[0]).toContain('body=No lock.')
  })
})

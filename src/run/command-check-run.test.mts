import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cli/command-review.mts', () => ({ reviewCommand: vi.fn() }))

import { reviewCommand } from '../cli/command-review.mts'
import { HEAD, type FakeOptions } from './fake-deps.mts'
import { PULL, runWith, setup as makeFake, type Review } from './harness.mts'

let root: string
let stdout: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-check-'))
  mkdirSync(join(root, 'tmp'))
  stdout = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.mocked(reviewCommand).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/** A configured check run on a fake whose `gh` finds no earlier run, so each write is a POST. */
function setup(options: Partial<FakeOptions> = {}, review: Review = {}) {
  const fake = makeFake(
    root,
    { ownerConfig: { checkRun: { name: 'Code review' } }, ...options },
    review,
  )
  const gh = vi.fn(async (_args: readonly string[]) => 'https://example.test/check\n')
  fake.deps.runner.mockReturnValue(gh)
  return { fake, gh }
}

const writes = (gh: { mock: { calls: unknown[][] } }) =>
  gh.mock.calls.map(([args]) => args as string[]).filter((args) => args.includes('--method'))

describe('run writes the check run', () => {
  it('completes a posted review with its URL on the claimed head', async () => {
    const { fake, gh } = setup()
    await runWith(fake, stdout, PULL)
    const [done] = writes(gh)
    expect(done).toContain(`head_sha=${HEAD}`)
    expect(done).toContain('conclusion=success')
    expect(done).toContain('details_url=https://github.example/review/1')
    expect(vi.mocked(reviewCommand).mock.calls[0]?.[0]).toMatchObject({ headSha: HEAD })
  })

  it('completes a held review as action_required with the hold reasons', async () => {
    const { fake, gh } = setup()
    await runWith(fake, stdout, { ...PULL, post: 'hold' })
    const [held] = writes(gh)
    expect(held).toContain('conclusion=action_required')
    expect(held).toContain('details_url=https://github.com/acme/widgets/pull/4')
    expect(held).toContain('output[title]=Held for a person: post-hold: --post hold')
    expect(gh.mock.calls.map(([args]) => (args as string[])[1])).toContain(
      `repos/acme/widgets/commits/${HEAD}/check-runs?check_name=Code%20review&per_page=100`,
    )
  })

  it('cancels with the reason when the post fails', async () => {
    const { fake, gh } = setup({ postFails: true })
    await runWith(fake, stdout, PULL)
    const [cancelled] = writes(gh)
    expect(cancelled).toContain('conclusion=cancelled')
    expect(cancelled).toContain('output[summary]=GitHub is down')
    expect(cancelled).toContain(`head_sha=${HEAD}`)
  })

  it('writes nothing when the head is already reviewed or the claim was lost', async () => {
    const lost = setup({}, { claimed: false })
    await runWith(lost.fake, stdout, PULL)
    expect(lost.gh).not.toHaveBeenCalled()
  })

  it('still posts and reports the run when the check run cannot be written', async () => {
    const { fake, gh } = setup()
    gh.mockRejectedValue(new Error('403'))
    const { code, lines } = await runWith(fake, stdout, PULL)
    expect(code).toBe(0)
    expect(lines[0]).toMatchObject({ outcome: 'posted' })
  })
})

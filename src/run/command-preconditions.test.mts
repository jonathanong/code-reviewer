import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cli/command-review.mts', () => ({ reviewCommand: vi.fn() }))

import { reviewCommand } from '../cli/command-review.mts'
import { NO_CONFIGS, parseRepoConfig } from '../review/rules/config.mts'
import type { RunValues } from './command.mts'
import { type FakeOptions } from './fake-deps.mts'
import { PULL, runWith, setup as makeFake, type Fake, type Review } from './harness.mts'
import type { RunLine } from './output.mts'

let root: string
let stdout: string[]

const setup = (options: Partial<FakeOptions> = {}, review: Review = {}) =>
  makeFake(root, options, review)

async function run(fake: Fake, values: RunValues = PULL): Promise<{ code: number; line: RunLine }> {
  const { code, lines } = await runWith(fake, stdout, values)
  expect(lines).toHaveLength(1)
  return { code, line: lines[0] as RunLine }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-command-'))
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

describe('runCommand preconditions', () => {
  const refused = async (options: Partial<FakeOptions>, values: RunValues = PULL) => {
    const fake = setup(options)
    const result = await run(fake, values)
    expect(result.code).toBe(12)
    expect(result.line.outcome).toBe('error')
    expect(fake.io.headSha).not.toHaveBeenCalled()
    expect(vi.mocked(reviewCommand)).not.toHaveBeenCalled()
    return result.line
  }

  it('needs both default rule plugins', async () => {
    expect((await refused({ plugins: ['ratchet-workflows'] })).reason).toBe(
      'rule plugins missing or not enabled at user scope: no-mistakes-rules, ratchet-github, ratchet-backend, ratchet-code',
    )
  })

  it('needs the configured rule plugins instead of the defaults', async () => {
    const ownerConfig = { rulePlugins: ['team-rules'] }
    expect((await refused({ ownerConfig })).reason).toBe(
      'rule plugins missing or not enabled at user scope: team-rules',
    )
  })

  it('reviews when the configured rule plugins are enabled', async () => {
    const fake = setup({ ownerConfig: { rulePlugins: ['team-rules'] }, plugins: ['team-rules'] })
    await run(fake)
    expect(vi.mocked(reviewCommand)).toHaveBeenCalled()
  })

  it('needs no plugin when the configured list is empty', async () => {
    const fake = setup({ ownerConfig: { rulePlugins: [] }, plugins: [] })
    await run(fake)
    expect(vi.mocked(reviewCommand)).toHaveBeenCalled()
  })

  it('refuses a rule plugin that is enabled but not at user scope', async () => {
    const fake = setup()
    const both = (await fake.deps.pluginInfo()).enabled
    vi.mocked(fake.deps.pluginInfo).mockResolvedValue({
      enabled: both,
      installs: [{ name: 'ratchet-workflows', installPath: '/p' }],
    })
    expect((await run(fake)).line.reason).toBe(
      'rule plugins missing or not enabled at user scope: no-mistakes-rules, ratchet-github, ratchet-backend, ratchet-code',
    )
  })

  it('refuses a rulePlugins entry with a marketplace suffix, naming the file', async () => {
    const line = await refused({ ownerConfig: { rulePlugins: ['a@market'] } })
    expect(line.reason).toContain('settings invalid: acme.json rulePlugins: ')
  })

  it('refuses a machine config with a problem, naming it', async () => {
    const line = await refused({ ownerConfig: { run: { rules: { nope: true } } } })
    expect(line.reason).toContain('settings invalid: acme.json run rules: unknown key "nope"')
  })

  it('refuses a problem in the repository machine file', async () => {
    const fake = setup()
    const own = parseRepoConfig('{"run":{"nope":1}}', 'Acme/Widgets.json')
    vi.mocked(fake.deps.configs).mockReturnValue({ ...NO_CONFIGS, problems: own.problems })
    expect((await run(fake)).line.reason).toContain('settings invalid: Acme/Widgets.json')
  })

  it('refuses a config kept in two formats, naming both files', async () => {
    const fake = setup()
    const both = 'acme.json and acme.jsonc: more than one file for the same config; none is used'
    vi.mocked(fake.deps.configs).mockReturnValue({ ...NO_CONFIGS, problems: [both] })
    expect((await run(fake)).line.reason).toContain(`settings invalid: ${both}`)
  })

  it('refuses a problem in the reviewed repository own file', async () => {
    const fake = setup()
    vi.mocked(fake.deps.targetConfig).mockResolvedValue({ config: undefined, problems: ['bad'] })
    expect((await run(fake)).code).toBe(12)
  })

  it('refuses when the App identity cannot be looked up', async () => {
    expect((await refused({ loginError: 'own identity lookup failed' })).reason).toBe(
      'own identity lookup failed',
    )
  })

  it.each([new Error('claude is not installed'), 'plain'])(
    'refuses when plugins cannot be listed (%s)',
    async (thrown) => {
      const fake = setup()
      vi.mocked(fake.deps.pluginInfo).mockRejectedValue(thrown)
      expect((await run(fake)).line.reason).toBe(
        String(thrown instanceof Error ? thrown.message : thrown),
      )
    },
  )

  it.each([
    [{ pr: '4' }, '--repo and --pr are required.'],
    [{ repo: ['acme/widgets'] }, '--repo and --pr are required.'],
    [{ repo: ['nope'], pr: '4' }, undefined],
    [{ ...PULL, post: 'later' }, '--post must be auto or hold.'],
    [{ ...PULL, effort: 'extreme' }, '--effort must be one of low, medium, high.'],
    [{ ...PULL, model: ['verifier'] }, '--model verifier: expected step=harness:model.'],
  ] as Array<[RunValues, string | undefined]>)('refuses the flags %j', async (values, reason) => {
    const line = await refused({}, values)
    if (reason !== undefined) expect(line.reason).toBe(reason)
    expect(line.exitCode).toBe(12)
  })
})

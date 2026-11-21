import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cli/command-review.mts', () => ({ reviewCommand: vi.fn() }))

import { reviewCommand } from '../cli/command-review.mts'
import { NO_CONFIGS, parseRepoConfig } from '../review/rules/config.mts'
import type { RunValues } from './command.mts'
import { HEAD, marker, type FakeOptions } from './fake-deps.mts'
import { COUNTS, PULL, runWith, setup as makeFake, type Fake, type Review } from './harness.mts'
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

/** Dropping the in-progress label fails, as when GitHub is unreachable after the review. */
function breakRelease(fake: Fake) {
  vi.mocked(fake.labelIo.remove).mockImplementation(async (name) => {
    if (name === 'final-review:in-progress') throw new Error('labels are down')
    fake.labels.splice(fake.labels.indexOf(name), 1)
  })
}

const noTreeLeft = () => expect(readdirSync(join(root, 'tmp'))).toEqual([])

describe('runCommand posting', () => {
  it('requests, claims, reviews, posts and cleans up, printing one line', async () => {
    const fake = setup()
    const { code, line } = await run(fake)
    expect(code).toBe(0)
    expect(line).toMatchObject({
      repo: 'acme/widgets',
      pr: 4,
      headSha: HEAD,
      outcome: 'posted',
      exitCode: 0,
      verdict: 'Approve',
      event: 'APPROVE',
      held: [],
      findings: COUNTS,
      questions: 0,
      reviewUrl: 'https://github.example/review/1',
      costUsd: 2.1,
      tokens: { input: 150, output: 30 },
      mode: 'full',
      tree: 'clone',
      attention: [],
      problems: [],
      reason: null,
    })
    expect(fake.labelIo.add).toHaveBeenNthCalledWith(1, ['final-review:requested'])
    expect(fake.labels).toEqual(['final-review:complete'])
    expect(fake.io.postReview).toHaveBeenCalledOnce()
    expect(line.runDir?.startsWith(join(root, 'state', 'runs', 'acme', 'widgets'))).toBe(true)
    expect(readFileSync(line.explainPath as string, 'utf8')).toContain('Cache widget lookups')
    noTreeLeft()
  })

  it('does not add a request label that is already there, and claims through review', async () => {
    const fake = setup({ labels: ['final-review:requested'] })
    const { code } = await run(fake)
    expect(code).toBe(0)
    expect(fake.labelIo.add).not.toHaveBeenCalledWith(['final-review:requested'])
    expect(vi.mocked(reviewCommand)).toHaveBeenCalledOnce()
  })

  it('works in a worktree of the local clone and removes it', async () => {
    const fake = setup()
    const clones = join(root, 'clones')
    mkdirSync(join(clones, 'widgets', '.git'), { recursive: true })
    const { line } = await run(fake, { ...PULL, clones })
    expect(line.tree).toBe('worktree')
    expect(fake.git).toHaveBeenCalledWith(expect.arrayContaining(['worktree', 'remove']))
    const passed = vi.mocked(reviewCommand).mock.calls[0]?.[0]
    expect(passed).toMatchObject({ clones, force: false })
  })

  it('takes the clone root from the environment', async () => {
    const fake = setup()
    const clones = join(root, 'envclones')
    mkdirSync(join(clones, 'widgets', '.git'), { recursive: true })
    fake.env.env.CODE_REVIEWER_CLONE_ROOT = clones
    expect((await run(fake)).line.tree).toBe('worktree')
  })

  it('passes jobs and effort to the review', async () => {
    const fake = setup()
    await run(fake, { ...PULL, jobs: '2', effort: 'low' })
    expect(vi.mocked(reviewCommand).mock.calls[0]?.[0]).toMatchObject({ jobs: '2', effort: 'low' })
  })

  it('reports a skip plan as posted with the Skipped verdict', async () => {
    const fake = setup()
    vi.mocked(reviewCommand).mockResolvedValue({
      ok: true,
      summary: { claimed: true, review: null },
    })
    const { code, line } = await run(fake)
    expect(code).toBe(0)
    expect(line).toMatchObject({ outcome: 'posted', verdict: 'Skipped', mode: 'skip' })
    expect(line.reason).toContain('skipped')
  })

  it('reports a tracker failure beside a posted review', async () => {
    const fake = setup({ trackerPostedFails: true })
    const { code, line } = await run(fake)
    expect(code).toBe(0)
    expect(line.attention[0]).toContain('the tracker could not record this run')
  })
})

describe('runCommand holding', () => {
  const question = { question: 'Is it shared?', askOf: 'author', why: 'Sets the TTL.' }

  it('holds a review with an open question and puts the request back', async () => {
    const fake = setup({}, { overrides: { review: { questions: [question] } } })
    const { code, line } = await run(fake)
    expect(code).toBe(10)
    expect(line).toMatchObject({
      outcome: 'held',
      exitCode: 10,
      held: ['unclear-intent'],
      questions: 1,
    })
    expect(line.attention).toEqual(['unclear-intent: 1 open question(s) need an answer'])
    expect(line.postCommand).toBe(
      `code-reviewer post --repo acme/widgets --pr 4 --head-sha ${HEAD} --input ${line.runDir}/review.json`,
    )
    expect(fake.io.postReview).not.toHaveBeenCalled()
    expect(fake.labels).toEqual(['final-review:requested'])
    expect(existsSync(line.explainPath as string)).toBe(true)
    noTreeLeft()
  })

  it('does not review a held head again, and reviews it again with force', async () => {
    const fake = setup({}, { overrides: { review: { questions: [question] } } })
    await run(fake)
    stdout.length = 0
    const again = await run(fake)
    expect(again.code).toBe(11)
    expect(again.line.reason).toContain('an unposted review of this head waits in')
    expect(vi.mocked(reviewCommand)).toHaveBeenCalledOnce()
    stdout.length = 0
    expect((await run(fake, { ...PULL, force: true })).code).toBe(10)
    expect(vi.mocked(reviewCommand)).toHaveBeenCalledTimes(2)
  })

  it('holds on --post hold, whatever the review says', async () => {
    const fake = setup()
    const { code, line } = await run(fake, { ...PULL, post: 'hold' })
    expect(code).toBe(10)
    expect(line.held).toEqual(['post-hold'])
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('holds under the local gh login, unless that rule is switched off', async () => {
    const held = await run(setup({ authMode: 'gh' }))
    expect(held.line.held).toEqual(['not-app-identity'])
    stdout.length = 0
    const off = { run: { rules: { 'not-app-identity': false } } }
    expect(
      (await run(setup({ authMode: 'gh', ownerConfig: off, stateDir: join(root, 'other') }))).code,
    ).toBe(0)
  })

  it('holds a large change and a risky one, with the paths in attention', async () => {
    const files = [{ path: 'src/auth/login.ts', lines: 2000 }]
    const { line } = await run(setup({ files }))
    expect(line.held).toEqual(['large-change', 'risky-change'])
    expect(line.attention.join(' ')).toContain('src/auth/login.ts')
  })

  it('does not hold a manifest and a workflow test, and holds a workflow file', async () => {
    const quiet = [
      { path: 'package.json', lines: 2 },
      { path: '.github/workflows/__tests__/ci.test.mts', lines: 9 },
    ]
    expect((await run(setup({ files: quiet }))).code).toBe(0)
    stdout.length = 0
    const workflow = [{ path: '.github/workflows/ci.yml', lines: 3 }]
    const { line } = await run(setup({ files: workflow, stateDir: join(root, 'other') }))
    expect(line.held).toEqual(['risky-change'])
    expect(line.attention).toEqual(['risky-change: touches .github/workflows/ci.yml'])
  })

  it('holds a failed pillar and a cut-short review, and lists them as problems', async () => {
    const report = {
      pillars: [{ pillar: 'security', error: 'x', failedAttempts: [], findings: [] }],
    }
    const { line } = await run(setup({}, { overrides: { report, context: { truncated: true } } }))
    expect(line.held).toEqual(['large-change', 'partial-failure'])
    expect(line.problems).toEqual([
      'pillar security failed',
      'the conversation is longer than the digest reads',
    ])
  })

  it('holds posted text the post would refuse', async () => {
    const review = { summary: 'word '.repeat(2000) }
    const { line } = await run(setup({}, { overrides: { review } }))
    expect(line.held).toEqual(['text-too-long'])
  })

  it('reports a claim that could not be released as a problem of the held run', async () => {
    const fake = setup()
    breakRelease(fake)
    const { code, line } = await run(fake, { ...PULL, post: 'hold' })
    expect(code).toBe(10)
    expect(line.problems).toEqual(['could not release the claim: labels are down'])
    expect(line.attention).toContain('could not release the claim: labels are down')
  })
})

describe('runCommand doing nothing', () => {
  it('declines a head the newest review covers, before checking anything out, unless forced', async () => {
    const fake = setup({ reviews: [marker('Approve')] })
    const { code, line } = await run(fake)
    expect(code).toBe(11)
    expect(line).toMatchObject({
      outcome: 'noop',
      reason: 'head already reviewed (verdict Approve)',
    })
    expect(fake.git).not.toHaveBeenCalled()
    expect(fake.labelIo.add).not.toHaveBeenCalled()
    expect(vi.mocked(reviewCommand)).not.toHaveBeenCalled()
    stdout.length = 0
    expect((await run(fake, { ...PULL, force: true })).code).toBe(0)
  })

  it('declines a pull request another session is reviewing, and takes it over with force', async () => {
    const fake = setup({ labels: ['final-review:in-progress'] })
    const { code, line } = await run(fake)
    expect(code).toBe(11)
    expect(line.reason).toBe('already in progress')
    expect(fake.labels).toEqual(['final-review:in-progress'])
    stdout.length = 0
    expect((await run(fake, { ...PULL, force: true })).code).toBe(0)
  })

  it('exits as a no-op when review loses the claim, and removes the checkout', async () => {
    const { code, line } = await run(setup({}, { claimed: false }))
    expect(code).toBe(11)
    expect(line.reason).toBe('lost')
    noTreeLeft()
  })
})

describe('runCommand failing', () => {
  it('reports a failed review with the claim released, and removes the checkout', async () => {
    const fake = setup({}, { ok: false, error: 'every pillar failed' })
    const { code, line } = await run(fake)
    expect(code).toBe(13)
    expect(line).toMatchObject({ outcome: 'error', reason: 'every pillar failed' })
    expect(line.attention).toEqual(['every pillar failed'])
    expect(fake.labels).toEqual([])
    noTreeLeft()
  })

  it('reports a failed review that could not drop its claim', async () => {
    const fake = setup()
    vi.mocked(reviewCommand).mockResolvedValue({
      ok: false,
      summary: { claimed: true, error: 'boom', abortError: 'labels are down' },
    })
    expect((await run(fake)).line.problems).toEqual(['labels are down'])
  })

  it('releases the claim when the post fails and names the command to retry', async () => {
    const fake = setup({ postFails: true })
    const { code, line } = await run(fake)
    expect(code).toBe(13)
    expect(line.reason).toBe('the review is ready but was not posted: GitHub is down')
    expect(line.postCommand).toContain('code-reviewer post --repo acme/widgets')
    expect(fake.labels).toEqual([])
    noTreeLeft()
  })

  it('names a post failure that is not an error', async () => {
    const fake = setup()
    vi.mocked(fake.io.postReview).mockRejectedValue('gone')
    expect((await run(fake)).line.reason).toBe('the review is ready but was not posted: gone')
  })

  it('reports a claim that could not be released after a failed post', async () => {
    const fake = setup({ postFails: true })
    breakRelease(fake)
    const { line } = await run(fake)
    expect(line.problems).toEqual(['could not release the claim: labels are down'])
  })

  it('stops and releases the claim when interrupted, and removes the checkout', async () => {
    const fake = setup()
    const delayed = vi.mocked(reviewCommand).getMockImplementation()
    vi.mocked(reviewCommand).mockImplementation(async (...args) => {
      const result = await delayed?.(...args)
      fake.signals.emit('SIGTERM')
      return result as Awaited<ReturnType<typeof reviewCommand>>
    })
    const { code, line } = await run(fake)
    expect(code).toBe(13)
    expect(line.reason).toContain('interrupted by SIGTERM')
    expect(fake.labels).toEqual([])
    expect(fake.deps.exec).toHaveBeenCalledWith(
      'claude',
      [],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    noTreeLeft()
    expect(fake.signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('reports an unexpected error with what the run knew', async () => {
    const fake = setup()
    vi.mocked(fake.io.headSha).mockRejectedValue(new Error('network down'))
    const { code, line } = await run(fake)
    expect(code).toBe(13)
    expect(line).toMatchObject({
      repo: 'acme/widgets',
      pr: 4,
      headSha: null,
      reason: 'network down',
    })
  })

  it.each([new Error('review needs --out'), 'plain failure'])(
    'reports a review that throws (%s), and removes the checkout',
    async (thrown) => {
      const fake = setup()
      vi.mocked(reviewCommand).mockRejectedValue(thrown)
      expect((await run(fake)).code).toBe(13)
      noTreeLeft()
    },
  )

  it('reports a checkout that could not be removed', async () => {
    const fake = setup()
    const clones = join(root, 'clones')
    mkdirSync(join(clones, 'widgets', '.git'), { recursive: true })
    fake.git.mockImplementation(async (args) => {
      if (args.includes('remove')) throw new Error('worktree is locked')
      return args.includes('get-url') ? 'https://github.com/acme/widgets.git' : ''
    })
    const { code, line } = await run(fake, { ...PULL, clones })
    expect(code).toBe(0)
    expect(line.problems[0]).toContain('could not remove the checkout')
    expect(line.attention[0]).toContain('worktree is locked')
  })

  it('reports a checkout that could not be made, before claiming anything', async () => {
    const fake = setup()
    fake.git.mockRejectedValue(new Error('no such remote'))
    const { code, line } = await run(fake)
    expect(code).toBe(13)
    expect(line.reason).toBe('no such remote')
    expect(vi.mocked(reviewCommand)).not.toHaveBeenCalled()
    expect(fake.labelIo.add).not.toHaveBeenCalled()
  })
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
    expect((await refused({ plugins: ['jong-skills'] })).reason).toBe(
      'rule plugins missing or not enabled at user scope: no-mistakes-rules',
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
      installs: [{ name: 'jong-skills', installPath: '/p' }],
    })
    expect((await run(fake)).line.reason).toBe(
      'rule plugins missing or not enabled at user scope: no-mistakes-rules',
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
  ] as Array<[RunValues, string | undefined]>)('refuses the flags %j', async (values, reason) => {
    const line = await refused({}, values)
    if (reason !== undefined) expect(line.reason).toBe(reason)
    expect(line.exitCode).toBe(12)
  })
})

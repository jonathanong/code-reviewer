import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { configHome } from '../review/rules/config.mts'
import { AppAuthError, type AppAuthEnv, type AppConfig } from './app-auth.mts'

/** File access for App config, injectable so tests never touch a real key. */
export type AppConfigFs = {
  /** The text of a file, or undefined when it does not exist. */
  readText(path: string): string | undefined
  /** The permission bits of a file. */
  mode(path: string): number
}

const DEFAULT_KEY_FILE = 'app.pem'
const KEYS = new Set(['appId', 'privateKeyPath', 'installationId'])

export const APP_CONFIG_FILE = 'app.json'

export const realAppConfigFs: AppConfigFs = {
  readText(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  },
  mode: (path) => statSync(path).mode & 0o777,
}

function fail(file: string, problem: string): never {
  throw new AppAuthError(`GitHub App config ${file}: ${problem}.`)
}

/** Reads the PEM, failing fast when it is missing, unreadable, not a key, or open to others. */
function readKey(fs: AppConfigFs, path: string, platform: NodeJS.Platform): string {
  let key: string | undefined
  try {
    key = fs.readText(path)
    if (key === undefined) fail(path, 'private key file does not exist')
    // Windows has no POSIX mode bits to check.
    if (platform !== 'win32' && (fs.mode(path) & 0o077) !== 0) {
      fail(path, 'private key file is readable by group or others; run chmod 600 on it')
    }
  } catch (error) {
    if (error instanceof AppAuthError) throw error
    fail(path, `private key file cannot be read (${(error as Error).message})`)
  }
  if (!key.includes('PRIVATE KEY')) fail(path, 'private key file is not a PEM private key')
  return key
}

function stringId(
  value: unknown,
  name: string,
  file: string,
  required: boolean,
): string | undefined {
  if (value === undefined && !required) return undefined
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || text.trim() === '') {
    return fail(file, `${name} must be a non-empty string or number`)
  }
  return text.trim()
}

function fromFile(
  file: string,
  text: string,
  dir: string,
  env: AppAuthEnv,
  fs: AppConfigFs,
  platform: NodeJS.Platform,
): AppConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return fail(file, `is not valid JSON (${(error as Error).message})`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(file, 'must be a JSON object')
  }
  const object = parsed as Record<string, unknown>
  const unknown = Object.keys(object).filter((key) => !KEYS.has(key))
  if (unknown.length > 0) fail(file, `unknown key ${unknown.join(', ')}`)
  const appId = stringId(object.appId, 'appId', file, true) as string
  const installationId = stringId(object.installationId, 'installationId', file, false)
  const keyPath = object.privateKeyPath ?? DEFAULT_KEY_FILE
  if (typeof keyPath !== 'string' || keyPath === '') {
    fail(file, 'privateKeyPath must be a non-empty string')
  }
  const home = env.HOME || homedir()
  const resolved = (keyPath as string).startsWith('~/')
    ? join(home, (keyPath as string).slice(2))
    : isAbsolute(keyPath as string)
      ? (keyPath as string)
      : join(dir, keyPath as string)
  return {
    appId,
    privateKey: readKey(fs, resolved, platform),
    ...(installationId === undefined ? {} : { installationId }),
    apiUrl: apiUrl(env),
    source: file,
  }
}

function apiUrl(env: AppAuthEnv): string {
  return (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/u, '')
}

/**
 * The GitHub App to authenticate as, or undefined to use the local `gh` login. When
 * `CODE_REVIEWER_APP_ID` is set the `CODE_REVIEWER_APP_*` variables win (for CI): the PEM text in
 * `CODE_REVIEWER_APP_PRIVATE_KEY` or a file named by `CODE_REVIEWER_APP_PRIVATE_KEY_PATH`, and an
 * optional `CODE_REVIEWER_APP_INSTALLATION_ID`. Otherwise `app.json` in the config home
 * (`~/.config/code-reviewer`, beside the machine config directory) (`appId`, optional `privateKeyPath` defaulting to `app.pem` beside it, optional
 * `installationId`). A config that exists but is wrong throws, naming the file.
 */
export function loadAppConfig(
  env: AppAuthEnv = process.env,
  fs: AppConfigFs = realAppConfigFs,
  dir: string = configHome(env),
  platform: NodeJS.Platform = process.platform,
): AppConfig | undefined {
  const appId = env.CODE_REVIEWER_APP_ID?.trim()
  if (!appId) {
    const file = join(dir, APP_CONFIG_FILE)
    const text = fs.readText(file)
    return text === undefined ? undefined : fromFile(file, text, dir, env, fs, platform)
  }
  const path = env.CODE_REVIEWER_APP_PRIVATE_KEY_PATH?.trim()
  const pem = env.CODE_REVIEWER_APP_PRIVATE_KEY
  if (pem === undefined && !path) {
    throw new AppAuthError(
      'CODE_REVIEWER_APP_ID is set but no PEM private key was found in ' +
        'CODE_REVIEWER_APP_PRIVATE_KEY or CODE_REVIEWER_APP_PRIVATE_KEY_PATH.',
    )
  }
  const privateKey = pem ?? readKey(fs, path as string, platform)
  if (!privateKey.includes('PRIVATE KEY')) {
    throw new AppAuthError('CODE_REVIEWER_APP_PRIVATE_KEY is set but is not a PEM private key.')
  }
  const installationId = env.CODE_REVIEWER_APP_INSTALLATION_ID?.trim()
  return {
    appId,
    privateKey,
    ...(installationId ? { installationId } : {}),
    apiUrl: apiUrl(env),
    source: 'env',
  }
}

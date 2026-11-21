import { harness as claude } from './claude.mts'
import { harness as codex } from './codex.mts'
import { harness as grok } from './grok.mts'
import { harness as opencode } from './opencode.mts'
import type { Harness } from './types.mts'

/** Every harness a config may name. Adding one is one line here. */
const HARNESSES: readonly Harness[] = [claude, grok, opencode, codex]

export const HARNESS_NAMES: readonly string[] = HARNESSES.map((harness) => harness.name)

/** The adapter registered under `name`, or undefined for an unknown name. */
export function harnessNamed(name: string): Harness | undefined {
  return HARNESSES.find((harness) => harness.name === name)
}

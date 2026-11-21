import { harness as claude } from './claude.mts'
import type { Harness } from './types.mts'

/** Every harness a config may name. Adding one is one line here. */
const HARNESSES: readonly Harness[] = [claude]

export const HARNESS_NAMES: readonly string[] = HARNESSES.map((harness) => harness.name)

/** The adapter registered under `name`, or undefined for an unknown name. */
export function harnessNamed(name: string): Harness | undefined {
  return HARNESSES.find((harness) => harness.name === name)
}

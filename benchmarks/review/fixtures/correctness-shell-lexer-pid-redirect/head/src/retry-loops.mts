import { expandsVariable, splitSegments } from './shell-lexer.mts'

type Frame = {
  variable: string | undefined
  inBody: boolean
  runsTest: boolean
  usesInput: boolean
}

/**
 * Loop variables of the `for` loops that run `testCommand` again without giving it anything that
 * changes. Such a loop retries the test.
 */
export function findRetryLoops(script: string, testCommand: string): string[] {
  const found: string[] = []
  const frames: Frame[] = []
  for (const segment of splitSegments(script)) {
    const words = segment.split(/\s+/)
    if (words[0] === 'for') {
      frames.push({ variable: words[1], inBody: false, runsTest: false, usesInput: false })
      continue
    }
    const top = frames.at(-1)
    if (words[0] === 'do' && top) top.inBody = true
    for (const frame of frames) {
      if (
        frame.inBody &&
        frame.variable !== undefined &&
        expandsVariable(segment, frame.variable)
      ) {
        frame.usesInput = true
      }
    }
    if (words[0] === 'done') {
      const frame = frames.pop()
      if (frame?.runsTest && !frame.usesInput && frame.variable !== undefined) {
        found.push(frame.variable)
      }
      continue
    }
    const command = words[0] === 'do' ? segment.slice(2).trim() : segment
    if (top?.inBody && command.startsWith(testCommand)) top.runsTest = true
  }
  return found
}

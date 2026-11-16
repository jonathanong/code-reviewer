import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** Runs a binary and resolves stdout; rejects on a non-zero exit. */
export type Exec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<string>

const execFileAsync = promisify(execFile)

const TAIL = 600

function tail(text: string): string {
  return text.trim().slice(-TAIL)
}

/** A non-zero exit, keeping the exit code and stdout for callers that expect one (`git diff`). */
export class ExecError extends Error {
  readonly code: unknown
  readonly stdout: string

  constructor(message: string, code: unknown, stdout: string, cause: unknown) {
    super(message, { cause })
    this.code = code
    this.stdout = stdout
  }
}

/** Runs a binary; a failure reports the exit code and output tails, never the (long) arguments. */
export const defaultExec: Exec = async (command, args, options = {}) => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    // execFile errors carry the captured output as strings (empty when the binary never ran).
    const failure = error as { code?: unknown; stdout: string; stderr: string }
    const parts = [
      `${command} exited with ${String(failure.code)}`,
      tail(failure.stdout),
      tail(failure.stderr),
    ]
    const message = parts.filter((part) => part.length > 0).join('\n')
    throw new ExecError(message, failure.code, failure.stdout, error)
  }
}

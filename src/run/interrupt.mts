/** The slice of `process` that interrupt handling needs, so a test can drive it. */
export type SignalSource = {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

/**
 * An abort signal that fires on SIGINT or SIGTERM. A run's child processes and checks stop when it
 * does, so the review fails, drops its claim and lets `run` remove the tree and print its line.
 * `dispose` restores the default signal behavior once the run is over.
 */
export function watchInterrupts(source: SignalSource): {
  signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const onInt = () => controller.abort(new Error('interrupted by SIGINT'))
  const onTerm = () => controller.abort(new Error('interrupted by SIGTERM'))
  source.on('SIGINT', onInt)
  source.on('SIGTERM', onTerm)
  return {
    signal: controller.signal,
    dispose() {
      source.off('SIGINT', onInt)
      source.off('SIGTERM', onTerm)
    },
  }
}

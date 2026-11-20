import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

import { watchInterrupts } from './interrupt.mts'

describe('watchInterrupts', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)('aborts on %s and names the signal', (name) => {
    const source = new EventEmitter()
    const { signal } = watchInterrupts(source)
    expect(signal.aborted).toBe(false)
    source.emit(name)
    expect(signal.aborted).toBe(true)
    expect(String(signal.reason)).toContain(name)
  })

  it('stops listening once disposed', () => {
    const source = new EventEmitter()
    const watch = watchInterrupts(source)
    watch.dispose()
    expect(source.listenerCount('SIGINT')).toBe(0)
    expect(source.listenerCount('SIGTERM')).toBe(0)
    source.emit('SIGINT')
    expect(watch.signal.aborted).toBe(false)
  })
})

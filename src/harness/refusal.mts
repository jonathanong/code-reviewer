import { ReviewError } from '../review/finding.mts'

/** An adapter declining a step before it starts; the runner moves to the next candidate. */
export class HarnessRefusal extends ReviewError {
  constructor(message: string) {
    super(message)
    this.name = 'HarnessRefusal'
  }
}

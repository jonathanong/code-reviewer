import { logger, mailer } from '../platform/client.ts'

export async function sendInvite(memberId: string, attempt: number): Promise<boolean> {
  try {
    await mailer.send(memberId)
    return true
  } catch (error) {
    logger.warn({ memberId, attempt, err: error }, 'invite send failed')
    return false
  }
}

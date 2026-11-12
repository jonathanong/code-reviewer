import { purgeExpiredSessions } from './purge-sessions.ts'

export const jobs = { 'purge-expired-sessions': { every: '15m', run: purgeExpiredSessions } }

import { noSyncFs } from './no-sync-fs.mts'
import { noUnawaitedRun } from './no-unawaited-run.mts'

export const rules = { 'no-sync-fs': noSyncFs, 'no-unawaited-run': noUnawaitedRun }

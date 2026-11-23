import {SaazBack} from '@dreamerbird/saaz'
import {resolve} from 'node:path'
import {schema} from '../state/schema'
import {BackFileAdapter} from './BackFileAdapter'

const backs: {[key in string]?: SaazBack} = {}
const adapters: {[key in string]?: BackFileAdapter} = {}

const getStateDir = () =>
  process.env.SYNC_SERVER_STATE_DIR
    ? resolve(process.env.SYNC_SERVER_STATE_DIR)
    : resolve(process.cwd(), '.data')

export function getSaazBack(dbName: string): SaazBack {
  if (!backs[dbName]) {
    const adapter = new BackFileAdapter({dir: getStateDir(), dbName})
    adapters[dbName] = adapter
    backs[dbName] = new SaazBack({
      dbName,
      schema,
      storageAdapter: adapter,
    })
  }
  return backs[dbName]!
}

/**
 * Flushes pending snapshot writes before the process exits. Idempotent.
 */
export async function closeSaazBacks(): Promise<void> {
  await Promise.all(Object.values(adapters).map((adapter) => adapter?.close()))
}

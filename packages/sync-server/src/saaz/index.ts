import {BackMemoryAdapter, SaazBack} from '@toy-box/saaz'
import {schema} from '../state/schema'

const backs: {[key in string]?: SaazBack} = {}

export function getSaazBack(dbName: string): SaazBack {
  if (!backs[dbName]) {
    backs[dbName] = new SaazBack({
      dbName,
      schema,
      storageAdapter: new BackMemoryAdapter(),
    })
  }
  return backs[dbName]!
}

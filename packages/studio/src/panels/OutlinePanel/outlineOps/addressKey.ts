import type {SheetObjectAddress} from '@dreamerbird/core/types/public'

/**
 * 对象地址的稳定序列化(显示名存储键,spec §3)。
 * 显式按字段序拼接,不受对象构造时键序影响。
 */
export function objectAddressKey(address: SheetObjectAddress): string {
  const {projectId, sheetId, sheetInstanceId, objectKey} = address
  return JSON.stringify({projectId, sheetId, sheetInstanceId, objectKey})
}

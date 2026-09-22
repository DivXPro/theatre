import type {SheetObjectAddress} from '@dreamerbird/core/types/public'
import {objectAddressKey} from './addressKey'

/**
 * 对象显示名:大纲覆盖名优先,无覆盖回退 objectKey。
 * 与大纲行同一来源(spec §3);属性面板等展示处共用本函数,保证各处一致。
 */
export function objectDisplayNameOf(
  namesByAddress: {[key: string]: string | undefined} | undefined,
  address: SheetObjectAddress,
): string {
  return namesByAddress?.[objectAddressKey(address)] ?? address.objectKey
}

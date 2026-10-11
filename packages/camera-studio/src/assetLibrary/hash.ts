/**
 * FNV-1a 64 位哈希:非加密,只用于内容去重和骨架族 id。
 * 同步、无依赖,浏览器和 jest 都能跑。
 */
export function hashBytes(data: Uint8Array): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data[i])
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

export function hashString(s: string): string {
  return hashBytes(new TextEncoder().encode(s))
}

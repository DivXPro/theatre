import {LoadingManager} from 'three'

export function createResourceUrlModifier(files: File[]) {
  const urls = new Map<string, string>()
  const byName = new Map(files.map((file) => [file.name, file]))
  const manager = new LoadingManager()
  manager.setURLModifier((url) => {
    if (/^(blob:|data:|https?:)/.test(url)) return url
    const name = decodeURIComponent(url.split('/').pop() ?? url)
    const file = byName.get(name)
    if (!file) throw new Error(`GLTF 外部资源缺失: ${name}`)
    let objectUrl = urls.get(name)
    if (!objectUrl) {
      objectUrl = URL.createObjectURL(file)
      urls.set(name, objectUrl)
    }
    return objectUrl
  })
  return {
    manager,
    dispose() {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}

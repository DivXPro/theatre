import {realImportDeps} from './importPipeline'
import {getLibrary} from './library'
import {seedModels} from './seedModels'

/**
 * 随包种子模型:seedModels/ 目录下的 FBX(Mixamo 人体角色,T-pose)。
 * vite 静态 glob,目录为空时返回空表,播种自然跳过。
 */
const seedUrls = import.meta.glob('./seedModels/*.fbx', {
  eager: true,
  as: 'url',
}) as Record<string, string>

let started = false

/**
 * 模型库框体挂载时触发;模块级幂等,重复调用只跑一次。
 * 失败只告警不阻塞面板——播种是增强,不是门槛。
 */
export function seedBuiltinModels(): void {
  if (started) return
  started = true
  void run().catch((err) =>
    console.warn('[assetLibrary] 内置模型播种失败', err),
  )
}

async function run(): Promise<void> {
  const files = await Promise.all(
    Object.entries(seedUrls).map(async ([path, url]) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`种子模型拉取失败: ${path} (${res.status})`)
      const blob = await res.blob()
      return new File([blob], path.split('/').pop()!)
    }),
  )
  await seedModels(files, getLibrary(), realImportDeps())
}

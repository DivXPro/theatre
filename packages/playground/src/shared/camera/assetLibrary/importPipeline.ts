import type {AnimationClip, Group, Object3D} from 'three'
import {classifyModel, validatePoseJson} from './classify'
import {createGLTFLoader} from './gltfLoader'
import {exportAnimationGLB, exportModelGLB} from './exportGLB'
import {hashBytes} from './hash'
import type {Library} from './library'
import {collectBoneNames, meshStats, rigIdOf} from './rig'
import type {
  AnimationEntry,
  LibraryBackend,
  ModelEntry,
  PoseEntry,
} from './types'

export type LoadedModel = {root: Group; animations: AnimationClip[]}

/** 依赖注入:测试给假实现,UI 给 FBXLoader/GLTFLoader + GLTFExporter 真实现 */
export type ImportDeps = {
  load: (file: File) => Promise<LoadedModel>
  exportModel: (root: Object3D) => Promise<ArrayBuffer>
  exportAnimation: (root: Object3D, clip: AnimationClip) => Promise<ArrayBuffer>
}

export const realImportDeps: () => ImportDeps = () => ({
  load: defaultLoad,
  exportModel: exportModelGLB,
  exportAnimation: exportAnimationGLB,
})

async function defaultLoad(file: File): Promise<LoadedModel> {
  const {FBXLoader} = await import('three-stdlib')
  const {LoadingManager} = await import('three')
  const url = URL.createObjectURL(file)
  try {
    if (/\.glb$|\.gltf$/i.test(file.name)) {
      const gltf = await createGLTFLoader().loadAsync(url)
      return {root: gltf.scene as Group, animations: gltf.animations}
    }
    // FBX 内嵌贴图走 TextureLoader 异步解码:loadAsync 在解析完成时就返回,
    // 此时 texture.image 还是空的,直接导出会被当无效贴图剥掉(灰模)。
    // 用 LoadingManager.onLoad 等全部贴图解码完再交卷;贴图加载失败不
    // 阻塞(manager 照样 onLoad),无效贴图由导出侧的 strip 兜底
    return await new Promise<LoadedModel>((resolve, reject) => {
      const manager = new LoadingManager()
      let loaded: LoadedModel | undefined
      manager.onLoad = () => {
        if (loaded) resolve(loaded)
      }
      new FBXLoader(manager).load(
        url,
        (root) => {
          loaded = {root: root as Group, animations: root.animations}
        },
        undefined,
        reject,
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export type ImportItem =
  | {
      type: 'model'
      name: string
      rig: string
      contentHash: string
      boneCount: number
      vertexCount: number
      glb: ArrayBuffer
    }
  | {
      type: 'animation'
      name: string
      rig: string
      contentHash: string
      duration: number
      glb: ArrayBuffer
    }
  | {type: 'pose'; name: string; rig: string; bones: PoseEntry['bones']}
  | {type: 'skip'; name: string; reason: string}

/** 哈希不同但同族同结构的模型,入库前要用户选 reuse/keep */
export type SimilarMatch = {
  index: number // items 里对应 model 项的下标
  existingName: string
  newName: string
}

export type ImportPlan = {
  items: ImportItem[]
  similar: SimilarMatch[]
  summary: string
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/\.pose$/, '')
}

function summarize(items: ImportItem[]): string {
  const count = (t: ImportItem['type']) =>
    items.filter((i) => i.type === t).length
  const parts: string[] = []
  if (count('model')) parts.push(`模型 ×${count('model')}`)
  if (count('animation')) parts.push(`动作 ×${count('animation')}`)
  if (count('pose')) parts.push(`姿势 ×${count('pose')}`)
  if (count('skip')) parts.push(`跳过 ×${count('skip')}`)
  return parts.length ? `识别为:${parts.join(' + ')}` : '没有可导入的内容'
}

function newId(): string {
  return 'lib-' + Math.random().toString(36).slice(2, 10)
}

/**
 * 识别 + 两层去重,生成导入计划(不落库)。
 * 第一层:剥动画 GLB 的内容哈希命中 → 跳过模型,仅收新动作;
 * 第二层:哈希不同但同族 + 顶点/骨骼数相同 → 记入 similar 交给用户。
 */
export async function planImport(
  files: File[],
  backend: LibraryBackend,
  deps: ImportDeps,
): Promise<ImportPlan> {
  const existing = await backend.listEntries()
  const items: ImportItem[] = []
  const similar: SimilarMatch[] = []

  for (const file of files) {
    if (file.name.endsWith('.pose.json')) {
      let parsed: ReturnType<typeof validatePoseJson> = null
      try {
        parsed = validatePoseJson(JSON.parse(await file.text()))
      } catch {
        parsed = null
      }
      if (!parsed) {
        items.push({
          type: 'skip',
          name: file.name,
          reason: '姿势 JSON 格式不正确',
        })
      } else {
        items.push({
          type: 'pose',
          name: baseName(file.name),
          rig: parsed.rig,
          bones: parsed.bones,
        })
      }
      continue
    }

    let loaded: LoadedModel
    try {
      loaded = await deps.load(file)
    } catch {
      items.push({type: 'skip', name: file.name, reason: '文件解析失败'})
      continue
    }
    const cls = classifyModel(loaded.root, loaded.animations)
    if (cls === 'unusable') {
      items.push({
        type: 'skip',
        name: file.name,
        reason: '无网格也无动画,无法识别',
      })
      continue
    }
    const rig = rigIdOf(loaded.root)

    if (cls !== 'animations-only') {
      let glb: ArrayBuffer | undefined
      try {
        glb = await deps.exportModel(loaded.root)
      } catch (err) {
        // 导出失败(贴图无效等)只跳过模型,不拖垮整批导入;
        // 下面的动作提取照常——Mixamo 类文件常常就是冲着动作来的
        console.warn('[assetLibrary] 模型导出失败', err)
        items.push({
          type: 'skip',
          name: baseName(file.name),
          reason: '模型导出失败',
        })
      }
      if (glb) {
        const contentHash = hashBytes(new Uint8Array(glb))
        const dup = existing.find(
          (e): e is ModelEntry =>
            e.kind === 'model' && e.contentHash === contentHash,
        )
        if (!dup) {
          const stats = meshStats(loaded.root)
          const boneCount = collectBoneNames(loaded.root).length
          const index =
            items.push({
              type: 'model',
              name: baseName(file.name),
              rig,
              contentHash,
              boneCount,
              vertexCount: stats.vertexCount,
              glb,
            }) - 1
          const hit = existing.find(
            (e): e is ModelEntry =>
              e.kind === 'model' &&
              e.rig === rig &&
              e.vertexCount === stats.vertexCount &&
              e.boneCount === boneCount &&
              e.contentHash !== contentHash,
          )
          if (hit) {
            similar.push({
              index,
              existingName: hit.name,
              newName: baseName(file.name),
            })
          }
        } else {
          items.push({
            type: 'skip',
            name: baseName(file.name),
            reason: '模型已存在(同库中「' + dup.name + '」)',
          })
        }
        // dup 命中:模型跳过,下面的动作照常提取
      }
    }

    for (const clip of loaded.animations) {
      let glb: ArrayBuffer
      try {
        glb = await deps.exportAnimation(loaded.root, clip)
      } catch (err) {
        // 单条动作导出失败不影响其它动作
        console.warn('[assetLibrary] 动作导出失败', err)
        items.push({
          type: 'skip',
          name: `${baseName(file.name)}/${clip.name}`,
          reason: '动作导出失败',
        })
        continue
      }
      const contentHash = hashBytes(new Uint8Array(glb))
      if (
        existing.some(
          (e) => e.kind === 'animation' && e.contentHash === contentHash,
        )
      ) {
        items.push({
          type: 'skip',
          name: `${baseName(file.name)}/${clip.name}`,
          reason: '动作已在库中',
        })
        continue
      }
      items.push({
        type: 'animation',
        name: clip.name || baseName(file.name),
        rig,
        contentHash,
        duration: clip.duration,
        glb,
      })
    }
  }

  return {items, similar, summary: summarize(items)}
}

/** 落库:choices 与 plan.similar 一一对应,'reuse' 丢弃对应 model 项 */
export async function executeImport(
  plan: ImportPlan,
  choices: Array<'reuse' | 'keep'>,
  library: Library,
): Promise<void> {
  const drop = new Set(
    plan.similar.filter((_, i) => choices[i] === 'reuse').map((s) => s.index),
  )
  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i]
    if (item.type === 'skip') continue
    if (item.type === 'model') {
      if (drop.has(i)) continue
      await library.putBlobWithEntry(
        new Blob([item.glb]),
        (blobId): ModelEntry => ({
          id: newId(),
          kind: 'model',
          name: item.name,
          rig: item.rig,
          blobId,
          contentHash: item.contentHash,
          boneCount: item.boneCount,
          vertexCount: item.vertexCount,
          createdAt: Date.now(),
        }),
      )
    } else if (item.type === 'animation') {
      await library.putBlobWithEntry(
        new Blob([item.glb]),
        (blobId): AnimationEntry => ({
          id: newId(),
          kind: 'animation',
          name: item.name,
          rig: item.rig,
          blobId,
          contentHash: item.contentHash,
          duration: item.duration,
          createdAt: Date.now(),
        }),
      )
    } else {
      await library.putEntry({
        id: newId(),
        kind: 'pose',
        name: item.name,
        rig: item.rig,
        bones: item.bones,
        createdAt: Date.now(),
      })
    }
  }
}

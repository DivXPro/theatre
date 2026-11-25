import type {AnimationClip, Group, Object3D} from 'three'
import {translate, type TFunction} from '@dreamerbird/studio/i18n'
import {classifyModel, validatePoseJson} from './classify'
import {createGLTFLoader} from './gltfLoader'
import {createResourceUrlModifier} from './gltfResourceSet'
import {exportAnimationGLB, exportModelGLB} from './exportGLB'
import {hashBytes} from './hash'
import type {Library} from './library'
import {collectBoneNames, meshStats, rigIdOf} from './rig'
import type {AnimationEntry, ModelEntry, PoseEntry} from './types'

export type LoadedModel = {root: Group; animations: AnimationClip[]}

/** 依赖注入:测试给假实现,UI 给 FBXLoader/GLTFLoader + GLTFExporter 真实现 */
export type ImportDeps = {
  load: (file: File) => Promise<LoadedModel>
  exportModel: (root: Object3D) => Promise<ArrayBuffer>
  exportAnimation: (root: Object3D, clip: AnimationClip) => Promise<ArrayBuffer>
}

export const realImportDeps: (files?: File[]) => ImportDeps = (files) => ({
  load: (file) => defaultLoad(file, files),
  exportModel: exportModelGLB,
  exportAnimation: exportAnimationGLB,
})

async function defaultLoad(
  file: File,
  resourceFiles?: File[],
): Promise<LoadedModel> {
  const {FBXLoader} = await import('three-stdlib')
  const {LoadingManager} = await import('three')
  if (resourceFiles && /\.gltf$/i.test(file.name)) {
    const resources = createResourceUrlModifier(resourceFiles)
    try {
      const gltf = await createGLTFLoader(resources.manager).parseAsync(
        await file.text(),
        '',
      )
      return {root: gltf.scene as Group, animations: gltf.animations}
    } finally {
      resources.dispose()
    }
  }
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
      sourceFile?: string
      rig: string
      contentHash: string
      boneCount: number
      vertexCount: number
      glb: ArrayBuffer
    }
  | {
      type: 'animation'
      name: string
      sourceFile?: string
      rig: string
      contentHash: string
      duration: number
      glb: ArrayBuffer
    }
  | {
      type: 'pose'
      name: string
      sourceFile?: string
      rig: string
      bones: PoseEntry['bones']
    }
  | {
      type: 'skip'
      name: string
      sourceFile?: string
      reason: string
      duplicate?: boolean
    }

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

function summarize(items: ImportItem[], tr: TFunction): string {
  const count = (t: ImportItem['type']) =>
    items.filter((i) => i.type === t).length
  const parts: string[] = []
  if (count('model'))
    parts.push(tr('pg.import.summary.models', {count: count('model')}))
  if (count('animation'))
    parts.push(tr('pg.import.summary.animations', {count: count('animation')}))
  if (count('pose'))
    parts.push(tr('pg.import.summary.poses', {count: count('pose')}))
  if (count('skip'))
    parts.push(tr('pg.import.summary.skips', {count: count('skip')}))
  return parts.length
    ? tr('pg.import.summary.prefix') + parts.join(' + ')
    : tr('pg.import.summary.empty')
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
  library: Pick<Library, 'listEntries'>,
  deps: ImportDeps,
  tr: TFunction = translate,
): Promise<ImportPlan> {
  const existing = await library.listEntries()
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
          sourceFile: file.name,
          reason: tr('pg.import.reason.badPoseJson'),
        })
      } else {
        items.push({
          type: 'pose',
          name: baseName(file.name),
          sourceFile: file.name,
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
      items.push({
        type: 'skip',
        name: file.name,
        sourceFile: file.name,
        reason: tr('pg.import.reason.parseFailed'),
      })
      continue
    }
    const cls = classifyModel(loaded.root, loaded.animations)
    if (cls === 'unusable') {
      items.push({
        type: 'skip',
        name: file.name,
        sourceFile: file.name,
        reason: tr('pg.import.reason.noContent'),
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
          sourceFile: file.name,
          reason: tr('pg.import.reason.modelExportFailed'),
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
              sourceFile: file.name,
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
            sourceFile: file.name,
            reason: tr('pg.import.reason.modelExists', {name: dup.name}),
            duplicate: true,
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
          sourceFile: file.name,
          reason: tr('pg.import.reason.animationExportFailed'),
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
          sourceFile: file.name,
          reason: tr('pg.import.reason.animationExists'),
          duplicate: true,
        })
        continue
      }
      items.push({
        type: 'animation',
        name: clip.name || baseName(file.name),
        sourceFile: file.name,
        rig,
        contentHash,
        duration: clip.duration,
        glb,
      })
    }
  }

  return {items, similar, summary: summarize(items, tr)}
}

export class ImportItemWriteError extends Error {
  constructor(
    readonly item: Exclude<ImportItem, {type: 'skip'}>,
    readonly cause: unknown,
  ) {
    super(
      `导入项 ${item.name} 写入失败: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    )
    this.name = 'ImportItemWriteError'
  }
}

export async function storeModelAsset(
  library: Library,
  model: Pick<
    ModelEntry,
    'name' | 'rig' | 'contentHash' | 'boneCount' | 'vertexCount'
  > & {
    glb: ArrayBuffer
  },
): Promise<ModelEntry> {
  const {glb, ...metadata} = model
  let entry!: ModelEntry
  await library.putBlobWithEntry(new Blob([glb]), (blobId) => {
    entry = {
      id: newId(),
      kind: 'model',
      ...metadata,
      blobId,
      createdAt: Date.now(),
    }
    return entry
  })
  return entry
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
    try {
      if (item.type === 'model') {
        if (drop.has(i)) continue
        const {name, rig, contentHash, boneCount, vertexCount, glb} = item
        await storeModelAsset(library, {
          name,
          rig,
          contentHash,
          boneCount,
          vertexCount,
          glb,
        })
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
    } catch (error) {
      throw new ImportItemWriteError(item, error)
    }
  }
}

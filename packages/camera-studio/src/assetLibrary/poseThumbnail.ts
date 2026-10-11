// packages/playground/src/shared/camera/assetLibrary/poseThumbnail.ts
/**
 * 姿势缩略图运行时渲染(2026-10-05):QBX 手势的预览图随包播种
 * (poseThumbsQbx),身体姿势(DPL/程序化基础)源包不在磁盘,改为运行
 * 时离屏渲染——从库里取同骨架族模型的 GLB,套上姿势逐张渲染 128×128
 * PNG,写库挂 thumbnailId。凡库里能找到同族模型的姿势条目(含用户
 * 自存姿势)都能补图;纯手势条目跳过(有随包图,且全身取景看不清手)。
 *
 * 与模型缩略图(thumbnail.ts)同套路:WebGL 不可用/解析失败一律告警
 * 降级,不阻塞主流程。一个骨架族只解析一次 GLB,逐姿势重置绑定姿势
 * 再套用,避免骨骼残留串图。
 */
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three'
import type {Group} from 'three'
import {createGLTFLoader} from './gltfLoader'
import {applyPose, captureBindPose} from './pose'
import type {Library} from './library'
import type {ModelEntry, PoseEntry} from './types'
import {isHandPoseEntry} from '../gestureProps'

type Lib = Pick<
  Library,
  'listEntries' | 'listBlobIds' | 'getBlobUrl' | 'putBlobWithEntry'
>

/**
 * 给缺图(或图引用已死)的身体姿势条目补缩略图,返回补图数量。
 * 串行执行:渲染与写库都轻量,避免与交互抢主线程。
 *
 * opts.renderBatch:渲染器注入(测试用;缺省 = 真实 WebGL 离屏渲染)。
 */
export async function backfillPoseThumbnails(
  lib: Lib,
  opts: {
    renderBatch?: (
      lib: Lib,
      model: ModelEntry,
      entries: PoseEntry[],
    ) => Promise<number>
  } = {},
): Promise<number> {
  const render = opts.renderBatch ?? renderRigBatch
  const poses = (await lib.listEntries('pose')) as PoseEntry[]
  const liveBlobIds = new Set(await lib.listBlobIds())
  const pending = poses.filter(
    (e) =>
      !isHandPoseEntry(e) && !(e.thumbnailId && liveBlobIds.has(e.thumbnailId)),
  )
  if (pending.length === 0) return 0
  // 每个骨架族取第一个有 blob 的模型条目当「模特」
  const modelByRig = new Map<string, ModelEntry>()
  for (const m of (await lib.listEntries('model')) as ModelEntry[]) {
    if (m.blobId && !modelByRig.has(m.rig)) modelByRig.set(m.rig, m)
  }
  let rendered = 0
  for (const [rig, entries] of groupByRig(pending)) {
    const model = modelByRig.get(rig)
    if (!model) continue // 无同族模型可渲染,跳过(下回再试)
    try {
      rendered += await render(lib, model, entries)
    } catch (err) {
      console.warn(`[assetLibrary] 姿势缩略图渲染失败(骨架族 ${rig})`, err)
    }
  }
  return rendered
}

function groupByRig(entries: PoseEntry[]): Map<string, PoseEntry[]> {
  const out = new Map<string, PoseEntry[]>()
  for (const e of entries) {
    const list = out.get(e.rig)
    if (list) list.push(e)
    else out.set(e.rig, [e])
  }
  return out
}

/** 一个骨架族一批:解析 GLB 一次,逐姿势 重置绑定姿势→套用→渲染→写库 */
async function renderRigBatch(
  lib: Lib,
  model: ModelEntry,
  entries: PoseEntry[],
): Promise<number> {
  const glbUrl = await lib.getBlobUrl(model.blobId)
  const glb = await (await fetch(glbUrl)).arrayBuffer()

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
  })
  try {
    const scene = new Scene()
    scene.add(new AmbientLight(0xffffff, 1.4))
    const dir = new DirectionalLight(0xffffff, 1.6)
    dir.position.set(3, 5, 4)
    scene.add(dir)

    const gltf = await new Promise<{scene: Group}>((resolve, reject) =>
      createGLTFLoader().parse(glb, '', resolve, reject),
    )
    scene.add(gltf.scene)
    const bindPose = captureBindPose(gltf.scene)

    // 取景:绑定姿势包围球 + 正面微侧视角(Mixamo 系面朝 +Z)。
    // 蒙皮网格的包围盒不随骨骼动,这里按绑定姿势取景并多留 25% 边距,
    // 躺下/蹲下等大幅姿势也不出画
    const box = new Box3().setFromObject(gltf.scene)
    const sphere = box.getBoundingSphere(new Sphere())
    const radius = sphere.radius || 1
    const fov = 40
    const distance = (radius / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.25
    const camera = new PerspectiveCamera(fov, 1, distance / 100, distance * 10)
    camera.position
      .copy(sphere.center)
      .add(new Vector3(0.25, 0.15, 1).normalize().multiplyScalar(distance))
    camera.lookAt(sphere.center)

    let rendered = 0
    for (const entry of entries) {
      applyPose(gltf.scene, bindPose)
      applyPose(gltf.scene, entry.bones)
      scene.updateMatrixWorld(true)
      renderer.render(scene, camera)
      const blob = await new Promise<Blob | undefined>((resolve) =>
        canvas.toBlob((b) => resolve(b ?? undefined), 'image/png'),
      )
      if (!blob) continue
      await lib.putBlobWithEntry(blob, (thumbnailId) => ({
        ...entry,
        thumbnailId,
      }))
      rendered++
    }
    return rendered
  } finally {
    renderer.dispose()
  }
}

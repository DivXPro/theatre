// packages/playground/src/shared/camera/assetLibrary/poseThumbsQbxUrls.ts
/**
 * QBX 手势预览图 URL 表(2026-10-05,姿势缩略图方案 A):
 * blender_export_qbx_previews.py 从 QBX 源包抽出的资产预览 PNG,
 * 按种子 key(qbx-hands-*)命名,vite 静态 glob 成 URL 表。
 *
 * 独立成模块是因为 jest 不支持 import.meta.glob:seedBuiltinPoses 通过
 * 动态 import 在运行时才加载本模块,测试直接驱动 seedBuiltinPosesInto
 * 时注入 thumbs 参数,永远不碰这里。
 */
const thumbUrls = import.meta.glob('./poseThumbsQbx/*.png', {
  eager: true,
  as: 'url',
}) as Record<string, string>

/** key(qbx-hands-01-base-base-l)→ 预览图 URL */
export const qbxThumbUrlByKey: Record<string, string> = Object.fromEntries(
  Object.entries(thumbUrls).map(([p, url]) => [
    p.replace('./poseThumbsQbx/', '').replace('.png', ''),
    url,
  ]),
)

import type {Object3D} from 'three'

/**
 * 只在编辑视角出现、不进镜头取景的对象登记表(镜头视锥线、瞄准点手柄、
 * 选中箭头等)。画中画/镜头视角渲染时统一隐藏,保证取景画面干净——
 * Blender 的镜头视图同样不画这些辅助对象。
 *
 * 不用 three 的 layers 实现:Raycaster 默认只测 layer 0,把辅助对象挪到
 * 别的层会让点选/拖拽失效,还要逐个改射线器,代价比"渲染前后切 visible"
 * 大得多。
 */
const editorOnlyObjects = new Set<Object3D>()

/** 登记一个编辑辅助对象,返回注销函数(卸载时调用) */
export function registerEditorOnly(obj: Object3D): () => void {
  editorOnlyObjects.add(obj)
  return () => {
    editorOnlyObjects.delete(obj)
  }
}

/** 隐藏全部编辑辅助对象后执行 fn(如同 gl.render),结束后恢复 */
export function withEditorOnlyHidden<T>(fn: () => T): T {
  const restore = hideEditorOnlyObjects()
  try {
    return fn()
  } finally {
    restore()
  }
}

/**
 * 隐藏全部编辑辅助对象并返回幂等恢复函数。
 *
 * 与 withEditorOnlyHidden 的区别是恢复时机由调用方决定:Previs 离线导出
 * 要跨越多帧/多个 await 保持隐藏,不能再包一个同步回调。
 */
export function hideEditorOnlyObjects(): () => void {
  const saved: Array<{obj: Object3D; visible: boolean}> = []
  for (const obj of editorOnlyObjects) {
    saved.push({obj, visible: obj.visible})
    obj.visible = false
  }
  let restored = false
  return () => {
    if (restored) return
    restored = true
    for (const {obj, visible} of saved) obj.visible = visible
  }
}

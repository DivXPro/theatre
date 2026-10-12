// packages/camera-studio/src/poseMode/poseExitGuard.ts
/**
 * 姿势退出快捷键(Enter)的目标守卫:交互元素(输入框/按钮/链接/下拉/
 * contentEditable)与 studio UI(shadow DOM)内的事件不触发退出——
 * 前者把 Enter 让给控件自身(按钮 Enter=click,会在保存后误触),
 * 后者让 studio 自己处理。
 */
export function isPoseExitGuardedTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest(
    'input, textarea, select, button, a, [contenteditable], [role="button"]',
  )
}

/**
 * 窗口级撤销/重做快捷键(spec §8.3):studio 自带快捷键只在其 UI 焦点内
 * 生效(9-23 终审遗留),画布焦点下 Ctrl+Z 石沉大海——playground 在
 * window 级接管,直达 studio.undo()/redo()(Task 1 公共 API)。
 * 两个不抢:可编辑目标(输入框自己的文本撤销);事件穿过 studio UI
 * (studio 会自己处理,一次按键撤两步是大坑)。
 */
export type UndoKeyEventLike = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isEditableTarget: boolean
  insideStudioUi: boolean
}

export function undoIntentFromKeyEvent(
  ev: UndoKeyEventLike,
): 'undo' | 'redo' | null {
  if (ev.isEditableTarget || ev.insideStudioUi) return null
  if (!ev.ctrlKey && !ev.metaKey) return null
  const key = ev.key.toLowerCase()
  if (key === 'z') return ev.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !ev.shiftKey) return 'redo'
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!(
    el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable)
  )
}

/**
 * studio UI 挂在 shadow DOM;事件 composedPath 含其宿主即视为 studio 内部。
 * 根标识实证:packages/studio/src/UI/UINonSSRBits.ts:17 设
 * `containerEl.id = 'theatrejs-studio-root'`(playground pipLayout.ts 同 id)。
 * 导出复用:姿势退出 Enter 守卫(F3)同样跳过 studio 内部按键。
 */
export function isInsideStudioUi(ev: KeyboardEvent): boolean {
  const path = ev.composedPath() as HTMLElement[]
  return path.some(
    (el) =>
      el instanceof HTMLElement &&
      (el.id === 'theatrejs-studio-root' ||
        el.dataset?.['theatreStudioRoot'] !== undefined),
  )
}

/** App 接线:返回注销函数 */
export function bindUndoShortcuts(
  undo: () => void,
  redo: () => void,
): () => void {
  const onKey = (ev: KeyboardEvent) => {
    const intent = undoIntentFromKeyEvent({
      key: ev.key,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      shiftKey: ev.shiftKey,
      isEditableTarget: isEditableTarget(ev.target),
      insideStudioUi: isInsideStudioUi(ev),
    })
    if (!intent) return
    ev.preventDefault()
    if (intent === 'undo') undo()
    else redo()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}

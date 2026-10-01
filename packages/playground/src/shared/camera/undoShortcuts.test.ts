/**
 * 窗口级撤销/重做快捷键(spec §8.3):
 *   Cmd/Ctrl+Z → undo;Cmd/Ctrl+Shift+Z 与 Ctrl+Y → redo。
 * 排除:可编辑目标(输入框/textarea/contentEditable);事件穿过 studio UI
 * 根(studio 自己处理,避免一次按键撤两步)。
 */
import {undoIntentFromKeyEvent} from './undoShortcuts'

const z = (over: Partial<Parameters<typeof undoIntentFromKeyEvent>[0]> = {}) =>
  undoIntentFromKeyEvent({
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    isEditableTarget: false,
    insideStudioUi: false,
    ...over,
  })

test('Ctrl/Cmd+Z = undo;加 Shift = redo;Ctrl+Y = redo', () => {
  expect(z()).toBe('undo')
  expect(z({metaKey: true, ctrlKey: false})).toBe('undo')
  expect(z({shiftKey: true})).toBe('redo')
  expect(z({metaKey: true, ctrlKey: false, shiftKey: true})).toBe('redo')
  expect(z({key: 'y'})).toBe('redo')
})

test('无修饰键/其他键 = null', () => {
  expect(z({ctrlKey: false})).toBe(null)
  expect(z({key: 'x'})).toBe(null)
})

test('可编辑目标与 studio UI 内事件 = null(不抢 studio/输入框的撤销)', () => {
  expect(z({isEditableTarget: true})).toBe(null)
  expect(z({insideStudioUi: true})).toBe(null)
})

test('已被上游 preventDefault 的按键 = null(另一方已撤,不重复撤)', () => {
  // 2026-10-01 冒烟实证:studio 快捷键实为 window 级(非注释原假设的
  // 「只在 UI 焦点内」),画布焦点下一次 Cmd+Z 撤两步。双侧互认
  // defaultPrevented 后,先跑的一方处理,后跑的一方跳过
  expect(z({defaultPrevented: true})).toBe(null)
})

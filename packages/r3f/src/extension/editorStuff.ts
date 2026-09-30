import type {ISheet, ISheetObject} from '@dreamerbird/core'
import {types, getStudioSync} from '@dreamerbird/core'
import {translate} from '@dreamerbird/studio/i18n'
import './i18n'

let sheet: ISheet | undefined = undefined
let sheetObject: ISheetObject<typeof editorSheetObjectConfig> | undefined =
  undefined

/** label 函数:面板每次渲染现调,语言切换热改(模块级配置,引用稳定) */
const editorLabel =
  (key: string): (() => string) =>
  () =>
    translate(key)

const editorSheetObjectConfig = {
  viewport: types.compound(
    {
      showAxes: types.boolean(true, {
        label: editorLabel('r3f.editor.showAxes'),
      }),
      showGrid: types.boolean(true, {
        label: editorLabel('r3f.editor.showGrid'),
      }),
      showOverlayIcons: types.boolean(false, {
        label: editorLabel('r3f.editor.showOverlayIcons'),
      }),
      shading: types.stringLiteral(
        'rendered',
        {
          flat: 'Flat',
          rendered: 'Rendered',
          solid: 'Solid',
          wireframe: 'Wireframe',
        },
        {as: 'menu', label: editorLabel('r3f.editor.shading')},
      ),
      referenceWindow: types.stringLiteral(
        'minimized',
        {
          maximized: 'Maximized',
          minimized: 'Minimized',
          hidden: 'Hidden',
        },
        {as: 'menu', label: editorLabel('r3f.editor.referenceWindow')},
      ),
    },
    {label: editorLabel('r3f.editor.viewport')},
  ),
  transformControls: types.compound(
    {
      mode: types.stringLiteral(
        'translate',
        {
          translate: 'Translate',
          rotate: 'Rotate',
          scale: 'Scale',
        },
        {as: 'switch', label: editorLabel('r3f.editor.mode')},
      ),
      space: types.stringLiteral(
        'world',
        {
          local: 'Local',
          world: 'World',
        },
        {as: 'switch', label: editorLabel('r3f.editor.space')},
      ),
    },
    {label: editorLabel('r3f.editor.transformControls')},
  ),
}

export function getEditorSheet(): ISheet {
  if (!sheet) {
    sheet = getStudioSync(true)!.getStudioProject().sheet('R3F UI')
  }
  return sheet
}

export function getEditorSheetObject(): ISheetObject<
  typeof editorSheetObjectConfig
> | null {
  if (!sheetObject) {
    sheetObject =
      getEditorSheet().object('Editor', editorSheetObjectConfig) || null
  }
  return sheetObject
}

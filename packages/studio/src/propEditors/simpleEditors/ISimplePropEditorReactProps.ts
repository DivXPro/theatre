import type {IBasePropType} from '@dreamerbird/core/types/public'
import type {IEditingTools} from '@dreamerbird/studio/propEditors/utils/IEditingTools'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'

/** Helper for defining consistent prop editor components */
export type ISimplePropEditorReactProps<
  TPropTypeConfig extends IBasePropType<string, any>,
> = {
  propConfig: TPropTypeConfig
  editingTools: IEditingTools<TPropTypeConfig['valueType']>
  value: TPropTypeConfig['valueType']
  autoFocus?: boolean
  /**
   * 正在编辑的对象(自定义编辑器用:按对象定位外部数据,如模型骨架族)。
   * 内置编辑器不消费此字段;面板渲染时总是传入,此处标可选只为不破坏
   * 既有自定义组件的类型。
   */
  obj?: SheetObject
}

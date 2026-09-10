import type {PropTypeConfig_StringLiteral} from '@dreamerbird/core/types/public'
import React, {useCallback} from 'react'
import BasicSwitch from '@dreamerbird/studio/uiComponents/form/BasicSwitch'
import BasicSelect from '@dreamerbird/studio/uiComponents/form/BasicSelect'
import type {ISimplePropEditorReactProps} from './ISimplePropEditorReactProps'

function StringLiteralPropEditor<TLiteralOptions extends string>({
  propConfig,
  editingTools,
  value,
  autoFocus,
}: ISimplePropEditorReactProps<PropTypeConfig_StringLiteral<TLiteralOptions>>) {
  const onChange = useCallback(
    (val: TLiteralOptions) => {
      editingTools.permanentlySetValue(val)
    },
    [propConfig, editingTools],
  )

  // 选项可以是函数(动态选项,比如库里的动作列表),渲染时现取;
  // 打开中的面板不随库变化实时刷新,重新选中/刷新后即为最新(既定取舍)
  const options =
    typeof propConfig.valuesAndLabels === 'function'
      ? propConfig.valuesAndLabels()
      : propConfig.valuesAndLabels

  return propConfig.as === 'menu' ? (
    <BasicSelect
      value={value}
      onChange={onChange}
      options={options}
      autoFocus={autoFocus}
    />
  ) : (
    <BasicSwitch
      value={value}
      onChange={onChange}
      options={options}
      autoFocus={autoFocus}
    />
  )
}

export default StringLiteralPropEditor

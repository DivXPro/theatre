import type {PropTypeConfig_StringLiteral} from '@toy-box/core/types/public'
import React, {useCallback} from 'react'
import BasicSwitch from '@toy-box/studio/uiComponents/form/BasicSwitch'
import BasicSelect from '@toy-box/studio/uiComponents/form/BasicSelect'
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

  return propConfig.as === 'menu' ? (
    <BasicSelect
      value={value}
      onChange={onChange}
      options={propConfig.valuesAndLabels}
      autoFocus={autoFocus}
    />
  ) : (
    <BasicSwitch
      value={value}
      onChange={onChange}
      options={propConfig.valuesAndLabels}
      autoFocus={autoFocus}
    />
  )
}

export default StringLiteralPropEditor

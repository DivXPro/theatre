import type {
  IBasePropType,
  PropTypeConfig_AllSimples,
} from '@dreamerbird/core/types/public'
import React, {useMemo} from 'react'
import {useEditingToolsForSimplePropInDetailsPanel} from '@dreamerbird/studio/propEditors/useEditingToolsForSimpleProp'
import {SingleRowPropEditor} from '@dreamerbird/studio/panels/DetailPanel/DeterminePropEditorForDetail/SingleRowPropEditor'
import type {Pointer} from '@dreamerbird/dataverse'
import {getPointerParts} from '@dreamerbird/dataverse'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import type {ISimplePropEditorReactProps} from '@dreamerbird/studio/propEditors/simpleEditors/ISimplePropEditorReactProps'
import {whatPropIsHighlighted} from '@dreamerbird/studio/panels/SequenceEditorPanel/whatPropIsHighlighted'

export type IDetailSimplePropEditorProps<
  TPropTypeConfig extends IBasePropType<string, any>,
> = {
  propConfig: TPropTypeConfig
  pointerToProp: Pointer<TPropTypeConfig['valueType']>
  obj: SheetObject
  visualIndentation: number
  SimpleEditorComponent: React.FC<ISimplePropEditorReactProps<TPropTypeConfig>>
}

/**
 * Shown in the Object details panel, changes to this editor are usually reflected at either
 * the playhead position (the `sequence.position`) or if static, the static override value.
 */
function DetailSimplePropEditor<
  TPropTypeConfig extends PropTypeConfig_AllSimples,
>({
  propConfig,
  pointerToProp,
  obj,
  SimpleEditorComponent: EditorComponent,
}: IDetailSimplePropEditorProps<TPropTypeConfig>) {
  const editingTools = useEditingToolsForSimplePropInDetailsPanel(
    pointerToProp,
    obj,
    propConfig,
  )

  const isPropHighlightedD = useMemo(
    () =>
      whatPropIsHighlighted.getIsPropHighlightedD({
        ...obj.address,
        pathToProp: getPointerParts(pointerToProp).path,
      }),
    [pointerToProp],
  )

  return (
    <SingleRowPropEditor
      {...{
        editingTools: editingTools,
        propConfig,
        pointerToProp,
        isPropHighlightedD,
      }}
    >
      <EditorComponent
        editingTools={editingTools}
        propConfig={propConfig}
        value={editingTools.value}
      />
    </SingleRowPropEditor>
  )
}

export default React.memo(DetailSimplePropEditor)

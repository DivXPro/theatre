/** Version-matched integration with Camera Studio. Import Studio to start it. */
import type {OnDiskState, ProjectId} from '@dreamerbird/core'
import type {ProjectEphemeralState} from '@dreamerbird/core/types/private'
import type {Atom} from '@dreamerbird/dataverse'
import type {ComponentPropsWithRef, ComponentType, Context} from 'react'
import {PortalContext as studioPortalContext} from 'reakit'
import getStudioInternal from './getStudio'
import {SequenceRowIconButton as StudioSequenceRowIconButton} from './panels/SequenceEditorPanel/DopeSheet/Left/AnyCompositeRow'
import type {ITransactionPrivateApi} from './StudioStore/StudioStore'
import StudioDetailPanelButton from './uiComponents/DetailPanelButton'
import StudioToolbarIconButton from './uiComponents/toolbar/ToolbarIconButton'
import StudioToolbarSwitchSelectContainer from './uiComponents/toolbar/ToolbarSwitchSelectContainer'

type CameraStudioInternals = {
  readonly initialized: Promise<void>
  readonly _store: {
    hasTemporaryChanges(): boolean
    subscribeToProjectState(
      projectId: ProjectId,
      listener: (state: OnDiskState) => void,
    ): () => void
  }
  readonly ephemeralAtom: Pick<
    Atom<{coreByProject: Record<string, ProjectEphemeralState>}>,
    'reduceByPointer'
  >
  transaction(
    fn: (api: ITransactionPrivateApi) => void,
    undoable?: boolean,
  ): unknown
}

export const getStudio: () => CameraStudioInternals = getStudioInternal
export const PortalContext: Context<HTMLElement | null> = studioPortalContext

type ButtonComponent = ComponentType<ComponentPropsWithRef<'button'>>
export const SequenceRowIconButton: ButtonComponent =
  StudioSequenceRowIconButton
export const DetailPanelButton: ButtonComponent = StudioDetailPanelButton
export const ToolbarIconButton: ButtonComponent = StudioToolbarIconButton
export const ToolbarSwitchSelectContainer: ComponentType<
  ComponentPropsWithRef<'div'>
> = StudioToolbarSwitchSelectContainer

export {pruneObjectFromOutlineCollections} from './panels/OutlinePanel/outlineOps/stateOps'
export {
  getSequenceEditorView,
  registerAdditionalSequenceRows,
  registerSequenceEditorView,
  revealAdditionalSequenceRows,
  type AdditionalSequenceRow,
} from './panels/SequenceEditorPanel/additionalRows'
export type {SequenceEditorPanelLayout} from './panels/SequenceEditorPanel/layout/layout'
export {
  registerCustomPropEditor,
  unregisterCustomPropEditor,
} from './propEditors/customPropEditors'
export type {ISimplePropEditorReactProps} from './propEditors/simpleEditors/ISimplePropEditorReactProps'
export {
  default as usePopover,
  PopoverAutoCloseLock,
} from './uiComponents/Popover/usePopover'
export type {ContextMenuItem} from './uiComponents/chordial/chordialInternals'
export {default as ContextMenu} from './uiComponents/simpleContextMenu/ContextMenu/ContextMenu'
export {default as useContextMenu} from './uiComponents/simpleContextMenu/useContextMenu'
export {default as useMenu} from './uiComponents/simpleContextMenu/useMenu'
export {default as useDrag} from './uiComponents/useDrag'
export {default as useRefAndState} from './utils/useRefAndState'

import type {ISheetObject} from '@dreamerbird/core'
import {Atom, val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import type {ReactNode} from 'react'
import type {SequenceEditorPanelLayout} from './layout/layout'

export type AdditionalSequenceRow = {
  id: string
  hasContent(): boolean
  renderHeader(): ReactNode
  renderTrack(layout: Pointer<SequenceEditorPanelLayout>): ReactNode
}

type TimelineObject = Pick<ISheetObject, 'address'>
const registrations = new Atom(new Map<TimelineObject, AdditionalSequenceRow>())

export function registerAdditionalSequenceRow(
  object: TimelineObject,
  row: AdditionalSequenceRow,
): () => void {
  registrations.set(new Map(registrations.get()).set(object, row))
  return () => {
    const rows = new Map(registrations.get())
    if (rows.get(object) !== row) return
    rows.delete(object)
    registrations.set(rows)
  }
}

export function getAdditionalSequenceRow(
  object: TimelineObject,
): AdditionalSequenceRow | undefined {
  return val(registrations.pointer).get(object)
}

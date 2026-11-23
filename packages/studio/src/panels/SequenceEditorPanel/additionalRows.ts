import type {ISequence, ISheetObject} from '@dreamerbird/core'
import {Atom, val} from '@dreamerbird/dataverse'
import type {Pointer} from '@dreamerbird/dataverse'
import type {ReactNode} from 'react'
import type {SequenceEditorPanelLayout} from './layout/layout'
import {createStudioSheetItemKey} from '@dreamerbird/studio/utils/createStudioSheetItemKey'
import {setCollapsedSheetItem} from './DopeSheet/setCollapsedSheetObjectOrCompoundProp'

export type AdditionalSequenceRow = {
  id: string
  countsAsTrack?: boolean
  hasContent?(): boolean
  /**
   * Additional rows can contribute actions to their sheet-object row without
   * taking an extra row of their own.
   */
  renderObjectHeader?(): ReactNode
  /** When false, keep the registration but do not reserve a timeline row. */
  isHeaderVisible?(): boolean
  renderHeader(): ReactNode
  renderTrack(layout: Pointer<SequenceEditorPanelLayout>): ReactNode
  renderSidebar?(): ReactNode
}

type TimelineObject = Pick<ISheetObject, 'address'>
type ResolveRows = () => readonly AdditionalSequenceRow[]
const registrations = new Atom(
  new Map<TimelineObject, {resolve: ResolveRows}>(),
)
const emptyRows: readonly AdditionalSequenceRow[] = []
const revealListeners = new Set<() => void>()

type SequenceEditorView = {
  timeline: ReactNode
  sidebar: ReactNode
}

const views = new Atom(new Map<ISequence, SequenceEditorView>())

export function getSequenceEditorView(sequence: ISequence) {
  return val(views.pointer).get(sequence)
}

export function registerSequenceEditorView(
  sequence: ISequence,
  view: SequenceEditorView,
): (() => void) | undefined {
  if (views.get().has(sequence)) return
  views.set(new Map(views.get()).set(sequence, view))
  return () => {
    const remaining = new Map(views.get())
    if (remaining.get(sequence) !== view) return
    remaining.delete(sequence)
    views.set(remaining)
  }
}

export function registerAdditionalSequenceRow(
  object: TimelineObject,
  rowOrResolve:
    | AdditionalSequenceRow
    | (() => AdditionalSequenceRow | undefined),
): () => void {
  return registerAdditionalSequenceRows(object, () => {
    const row =
      typeof rowOrResolve === 'function' ? rowOrResolve() : rowOrResolve
    return row ? [row] : emptyRows
  })
}

export function registerAdditionalSequenceRows(
  object: TimelineObject,
  resolve: ResolveRows,
): () => void {
  const registration = {resolve}
  registrations.set(new Map(registrations.get()).set(object, registration))
  return () => {
    const rows = new Map(registrations.get())
    if (rows.get(object) !== registration) return
    rows.delete(object)
    registrations.set(rows)
  }
}

export function getAdditionalSequenceRow(
  object: TimelineObject,
): AdditionalSequenceRow | undefined {
  return getAdditionalSequenceRows(object)[0]
}

export function getAdditionalSequenceRows(
  object: TimelineObject,
): readonly AdditionalSequenceRow[] {
  return val(registrations.pointer).get(object)?.resolve() ?? emptyRows
}

/**
 * 这条附加行是否真的需要在时间轴上占据一行。对象工具行（只提供行头按钮，
 * 头部本身隐藏）不算时间轴数据，不应仅因为它被注册就让空对象出现在左栏。
 */
export function additionalRowProvidesTimelineContent(
  row: AdditionalSequenceRow,
): boolean {
  if (!(row.isHeaderVisible?.() ?? true)) return false
  return row.hasContent?.() ?? true
}

/** 时间轴是否应因为这条附加行自动展开（工具行不算轨道）。 */
export function additionalRowCountsAsTrack(
  row: AdditionalSequenceRow,
): boolean {
  return (
    row.countsAsTrack !== false && additionalRowProvidesTimelineContent(row)
  )
}

export function onRevealAdditionalSequenceRows(
  listener: () => void,
): () => void {
  revealListeners.add(listener)
  return () => {
    revealListeners.delete(listener)
  }
}

export function revealAdditionalSequenceRows(object: ISheetObject): void {
  setCollapsedSheetItem(false, {
    sheetAddress: object.address,
    sheetItemKey: createStudioSheetItemKey.forSheet(),
  })
  setCollapsedSheetItem(false, {
    sheetAddress: object.address,
    sheetItemKey: createStudioSheetItemKey.forSheetObject(object),
  })
  for (const reveal of revealListeners) reveal()
}

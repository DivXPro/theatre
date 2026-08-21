// eslint-disable-next-line import/no-extraneous-dependencies
import type {IProject, ISheet, ISheetObject} from '@toy-box/core/types/public'
import type Project from '@toy-box/core/projects/Project'
import type SheetObject from '@toy-box/core/sheetObjects/SheetObject'
import type SheetObjectTemplate from '@toy-box/core/sheetObjects/SheetObjectTemplate'
import type Sheet from '@toy-box/core/sheets/Sheet'
import type SheetTemplate from '@toy-box/core/sheets/SheetTemplate'
import type {$IntentionalAny} from '@toy-box/core/types/public'

/**
 * Since \@toy-box/core and \@toy-box/studio are separate bundles,
 * they cannot use `x instanceof Y` to detect object types.
 *
 * The functions in this module are supposed to be a replacement for that.
 */

export const isProject = typeAsserter<Project>('Theatre_Project')

export const isSheet = typeAsserter<Sheet>('Theatre_Sheet')
export const isSheetTemplate = typeAsserter<SheetTemplate>(
  'Theatre_SheetTemplate',
)

export const isSheetObject = typeAsserter<SheetObject>('Theatre_SheetObject')

export const isSheetObjectTemplate = typeAsserter<SheetObjectTemplate>(
  'Theatre_SheetObjectTemplate',
)

export const isProjectPublicAPI = typeAsserter<IProject>(
  'Theatre_Project_PublicAPI',
)

export const isSheetPublicAPI = typeAsserter<ISheet>('Theatre_Sheet_PublicAPI')

export const isSheetObjectPublicAPI = typeAsserter<ISheetObject>(
  'Theatre_SheetObject_PublicAPI',
)

function typeAsserter<T extends {type: string}>(
  t: T['type'],
): (v: unknown) => v is T {
  return (v: unknown): v is T =>
    typeof v === 'object' && !!v && (v as $IntentionalAny).type === t
}

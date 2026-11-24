import type Project from '@dreamerbird/core/projects/Project'
import type Sequence from '@dreamerbird/core/sequences/Sequence'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import type Sheet from '@dreamerbird/core/sheets/Sheet'
import {prism, val} from '@dreamerbird/dataverse'
import type {$IntentionalAny} from '@dreamerbird/dataverse/src/types'
import type {SheetId} from '@dreamerbird/core/types/public'
import {uniq} from 'lodash-es'
import getStudio from './getStudio'
import {__private} from '@dreamerbird/core'
const {isSheet, isSheetObject} = __private.instanceTypes

export type OutlineSelectable = Project | Sheet | SheetObject
export type OutlineSelection = OutlineSelectable[]

export const outlineSelection = prism((): OutlineSelection => {
  const projects = val(getStudio().projectsP)

  const mapped: (OutlineSelectable | undefined)[] = (
    val(getStudio().atomP.historic.panels.outlinePanel.selection) ?? []
  ).map((s) => {
    const project = projects[s.projectId]
    if (!project) return
    if (s.type === 'Project') return project
    const sheetTemplate = val(project.sheetTemplatesP[s.sheetId])
    if (!sheetTemplate) {
      return
    }
    const sheetInstance = getSelectedInstanceOfSheetId(project, s.sheetId)
    if (!sheetInstance) return
    if (s.type === 'Sheet') {
      return sheetInstance
    }
    const obj = val(sheetInstance.objectsP[s.objectKey])
    if (!obj) return
    return obj
  })

  return uniq(
    mapped.filter((s): s is OutlineSelectable => typeof s !== 'undefined'),
  )
})

export const getSelectedInstanceOfSheetId = (
  project: Project,
  selectedSheetId: string,
): Sheet | undefined => {
  const projectStateP =
    getStudio()!.atomP.historic.projects.stateByProjectId[
      project.address.projectId
    ]

  const instanceId = val(
    projectStateP.stateBySheetId[selectedSheetId as SheetId].selectedInstanceId,
  )

  const template = val(project.sheetTemplatesP[selectedSheetId])

  if (!template) return undefined

  if (instanceId) {
    return val(template.instancesP[instanceId])
  } else {
    // @todo #perf this will update every time an instance is added/removed.
    const allInstances = val(template.instancesP)

    return allInstances[keys(allInstances)[0]]
  }
}

function keys<T extends object>(obj: T): Exclude<keyof T, symbol | number>[] {
  return Object.keys(obj) as $IntentionalAny
}

/**
 * component instances could come and go all the time. This hook
 * makes sure we don't cause re-renders
 */
export function getRegisteredSheetIds(project: Project): string[] {
  return Object.keys(val(project.sheetTemplatesP))
}

export function getSelectedSequence(): undefined | Sequence {
  const selectedSheets = uniq(
    outlineSelection
      .getValue()
      .filter((s): s is SheetObject | Sheet => isSheet(s) || isSheetObject(s))
      .map((s) => (isSheetObject(s) ? s.sheet : s)),
  )
  const sheet = selectedSheets[0]
  if (!sheet) return

  return sheet.getSequence()
}

/** 时间轴要显示的 sheet:大纲选中项能定位到唯一 sheet 就用它,否则回退到
 *  项目的第一个 sheet——面板始终显示,不随选中状态消失 */
export const timelineSheet = prism<Sheet | undefined>(() => {
  const selectedSheets = uniq(
    outlineSelection
      .getValue()
      .filter((s): s is SheetObject | Sheet => isSheet(s) || isSheetObject(s))
      .map((s) => (isSheetObject(s) ? s.sheet : s)),
  )
  const selectedTemplates = uniq(selectedSheets.map((s) => s.template))
  if (selectedTemplates.length === 1) return selectedSheets[0]

  const projects = val(getStudio().projectsP)
  const project = projects[Object.keys(projects)[0]]
  if (!project) return undefined
  const templates = val(project.sheetTemplatesP)
  const template = templates[Object.keys(templates)[0]]
  if (!template) return undefined
  const instances = val(template.instancesP)
  return instances[Object.keys(instances)[0]]
})

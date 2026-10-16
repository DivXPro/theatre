import type {ISheet, ISheetObject} from '@dreamerbird/core'
import type {Prism, Pointer} from '@dreamerbird/dataverse'
import {getPointerParts, prism} from '@dreamerbird/dataverse'
import SimpleCache from '@dreamerbird/utils/SimpleCache'
import type {$IntentionalAny, VoidFn} from '@dreamerbird/core/types/public'
import type {OnDiskState} from '@dreamerbird/core'
import type {IScrub} from '@dreamerbird/core/types/public'
import type {Studio} from '@dreamerbird/studio/Studio'
import {outlineSelection} from './selectors'
import type SheetObject from '@dreamerbird/core/sheetObjects/SheetObject'
import getStudio from './getStudio'
import {debounce, uniq} from 'lodash-es'
import type Sheet from '@dreamerbird/core/sheets/Sheet'
import type {
  IExtension,
  IStudio,
  ITransactionAPI,
  PaneInstance,
  ProjectId,
  SerializablePrimitive,
} from '@dreamerbird/core/types/public'
import {
  disablePlayPauseKeyboardShortcut,
  enablePlayPauseKeyboardShortcut,
} from './UIRoot/useKeyboardShortcuts'
import type TheatreSheetObject from '@dreamerbird/core/sheetObjects/TheatreSheetObject'
import type TheatreSheet from '@dreamerbird/core/sheets/TheatreSheet'
import type {OutlineSelectionState} from '@dreamerbird/core/types/private/studio'
import type Project from '@dreamerbird/core/projects/Project'
import type SheetTemplate from '@dreamerbird/core/sheets/SheetTemplate'
import type SheetObjectTemplate from '@dreamerbird/core/sheetObjects/SheetObjectTemplate'
import type {PaneInstanceId} from '@dreamerbird/core/types/public'
import {__private} from '@dreamerbird/core'
import {
  getLanguage,
  getRegisteredLanguages,
  languageDisplayName,
  onLanguageChange,
  registerFallback,
  registerMessages,
  setLanguage,
  translate,
} from './i18n'
const {
  isSheet,
  isProject,
  isSheetPublicAPI,
  isSheetObject,
  isSheetObjectPublicAPI,
  isSheetObjectTemplate,
  isSheetTemplate,
} = __private.instanceTypes

export default class TheatreStudio implements IStudio {
  readonly ui = {
    hide() {
      getStudio().ui.hide()
    },

    get isHidden(): boolean {
      return getStudio().ui.isHidden
    },

    restore() {
      getStudio().ui.restore()
    },

    setLeftStripHidden(hidden: boolean) {
      getStudio().ui.setLeftStripHidden(hidden)
    },

    renderToolset(toolsetId: string, htmlNode: HTMLElement) {
      return getStudio().ui.renderToolset(toolsetId, htmlNode)
    },
  }

  /**
   * studio 初始化收尾完成的承诺(含持久化/同步状态恢复落库)。
   * 读恢复后状态前必须等它。
   */
  get initialized(): Promise<void> {
    return getStudio().initialized
  }

  /** i18n:取词条/切语言/注入词典(详见 IStudioI18nAPI) */
  readonly i18n = {
    t(key: string, vars?: Record<string, string | number>): string {
      return translate(key, vars)
    },
    getLanguage(): string {
      return getLanguage()
    },
    setLanguage(lang: string): void {
      setLanguage(lang)
    },
    registerMessages(lang: string, messages: Record<string, string>): void {
      registerMessages(lang, messages)
    },
    registerFallback(from: string, to: string): void {
      registerFallback(from, to)
    },
    onLanguageChange(fn: () => void): () => void {
      return onLanguageChange(fn)
    },
    getRegisteredLanguages(): string[] {
      return getRegisteredLanguages()
    },
    languageDisplayName(code: string, inLanguage?: string): string {
      return languageDisplayName(code, inLanguage)
    },
  }

  private readonly _cache = new SimpleCache()

  disablePlayPauseKeyboardShortcut(): void {
    // This API was originally introduced to respond to this issue: https://discord.com/channels/870988717190426644/870988717190426647/1067906775602430062
    // Ideally we need a coherent way for the user to control keyboard inputs, so we might revisit this in the future.
    disablePlayPauseKeyboardShortcut()
  }

  enablePlayPauseKeyboardShortcut(): void {
    // see disablePlayPauseKeyboardShortcut()
    enablePlayPauseKeyboardShortcut()
  }

  clearPersistentStorage(persistenceKey?: string): void {
    return getStudio().clearPersistentStorage(persistenceKey)
  }

  /**
   * @internal
   */
  constructor(internals: Studio) {}

  extend(extension: IExtension, opts?: {reconfigure?: boolean}): void {
    getStudio().extend(extension, opts)
  }

  transaction(fn: (api: ITransactionAPI) => void) {
    getStudio().transaction(({set, unset, stateEditors}) => {
      const forgetObject = (object: TheatreSheetObject) => {
        if (!isSheetObjectPublicAPI(object)) {
          throw new Error(
            `object in transactionApi.forgetObject(object) must be the return type of sheet.object(...)`,
          )
        }

        stateEditors.coreByProject.historic.sheetsById.forgetObject(
          object.address,
        )
      }

      const forgetSheet = (sheet: TheatreSheet) => {
        if (!isSheetPublicAPI(sheet)) {
          throw new Error(
            `sheet in transactionApi.forgetSheet(sheet) must be the return type of project.sheet()`,
          )
        }

        stateEditors.coreByProject.historic.sheetsById.forgetSheet(
          sheet.address,
        )
      }

      const sequenceProp = <V>(prop: Pointer<V>) => {
        const {path, root} = getPointerParts(prop)

        if (!isSheetObject(root)) {
          throw new Error(
            'Argument prop must be a pointer to a SheetObject property',
          )
        }

        const propAdress = {...root.address, pathToProp: path}

        stateEditors.coreByProject.historic.sheetsById.sequence.setPrimitivePropAsSequenced(
          propAdress,
        )
      }

      const unsequenceProp = <V>(prop: Pointer<V>) => {
        const {path, root} = getPointerParts(prop)

        if (!isSheetObject(root)) {
          throw new Error(
            'Argument prop must be a pointer to a SheetObject property',
          )
        }

        stateEditors.coreByProject.historic.sheetsById.sequence.setPrimitivePropAsStatic(
          {
            ...root.address,
            pathToProp: path,
            // V 无约束(接口签名如此),getValueByPointer 要求 SerializableValue
            value: root.getValueByPointer(
              prop as Pointer<$IntentionalAny>,
            ) as SerializablePrimitive,
          },
        )
      }

      return fn({
        set,
        unset,
        forgetObject,
        forgetSheet,
        sequenceProp,
        unsequenceProp,
      })
    })
  }

  private _getSelectionPrism(): Prism<(ISheetObject | ISheet)[]> {
    return this._cache.get('_getSelectionPrism()', () =>
      prism((): (ISheetObject | ISheet)[] => {
        return outlineSelection
          .getValue()
          .filter(
            (s): s is SheetObject | Sheet =>
              s.type === 'Theatre_SheetObject' || s.type === 'Theatre_Sheet',
          )
          .map((s) => s.publicApi)
      }),
    )
  }

  private _getSelection(): (ISheetObject | ISheet)[] {
    return this._getSelectionPrism().getValue()
  }

  setSelection(selection: Array<ISheetObject | ISheet>): void {
    const sanitizedSelection: Array<
      Project | Sheet | SheetObject | SheetTemplate | SheetObjectTemplate
    > = [...selection]
      .filter((s) => isSheetObjectPublicAPI(s) || isSheetPublicAPI(s))
      .map((s) => getStudio().corePrivateAPI!(s))

    // 选中是界面态不是创作内容:不可撤销(否则撤销栈顶被无视觉效果的
    // selection 条目霸占,连按 Ctrl+Z 多次都弹不到真改动)
    getStudio().transaction(({stateEditors}) => {
      const newSelectionState: OutlineSelectionState[] = []

      for (const item of uniq(sanitizedSelection)) {
        if (isProject(item)) {
          newSelectionState.push({type: 'Project', ...item.address})
        } else if (isSheet(item)) {
          newSelectionState.push({
            type: 'Sheet',
            ...item.template.address,
          })
          stateEditors.studio.historic.projects.stateByProjectId.stateBySheetId.setSelectedInstanceId(
            item.address,
          )
        } else if (isSheetTemplate(item)) {
          newSelectionState.push({type: 'Sheet', ...item.address})
        } else if (isSheetObject(item)) {
          newSelectionState.push({
            type: 'SheetObject',
            ...item.template.address,
          })
          stateEditors.studio.historic.projects.stateByProjectId.stateBySheetId.setSelectedInstanceId(
            item.sheet.address,
          )
        } else if (isSheetObjectTemplate(item)) {
          newSelectionState.push({type: 'SheetObject', ...item.address})
        }
      }
      stateEditors.studio.historic.panels.outline.selection.set(
        newSelectionState,
      )
    }, false)
  }

  onSelectionChange(fn: (s: (ISheetObject | ISheet)[]) => void): VoidFn {
    const studio = getStudio()

    return this._getSelectionPrism().onChange(studio.ticker, fn, true)
  }

  get selection(): Array<ISheetObject | ISheet> {
    return this._getSelection()
  }

  scrub(): IScrub {
    return getStudio().scrub()
  }

  undo(): void {
    getStudio().undo()
  }

  redo(): void {
    getStudio().redo()
  }

  getStudioProject() {
    const core = getStudio().core
    if (!core) {
      throw new Error(`You're calling studio.getStudioProject() before \`@dreamerbird/core\` is loaded. To fix this:
1. Check if \`@dreamerbird/core\` is import/required in your bundle.
2. Check the stack trace of this error and make sure the funciton that calls getStudioProject() is run after \`@dreamerbird/core\` is loaded.`)
    }
    return getStudio().getStudioProject(core)
  }

  debouncedScrub(threshold: number = 1000): Pick<IScrub, 'capture'> {
    let currentScrub: IScrub | undefined
    const scheduleCommit = debounce(() => {
      const s = currentScrub
      if (!s) return
      currentScrub = undefined
      s.commit()
    }, threshold)

    const capture = (arg: $IntentionalAny) => {
      if (!currentScrub) {
        currentScrub = this.scrub()
      }
      let errored = true
      try {
        currentScrub.capture(arg)
        errored = false
      } finally {
        if (errored) {
          const s = currentScrub
          currentScrub = undefined
          s.discard()
        } else {
          scheduleCommit()
        }
      }
    }

    return {capture}
  }

  createPane<PaneClass extends string>(
    paneClass: PaneClass,
  ): PaneInstance<PaneClass> {
    return getStudio().paneManager.createPane(paneClass)
  }

  destroyPane(paneId: string): void {
    return getStudio().paneManager.destroyPane(paneId as PaneInstanceId)
  }

  createContentOfSaveFile(projectId: string): OnDiskState {
    return getStudio().createContentOfSaveFile(projectId as ProjectId)
  }
}

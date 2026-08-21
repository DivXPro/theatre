import Scrub from '@toy-box/studio/Scrub'
import UI from '@toy-box/studio/UI/UI'
import type {Pointer, Ticker} from '@toy-box/dataverse'
import {Atom, PointerProxy, pointerToPrism} from '@toy-box/dataverse'
import type {
  CommitOrDiscardOrRecapture,
  ITransactionPrivateApi,
} from './StudioStore/StudioStore'
import StudioStore from './StudioStore/StudioStore'
import type {
  IExtension,
  IStudio,
  PaneClassDefinition,
  InitOpts,
} from '@toy-box/core/types/public'
import TheatreStudio from './TheatreStudio'
import {nanoid} from 'nanoid/non-secure'
import type Project from '@toy-box/core/projects/Project'
import type {CoreBits} from '@toy-box/core/CoreBundle'
import SimpleCache from '@toy-box/utils/SimpleCache'
import type {IProject, ISheet, ProjectId} from '@toy-box/core'
import PaneManager from './PaneManager'
import type * as _coreExports from '@toy-box/core/coreExports'
import type {
  OnDiskState,
  ProjectEphemeralState,
} from '@toy-box/core/types/private/core'
import type {Deferred} from '@toy-box/utils/defer'
import {defer} from '@toy-box/utils/defer'
import {DEFAULT_PERSISTENCE_KEY, sanitizeOpts} from './sanitizeOpts'
import shallowEqual from 'shallowequal'
import {createStore} from './IDBStorage'
import {getAllPossibleAssetIDs} from '@toy-box/studio/utils/assets'
import {notify} from './notify'
import type {RafDriverPrivateAPI} from '@toy-box/core/rafDrivers'
import {persistAtom} from '@toy-box/utils/persistAtom'
import produce from 'immer'
import Storno from './Storno/Storno'
import Auth from './Auth'
import type {$IntentionalAny} from '@toy-box/core/types/public'
import AppLink from './SyncStore/AppLink'
import SyncServerLink from './SyncStore/SyncServerLink'
import type {TrpcClientWrapped} from './SyncStore/utils'
import {wrapTrpcClientWithAuth} from './SyncStore/utils'

export type CoreExports = typeof _coreExports

const STUDIO_NOT_INITIALIZED_MESSAGE = `You seem to have imported '@toy-box/studio' but haven't initialized it. You can initialize the studio by:
\`\`\`
import theatre from '@toy-box/core'
theatre.init({studio: true})
\`\`\`

* If you didn't mean to import '@toy-box/studio', this means that your bundler is not tree-shaking it. This is most likely a bundler misconfiguration.

* If you meant to import '@toy-box/studio' without showing its UI, you can do that by running:

\`\`\`
import theatre from '@toy-box/core'
theatre.init({studio: true})
studio.ui.hide()
\`\`\`
`

const STUDIO_INITIALIZED_LATE_MSG = `You seem to have imported '@toy-box/studio' but called \`studio.initialize()\` after some delay.
Theatre.js projects remain in pending mode (won't play their sequences) until the studio is initialized, so you should place the \`studio.initialize()\` line right after the import line:

\`\`\`
import theatre from '@toy-box/core'
// ... and other imports

studio.initialize()
\`\`\`
`

export type StudioOpts = {
  /**
   * The url of the cloud backend (app + sync server). When `undefined` (the
   * default), the studio runs fully offline: no AppLink/SyncServerLink/Auth
   * is constructed and no network requests are made.
   */
  serverUrl?: string
  persistenceKey: string
  usePersistentStorage: boolean
  rafDriver: RafDriverPrivateAPI
}

export type UpdateCheckerResponse =
  | {hasUpdates: true; newVersion: string; releasePage: string}
  | {hasUpdates: false}

export class Studio {
  readonly ui: UI
  // this._uiInitDeferred.promise will resolve once this._ui is set

  readonly publicApi: IStudio
  readonly address: {studioId: string}
  readonly _projectsProxy: PointerProxy<Record<ProjectId, Project>> =
    new PointerProxy(new Atom({}).pointer)

  readonly projectsP: Pointer<Record<ProjectId, Project>> =
    this._projectsProxy.pointer

  readonly _store: StudioStore
  /**
   * Only set when a `serverUrl` is provided (i.e. cloud sync is enabled).
   * `undefined` in the default offline mode.
   */
  auth: Auth | undefined
  private readonly _storno = new Storno()

  private _corePrivateApi: CoreBits['privateAPI'] | undefined

  private readonly _cache = new SimpleCache()
  readonly paneManager: PaneManager

  /**
   * An atom holding the exports of '\@toy-box/core'. Will be undefined if '\@toy-box/core' is never imported
   */
  private _coreAtom = new Atom<{core?: CoreExports}>({})

  readonly ephemeralAtom = new Atom<{
    // reflects the value of _initializedDeferred.promise. Since it's in an atom, it can be accessed via a pointer
    initialized: boolean
    coreByProject: {[projectId in string]: ProjectEphemeralState}
    extensions: {
      byId: {[extensionId in string]?: IExtension}
      paneClasses: {
        [paneClassName in string]?: {
          extensionId: string
          classDefinition: PaneClassDefinition
        }
      }
    }
  }>({
    initialized: false,
    coreByProject: {},
    extensions: {
      byId: {},
      paneClasses: {},
    },
  })

  readonly ahistoricAtom = new Atom<{
    updateChecker?: {
      // timestamp of the last time we checked for updates
      lastChecked: number
      result: UpdateCheckerResponse | 'error'
    }
  }>({})
  /**
   * Tracks whether studio.initialize() is called.
   */
  private _initializeFnCalled = false
  /**
   * Will be set to true if studio.initialize() isn't called after 100ms.
   */
  private _didWarnAboutNotInitializing = false

  /**
   * This will be set as soon as `@toy-box/core` registers itself on `@toy-box/studio`
   */
  private _coreBits: CoreBits | undefined

  private _optsDeferred: Deferred<StudioOpts>

  private readonly _initializedPromise: Promise<void>

  readonly _rawLinks: {
    app: Promise<AppLink | null>
    syncServer: Promise<SyncServerLink | null>
  }

  /**
   * Only set when a `serverUrl` is provided (i.e. cloud sync is enabled).
   * `undefined` in the default offline mode.
   */
  authedLinks:
    | {
        app: TrpcClientWrapped<AppLink['api']>
        syncServer: TrpcClientWrapped<SyncServerLink['api']>
      }
    | undefined

  get ticker(): Ticker {
    if (!this._rafDriver) {
      throw new Error(
        '`studio.ticker` was read before studio.initialize() was called.',
      )
    }
    return this._rafDriver.ticker
  }

  private _rafDriver: RafDriverPrivateAPI | undefined

  get atomP() {
    return this._store.atomP
  }

  get _optsPromise() {
    return this._optsDeferred.promise
  }

  constructor() {
    this.address = {studioId: nanoid(10)}
    this._optsDeferred = defer()

    const syncServerLinkDeferred = defer<SyncServerLink | null>()
    const syncServerLink = syncServerLinkDeferred.promise
    const appLink = this._optsPromise.then(({serverUrl}): AppLink | null =>
      typeof window === 'undefined' || serverUrl === undefined
        ? null
        : new AppLink(serverUrl),
    )

    if (typeof window !== 'undefined') {
      void appLink
        .then((link) => {
          if (!link) {
            syncServerLinkDeferred.resolve(null)
            return
          }
          return link.api.syncServerUrl.query().then((url) => {
            syncServerLinkDeferred.resolve(new SyncServerLink(url))
          })
        })
        .catch((err) => {
          syncServerLinkDeferred.reject(err)
          console.error(err)
        })
    } else {
      syncServerLinkDeferred.resolve(null)
    }

    this._rawLinks = {app: appLink, syncServer: syncServerLink}

    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
      // Auth and the authed tRPC links only make sense when a cloud backend is
      // configured. In the default offline mode (`serverUrl === undefined`) we
      // skip constructing them entirely, so no network activity can occur.
      void this._optsPromise.then((opts) => {
        if (opts.serverUrl === undefined) return
        const auth = new Auth(this)
        this.auth = auth
        this.authedLinks = {
          syncServer: wrapTrpcClientWithAuth(
            this._rawLinks.syncServer.then((s) => s!.api),
            (fn: any, args: any[], path): any => {
              return auth.wrapTrpcProcedureWithAuth(
                fn,
                args as $IntentionalAny,
                path,
              )
            },
          ),

          app: wrapTrpcClientWithAuth(
            this._rawLinks.app.then((s) => s!.api),
            (fn: any, args: any[], path): any =>
              auth.wrapTrpcProcedureWithAuth(fn, args as $IntentionalAny, path),
          ),
        }
      })
    }

    this._store = new StudioStore(this)
    this.publicApi = new TheatreStudio(this)

    this.ui = new UI(this)

    this._attachToIncomingProjects()
    this.paneManager = new PaneManager(this)

    // check whether studio.initialize() is called, but only if we're in the browser
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        if (!this._initializeFnCalled) {
          console.error(STUDIO_NOT_INITIALIZED_MESSAGE)
          this._didWarnAboutNotInitializing = true
        }
      }, 100)
    }

    this._initializedPromise = this._init()

    this._initializedPromise.catch((reason) => {
      console.error(reason)
      return Promise.reject(reason)
    })
  }

  async _init() {
    const storeOpts = await this._optsDeferred.promise

    const ahistoricAtomInitializedD = defer<void>()
    if (storeOpts.usePersistentStorage) {
      persistAtom(
        this.ahistoricAtom,
        this.ahistoricAtom.pointer,
        () => {
          ahistoricAtomInitializedD.resolve()
        },
        'theatrejs-studio-ahistoric',
      )
    } else {
      ahistoricAtomInitializedD.resolve()
    }

    this._rafDriver = storeOpts.rafDriver

    if (process.env.NODE_ENV !== 'test' && typeof window !== 'undefined') {
      await this.ui.ready
    }

    await ahistoricAtomInitializedD.promise
    this.ephemeralAtom.setByPointer((p) => p.initialized, true)

    if (process.env.NODE_ENV !== 'test') {
      this.ui.render()
    }
  }

  async initialize(opts?: InitOpts) {
    if (!this._coreBits) {
      throw new Error(
        `You seem to have imported \`@toy-box/studio\` without importing \`@toy-box/core\`. Make sure to include an import of \`@toy-box/core\` before calling \`studio.initializer()\`.`,
      )
    }

    if (this._initializeFnCalled) {
      return this._initializedPromise
    }
    this._initializeFnCalled = true

    if (this._didWarnAboutNotInitializing) {
      console.warn(STUDIO_INITIALIZED_LATE_MSG)
    }

    if (this._optsDeferred.status === 'pending') {
      this._optsDeferred.resolve(sanitizeOpts(opts, this._coreBits))
    }

    return this._initializedPromise
  }

  get initialized(): Promise<void> {
    return this._initializedPromise
  }

  get initializedP(): Pointer<boolean> {
    return this.ephemeralAtom.pointer.initialized
  }

  _attachToIncomingProjects() {
    const projectsD = pointerToPrism(this.projectsP)

    const attachToProjects = (projects: Record<string, Project>) => {
      for (const project of Object.values(projects)) {
        if (!project.isAttachedToStudio) {
          project.attachToStudio(this)
        }
      }
    }
    projectsD.onStale(() => {
      attachToProjects(projectsD.getValue())
    })
    attachToProjects(projectsD.getValue())
  }

  setCoreBits(coreBits: CoreBits) {
    this._coreBits = coreBits
    this._corePrivateApi = coreBits.privateAPI
    this._coreAtom.setByPointer((p) => p.core, coreBits.coreExports)
    this._setProjectsP(coreBits.projectsP)
  }

  private _setProjectsP(projectsP: Pointer<Record<ProjectId, Project>>) {
    this._projectsProxy.setPointer(projectsP)
  }

  scrub() {
    return new Scrub(this)
  }

  tempTransaction(
    fn: (api: ITransactionPrivateApi) => void,
    existingTransaction: CommitOrDiscardOrRecapture | undefined = undefined,
  ): CommitOrDiscardOrRecapture {
    return this._store.tempTransaction(fn, existingTransaction)
  }

  transaction(
    fn: (api: ITransactionPrivateApi) => void,
    undoable: boolean = true,
  ): unknown {
    return this._store.transaction(fn, undoable)
  }

  get corePrivateAPI() {
    return this._corePrivateApi
  }

  get core() {
    return this._coreAtom.get().core
  }

  get coreP() {
    return this._coreAtom.pointer.core
  }

  extend(extension: IExtension, opts?: {__experimental_reconfigure?: boolean}) {
    if (!extension || typeof extension !== 'object') {
      throw new Error(`Extensions must be JS objects`)
    }

    if (typeof extension.id !== 'string') {
      throw new Error(`extension.id must be a string`)
    }

    const reconfigure = opts?.__experimental_reconfigure === true

    const extensionId = extension.id

    const prevExtension = this.ephemeralAtom.get().extensions.byId[extensionId]
    if (prevExtension) {
      if (reconfigure) {
      } else {
        if (
          extension === prevExtension ||
          shallowEqual(extension, prevExtension)
        ) {
          // probably running studio.extend() several times because of hot reload.
          // as long as it's the same extension, we can safely ignore.
          return
        }
        throw new Error(
          `Extension id "${extension.id}" is already defined. If you mean to re-configure the extension, do it like this: studio.extend(extension, {__experimental_reconfigure: true})})`,
        )
      }
    }

    this.ephemeralAtom.reduceByPointer(
      (p) => p.extensions,
      (extensions) => {
        return produce(extensions, (draft) => {
          draft.byId[extension.id] = extension

          const allPaneClasses = draft.paneClasses

          if (reconfigure && prevExtension) {
            // remove all pane classes that were set by the previous version of the extension
            prevExtension.panes?.forEach((classDefinition) => {
              delete allPaneClasses[classDefinition.class]
            })
          }

          // if the extension defines pane classes, add them to the list of all pane classes
          extension.panes?.forEach((classDefinition) => {
            if (typeof classDefinition.class !== 'string') {
              throw new Error(`pane.class must be a string`)
            }

            if (classDefinition.class.length < 3) {
              throw new Error(
                `pane.class should be a string with 3 or more characters`,
              )
            }

            const existing = allPaneClasses[classDefinition.class]
            if (existing) {
              if (reconfigure && existing.extensionId === extension.id) {
                // well this should never happen because we already deleted the pane class above
                console.warn(
                  `Pane class "${classDefinition.class}" already exists. This is a bug in Theatre.js. Please report it at https://github.com/theatre-js/theatre/issues/new`,
                )
              } else {
                throw new Error(
                  `Pane class "${classDefinition.class}" already exists and is supplied by extension ${existing}`,
                )
              }
            }

            allPaneClasses[classDefinition.class] = {
              extensionId: extension.id,
              classDefinition: classDefinition,
            }
          })
        })
      },
    )
  }

  getStudioProject(core: CoreExports): IProject {
    return this._cache.get('getStudioProject', () => core.getProject('Studio'))
  }

  getExtensionSheet(extensionId: string, core: CoreExports): ISheet {
    return this._cache.get('extensionSheet-' + extensionId, () =>
      this.getStudioProject(core)!.sheet('Extension ' + extensionId),
    )
  }

  undo() {
    this._store.undo()
  }

  redo() {
    this._store.redo()
  }

  createContentOfSaveFile(projectId: string): OnDiskState {
    return this._store.createContentOfSaveFile(projectId as ProjectId)
  }

  /** A function that returns a promise to an object containing asset storage methods for a project to be used by studio. */
  async createAssetStorage(project: Project, baseUrl?: string) {
    // in SSR we bail out and return a dummy asset manager
    if (typeof window === 'undefined') {
      return {
        getAssetUrl: () => '',
        createAsset: () => Promise.resolve(null),
      }
    }

    // Check for support.
    if (!('indexedDB' in window)) {
      if (process.env.NODE_ENV !== 'test')
        console.log("This browser doesn't support IndexedDB.")

      return {
        getAssetUrl: (assetId: string) => {
          throw new Error(
            `IndexedDB is required by the default asset manager, but it's not supported by this browser. To use assets, please provide your own asset manager to the project config.`,
          )
        },
        createAsset: (asset: Blob) => {
          throw new Error(
            `IndexedDB is required by the default asset manager, but it's not supported by this browser. To use assets, please provide your own asset manager to the project config.`,
          )
        },
      }
    }

    const idb = createStore(`${project.address.projectId}-assets`)

    // get all possible asset ids referenced by either static props or keyframes
    const possibleAssetIDs = getAllPossibleAssetIDs(project)

    // Clean up assets not referenced by the project. We can only do this at the start because otherwise
    // we'd break undo/redo.
    const idbKeys = await idb.keys<string>()
    await Promise.all(
      idbKeys.map(async (key) => {
        if (!possibleAssetIDs.includes(key)) {
          await idb.del(key)
        }
      }),
    )

    // Clean up idb entries exported to disk
    await Promise.all(
      idbKeys.map(async (key) => {
        const assetUrl = `${baseUrl}/${key}`

        try {
          const response = await fetch(assetUrl, {method: 'HEAD'})
          if (response.ok) {
            await idb.del(key)
          }
        } catch (e) {
          notify.error(
            'Failed to access assets',
            `Failed to access assets at ${
              project.config.assets?.baseUrl ?? '/'
            }. This is likely due to a CORS issue.`,
          )
        }
      }),
    )

    // A map for caching the assets outside of the db. We also need this to be able to retrieve idb asset urls synchronously.
    const assetsMap = new Map(await idb.entries<string, Blob>())

    // A map for caching the object urls created from idb assets.
    const urlCache = new Map<Blob, string>()

    /** Gets idb aset url from asset blob */
    const getUrlForAsset = (asset: Blob) => {
      if (urlCache.has(asset)) {
        return urlCache.get(asset)!
      } else {
        const url = URL.createObjectURL(asset)
        urlCache.set(asset, url)
        return url
      }
    }

    /** Gets idb asset url from id */
    const getUrlForId = (assetId: string) => {
      const asset = assetsMap.get(assetId)
      if (!asset) {
        throw new Error(`Asset with id ${assetId} not found`)
      }
      return getUrlForAsset(asset)
    }

    return {
      getAssetUrl: (assetId: string) => {
        return assetsMap.has(assetId)
          ? getUrlForId(assetId)
          : `${baseUrl}/${assetId}`
      },
      createAsset: async (asset: File) => {
        const existingIDs = getAllPossibleAssetIDs(project)

        let sameSame = false

        if (existingIDs.includes(asset.name)) {
          let existingAsset: Blob | undefined
          try {
            existingAsset =
              assetsMap.get(asset.name) ??
              (await fetch(`${baseUrl}/${asset.name}`).then((r) =>
                r.ok ? r.blob() : undefined,
              ))
          } catch (e) {
            notify.error(
              'Failed to access assets',
              `Failed to access assets at ${
                project.config.assets?.baseUrl ?? '/'
              }. This is likely due to a CORS issue.`,
            )

            return Promise.resolve(null)
          }

          if (existingAsset) {
            const blobCompare = (await import('blob-compare')).default

            // @ts-ignore
            sameSame = await blobCompare.isEqual(asset, existingAsset)

            // if same same, we do nothing
            if (sameSame) {
              return asset.name
              // if different, we ask the user to pls rename
            } else {
              /** Initiates rename using a dialog. Returns a boolean indicating if the rename was succesful. */
              const renameAsset = (text: string): boolean => {
                const newAssetName = prompt(text, asset.name)

                if (newAssetName === null) {
                  // asset creation canceled
                  return false
                } else if (newAssetName === '') {
                  return renameAsset(
                    'Asset name cannot be empty. Please choose a different file name for this asset.',
                  )
                } else if (existingIDs.includes(newAssetName)) {
                  console.log(existingIDs)
                  return renameAsset(
                    'An asset with this name already exists. Please choose a different file name for this asset.',
                  )
                }

                // rename asset
                asset = new File([asset], newAssetName, {type: asset.type})
                return true
              }

              // rename asset returns false if the user cancels the rename
              const success = renameAsset(
                'An asset with this name already exists. Please choose a different file name for this asset.',
              )

              if (!success) {
                return null
              }
            }
          }
        }

        assetsMap.set(asset.name, asset)
        await idb.set(asset.name, asset)
        return asset.name
      },
    }
  }

  clearPersistentStorage(persistenceKey = DEFAULT_PERSISTENCE_KEY) {
    this._store.__experimental_clearPersistentStorage(persistenceKey)
  }
}

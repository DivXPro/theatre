/**
 * Regression test for the final-review finding "restore vs. project-init race".
 *
 * The bug: `Studio._init` used to resolve `studio.initialized` without waiting
 * for the saaz front to finish restoring persisted state. A project attached
 * right after `studio.initialized` resolves (`Project.attachToStudio` →
 * `initialiseProjectState`, which reads the store after a single `delay(0)`)
 * could therefore read the pre-restore empty snapshot, queue a `setProjectState`
 * against it, and then have that queued op replay on top of the restored
 * snapshot — clobbering the persisted project back to empty.
 *
 * This test makes the race deterministic: the front storage adapter is delayed
 * per transaction (30ms), so a fresh restore takes ~90ms while the (broken)
 * `initialized` promise resolves in <1ms. If `studio.initialized` resolves
 * before the restore lands, reading the store afterwards yields no project.
 *
 * The mock keeps the seed and the reload on the SAME memory storage, mirroring
 * how IndexedDB survives a real page reload: the seed front's storage state is
 * exported and re-seeded into the reloaded front's adapter, and the backend
 * adapter is a shared singleton.
 *
 * jest-esbuild does not hoist `jest.mock`, so any static import of
 * `@toy-box/saaz` — directly, or transitively via `Studio` → `StudioStore` —
 * evaluates the real module into the registry before the mock registers, and
 * the factory never runs. The test therefore registers the mock with
 * `jest.doMock`, resets the module registry, and requires everything fresh so
 * every consumer of `@toy-box/saaz` (including `StudioStore`) resolves the mock.
 */
import type {$IntentionalAny} from '@toy-box/utils/types'

jest.setTimeout(20000)

const PROJECT_ID = 'p1'

test('studio.initialized does not resolve before persisted state is restored', async () => {
  jest.doMock('@toy-box/saaz', () => {
    const actual = jest.requireActual('@toy-box/saaz')

    const self: $IntentionalAny = {
      ...actual,
      __mockState: {
        seededFrontState: undefined as unknown | undefined,
        sharedBack: undefined as $IntentionalAny | undefined,
        firstFrontAdapter: undefined as $IntentionalAny | undefined,
      },
    }

    // Delays every storage transaction so a fresh restore is much slower than
    // `studio.initialized` resolving pre-fix. The second+ construction
    // re-seeds from the seed stack's exported state (surviving IndexedDB).
    class DelayedFrontMemoryAdapter extends actual.FrontMemoryAdapter {
      constructor() {
        const seeded = self.__mockState.seededFrontState
        super(seeded ? JSON.parse(JSON.stringify(seeded)) : undefined)
        if (!self.__mockState.firstFrontAdapter) {
          self.__mockState.firstFrontAdapter = this
        }
      }

      async transaction(fn: $IntentionalAny) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return super.transaction(fn)
      }
    }

    // All constructions return one shared instance, so the reloaded backend
    // sees the state the seed backend persisted (surviving back DB).
    class SharedBackMemoryAdapter extends actual.BackMemoryAdapter {
      constructor() {
        super()
        if (!self.__mockState.sharedBack) {
          self.__mockState.sharedBack = this
        }
        return self.__mockState.sharedBack
      }
    }

    self.FrontMemoryAdapter = DelayedFrontMemoryAdapter
    self.BackMemoryAdapter = SharedBackMemoryAdapter
    return self
  })
  jest.resetModules()

  const Saaz: $IntentionalAny = require('@toy-box/saaz')
  const {schema} = require('@toy-box/sync-server/state/schema')
  const {Studio} = require('@toy-box/studio/Studio')
  const {Atom, val} = require('@toy-box/dataverse')
  const mockState = Saaz.__mockState

  // ---- seed a persisted session, as a previous page load would have left ----
  // The backend dbName must match the one StudioStore uses in a node
  // environment ('test'), so the shared backend keeps one consistent key space.
  const seedBackend = new Saaz.SaazBack({
    dbName: 'test',
    storageAdapter: new Saaz.BackMemoryAdapter(),
    schema,
  })
  const seedFront = new Saaz.SaazFront({
    schema,
    dbName: 'studio',
    storageAdapter: new Saaz.FrontMemoryAdapter(),
    backend: seedBackend,
  })
  await seedFront.ready

  seedFront.tx(undefined, (cell: $IntentionalAny) => {
    cell.historic = {coreByProject: {[PROJECT_ID]: {marker: 'restored'}}}
  })
  await seedFront.waitForBackendSync()
  await seedFront.waitForStorageSync()
  seedFront.teardown()

  // capture the seed front's storage so the reloaded front reads it
  mockState.seededFrontState = mockState.firstFrontAdapter.export()

  // ---- reload: a fresh studio over the same (mocked) memory storage ----
  const studio = new Studio()
  studio.setCoreBits({
    privateAPI: () => undefined,
    getCoreRafDriver: () => undefined,
    coreExports: {},
    projectsP: new Atom({projects: {}}).pointer.projects,
  } as $IntentionalAny)

  void studio.initialize({usePersistentStorage: false})
  await studio.initialized

  // Project.attachToStudio → initialiseProjectState reads this store path.
  // Pre-fix the restore (delayed ~90ms) has not landed yet: the project is
  // missing and the read would trigger a clobber-to-empty. Post-fix
  // `studio.initialized` awaited the restore, so the project is present.
  const historic = val(studio.atomP.historic) as $IntentionalAny
  const restored = historic?.coreByProject?.[PROJECT_ID]
  expect(restored?.marker).toBe('restored')
})

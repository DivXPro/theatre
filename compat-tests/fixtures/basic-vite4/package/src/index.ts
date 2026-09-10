import theatre, {getProject} from '@dreamerbird/core'

const project = getProject('Sample project')
const sheet = project.sheet('Scene')

async function main(): Promise<void> {
  try {
    if (import.meta.env.MODE === 'development') {
      // 1.0 API: the studio bundle registers itself through this side-effect
      // import, and init() must be called before getStudio()
      await import('@dreamerbird/studio')
      await theatre.init({studio: true, usePersistentStorage: false})
      await theatre.getStudio()
    }

    // the compat-test harness (compat-tests/utils/testUtils.ts) listens for
    // console logs with this exact prefix
    console.log(
      `Test passed: light2.intensity n/a in basic-vite4 — theatre core + studio initialized without error (sheet "${sheet.address.sheetId}")`,
    )
  } catch (err) {
    console.error(
      `Test failed: light2.intensity n/a in basic-vite4 — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

void main()

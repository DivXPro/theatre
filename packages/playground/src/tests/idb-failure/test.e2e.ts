import {test, expect} from '@playwright/test'

/**
 * Real-browser verification that a persistence (IndexedDB) failure degrades to
 * in-memory editing instead of white-screening. fake-indexeddb does not
 * simulate open failure, so this path can only be covered in a real browser.
 */
test('degrades to in-memory editing when IndexedDB is unavailable', async ({
  page,
}) => {
  // Simulate IndexedDB being unavailable (private mode / quota-exceeded)
  // before the app loads.
  await page.addInitScript(() => {
    const idb = window.indexedDB
    if (idb) {
      idb.open = () => {
        throw new Error('IndexedDB disabled')
      }
    }
  })

  await page.goto('./shared/dom-basic/')

  // the scene mounted (its boxes render) — no white screen
  await expect(page.locator('text=Top Left').first()).toBeVisible()

  // select the project so the detail panel (which hosts the banner) shows.
  // Click the outline header (`[data-header]`) rather than the label text:
  // the label's innermost text span has a 0-height box (the studio centers it
  // via `line-height: 0` + flex), so text-based locators resolve to a span
  // Playwright can't click.
  await page
    .locator('[data-header]', {hasText: 'Sample project'})
    .first()
    .click()

  // the persistence banner appears
  await expect(page.locator('[data-testid="persistence-banner"]')).toBeVisible()
})

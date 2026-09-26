/**
 * A `BrowserBridge` backed by Playwright, so `testInBrowser` can run in WEBKIT.
 *
 * haltija's own `--headless` is Playwright CHROMIUM only, and Chromium is the
 * engine that measures zero for the thing this suite exists to measure —
 * CLAUDE.md records that WebKit does not shape across text-node boundaries and
 * Chromium does. The bridge being structural (`eval`/`click`/`type`/`press`,
 * "any haltija client satisfies it") is what makes this possible at all: the
 * probe/assertion split is useful independently of how the page is driven.
 */
import type { Page } from 'playwright'
import type { BrowserBridge } from 'haltija/test'

export function playwrightBridge(page: Page): BrowserBridge {
  return {
    async eval(code: string) {
      // Return the VALUE, not an envelope. `createBrowserPage` unwraps only a
      // `{data}` wrapper and treats `{success:false}` as failure — anything
      // else is passed through as the probe's own result, so wrapping it in
      // `{success:true, value}` made every probe look like it had returned a
      // malformed answer ("probe threw", with no message). The interface is
      // typed `eval(code: string): Promise<any>`, so the contract is only
      // discoverable by reading createBrowserPage. Filed upstream.
      try {
        return await page.evaluate(code)
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
    async click(selector: string) {
      await page.click(selector)
      return { success: true }
    },
    async type(selector: string, text: string) {
      await page.fill(selector, text)
      return { success: true }
    },
    async press(key: string) {
      await page.keyboard.press(key)
      return { success: true }
    },
  }
}

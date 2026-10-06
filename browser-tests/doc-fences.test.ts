/**
 * Run the doc-system ```test fences, headlessly.
 *
 * `CLAUDE.md` calls these "the project's only layout-capable check", and they
 * were in **no gate**: `release-doctor` discovers `test`/`test:*` scripts, and a
 * fence ran only when a human opened the page
 * (`reviews/0.6.0-dx-review.md`, F-12).
 *
 * That matters more than one missing lane, because *documentation asserting the
 * opposite of the code held the tag three times in one release* — CLAUDE.md's
 * superseded-proposal rule, CHANGELOG's copy of the same sentence, and README's
 * sticky-drag claim. Each was fixed as an instance. The mechanism that would
 * make the next one FAIL instead of ship already existed, shipped and
 * documented as load-bearing, and nothing ran it. This file runs it.
 *
 * How the fences actually work, none of which is documented upstream — filed as
 * a tosijs-ui docs issue:
 *
 * - **Examples are inserted client-side.** `grep tosi-example docs/*.html`
 *   finds nothing; the elements exist only after hydration, so this has to be a
 *   real browser rather than a parse of the built output.
 * - **Tests are enabled by default on localhost and disabled everywhere else**
 *   (tosijs-ui#113: "off" and "none exist" used to render identically, which
 *   bit hardest down the tunnel, whose hostname is necessarily not localhost).
 *   This lane drives localhost, so they are on; `enableTests()` is the escape
 *   hatch if that ever changes.
 * - **The result is a CLASS on the `<tosi-example>`**: `-has-tests` plus
 *   `-test-running`, settling to `-test-passed` or `-test-failed`. A
 *   build or execution failure counts as a test failure in its own right, even
 *   for an example with no `test` block — which is exactly the behaviour this
 *   repo wants, since an illustrative fence that throws on the home page is a
 *   defect it has shipped twice.
 *
 * Lives in `browser-tests/` rather than behind its own script so it rides the
 * dev server `bin/test-browser.ts` already brings up, and so
 * `releaseDoctor.attestedLanes: ["test:browser"]` covers it with no second
 * declaration.
 */
import { test, expect, beforeAll, afterAll, describe } from 'bun:test'
import { webkit, chromium, type Browser, type Page } from 'playwright'

const ORIGIN = process.env.DOCS_ORIGIN ?? 'https://localhost:8789'
const ENGINE = process.env.ENGINE ?? 'webkit'

/** Every generated page. README is the home page, so `/` carries its fences. */
const PAGES = ['/', '/tosijs-styled-editor/', '/right-to-left/']

let browser: Browser
let page: Page
/** Collected once in `beforeAll`: loading a page is slow, asserting is not. */
const reports = new Map<string, FenceReport>()

beforeAll(async () => {
  browser = await (ENGINE === 'chromium' ? chromium : webkit).launch()
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  page = await ctx.newPage()
  // Every page visited HERE, with the whole-hook timeout to spend. Driving the
  // browser from inside a `test` instead tripped bun's default 5s per-test
  // timeout, which tears the page down mid-navigation and reports
  // "Target page, context or browser has been closed" — a harness failure that
  // reads nothing like one.
  for (const path of PAGES) reports.set(path, await runFences(path))
}, 180000)

afterAll(async () => {
  await browser?.close()
})

interface FenceReport {
  total: number
  passed: number
  failed: number
  running: number
  failures: string[]
}

const runFences = async (path: string): Promise<FenceReport> => {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' })
  // The doc system registers its elements from the bundle, so wait for an
  // upgraded example rather than for a timer. A page with no examples at all is
  // reported as total 0 and judged by the caller.
  await page
    .waitForFunction(
      () => document.querySelectorAll('tosi-example').length > 0,
      undefined,
      { timeout: 10000 }
    )
    .catch(() => undefined)

  // Settled means: every example that HAS tests has stopped running them.
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('tosi-example.-test-running').length === 0 &&
        document.querySelectorAll('tosi-example.-has-tests').length > 0,
      undefined,
      { timeout: 15000 }
    )
    .catch(() => undefined)

  return page.evaluate(() => {
    const examples = [...document.querySelectorAll('tosi-example')]
    const withTests = examples.filter((el) =>
      el.classList.contains('-has-tests')
    )
    const failed = withTests.filter((el) =>
      el.classList.contains('-test-failed')
    )
    return {
      total: examples.length,
      passed: withTests.filter((el) => el.classList.contains('-test-passed'))
        .length,
      failed: failed.length,
      running: withTests.filter((el) => el.classList.contains('-test-running'))
        .length,
      // The rendered result text, which carries the assertion message.
      failures: failed.map((el) =>
        (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
      ),
    }
  })
}

describe(`doc-system test fences (${ENGINE})`, () => {
  // THE PRECONDITION, and it is not ceremony: if the examples never upgrade,
  // every page reports zero failures and this lane is a green light that
  // checked nothing. That is the exact shape of the trap this file exists to
  // close, so it must not be reproduced here.
  test('the examples upgrade and at least one fence runs', () => {
    let anyWithTests = 0
    for (const path of PAGES) {
      const report = reports.get(path)!
      console.log(
        `  ${path}  examples ${report.total}  with tests ${
          report.passed + report.failed
        }  passed ${report.passed}  failed ${report.failed}`
      )
      anyWithTests += report.passed + report.failed
    }
    expect(anyWithTests).toBeGreaterThan(0)
  })

  for (const path of PAGES) {
    test(`no fence fails on ${path}`, () => {
      const report = reports.get(path)!
      for (const failure of report.failures) console.log(`    ✗ ${failure}`)
      // Still running when the wait expired is a hang, not a pass.
      expect(report.running).toBe(0)
      expect(report.failed).toBe(0)
    })
  }
})

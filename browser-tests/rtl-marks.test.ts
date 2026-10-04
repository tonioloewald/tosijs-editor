/**
 * What do change marks and spelling marks do to REAL text layout?
 *
 * Every other test in this repo runs in happy-dom, where every rect is zero, so
 * this is the only lane that can answer it. The question matters because
 * `CLAUDE.md` records a measured fact: **WebKit does not shape across text-node
 * boundaries.** Merely splitting a text node reshapes Arabic at roughly half the
 * positions tested, by up to 4px; Chromium measures 0 throughout.
 *
 * `<tosi-ins>`, `<tosi-del>` and `<tosi-misspelling>` are inline ELEMENTS in the
 * text flow, so they split a text node *and* add an inline box. That is strictly
 * more disturbance than the bounds markers, which were moved to
 * `display: contents` precisely because an empty inline box contributes a strut
 * to its line.
 *
 * Run: `bun test browser-tests/` with the dev server up. WebKit is the point —
 * a Chromium run of this file is expected to be all zeros and proves nothing.
 */
import { test, expect, beforeAll, afterAll, describe } from 'bun:test'
import { webkit, chromium, type Browser, type Page } from 'playwright'
import {
  createBrowserPage,
  markBrowserTestRan,
  browserTestsRan,
} from 'haltija/test'
import { playwrightBridge } from './bridge'

const URL = process.env.RTL_URL ?? 'https://localhost:8789/right-to-left/'
const ENGINE = process.env.ENGINE ?? 'webkit'

let browser: Browser
let raw: Page
let page: ReturnType<typeof createBrowserPage>

beforeAll(async () => {
  browser = await (ENGINE === 'chromium' ? chromium : webkit).launch()
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  raw = await ctx.newPage()
  await raw.goto(URL, { waitUntil: 'networkidle' })
  // The editor is a custom element; wait for it to actually upgrade rather than
  // for a timer — a probe against an un-upgraded element measures nothing and
  // says so only by returning suspiciously round numbers.
  await raw.waitForFunction(
    () => !!document.querySelector('tosijs-styled-editor')?.shadowRoot,
    undefined,
    { timeout: 15000 }
  )
  page = createBrowserPage(playwrightBridge(raw))
}, 60000)

afterAll(async () => {
  await browser?.close()
})

/**
 * Per-character x positions of a paragraph, measured with a Range — the same
 * primitive `characterAtPoint` uses, so this measures what the editor measures.
 */
const PROBE = `(() => {
  const ed = document.querySelector('tosijs-styled-editor')
  const doc = ed.shadowRoot.querySelector('[part="doc"]')
  const p = [...doc.querySelectorAll('p')].find(el => /[\\u0600-\\u06FF]/.test(el.textContent)) || doc.querySelector('p')
  if (!p) return { error: 'no paragraph' }
  const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  const xs = []; let chars = ''
  let n
  while ((n = walk.nextNode())) {
    for (let i = 0; i < n.data.length; i++) {
      const r = document.createRange()
      r.setStart(n, i); r.setEnd(n, i + 1)
      const b = r.getBoundingClientRect()
      // RENDERED GLYPHS ONLY. Collapsed source whitespace (the newline and
      // indentation between tags) measures 0x0 at 0,0, and any DOM change
      // shuffles which of those collapse — so including them reported a
      // 1058px "shift" that was five spaces going from a stale rect to the
      // origin, in BOTH engines. The first version of this test did exactly
      // that and produced a headline number with no meaning.
      if (b.width <= 0) continue
      xs.push({ c: n.data[i], x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2) })
      chars += n.data[i]
    }
  }
  const box = p.getBoundingClientRect()
  return { chars, xs, box: { y: +box.y.toFixed(2), h: +box.height.toFixed(2) }, text: p.textContent }
})()`

const measure = (): Promise<any> =>
  page.read(new Function(`return ${PROBE}`) as any)

/** Wrap one word of the paragraph in `tag`, the way the editor would. */
const wrapWord = (tag: string, word: string): Promise<any> =>
  page.read(
    new Function(
      'tag',
      'word',
      `
  const ed = document.querySelector('tosijs-styled-editor')
  const doc = ed.shadowRoot.querySelector('[part="doc"]')
  const p = [...doc.querySelectorAll('p')].find(el => /[\\u0600-\\u06FF]/.test(el.textContent)) || doc.querySelector('p')
  const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walk.nextNode())) {
    const i = n.data.indexOf(word)
    if (i < 0) continue
    const r = document.createRange()
    r.setStart(n, i); r.setEnd(n, i + word.length)
    const el = document.createElement(tag)
    el.setAttribute('data-change', 'probe')
    r.surroundContents(el)
    return { wrapped: true, tag }
  }
  return { wrapped: false }
`
    ) as any,
    [tag, word]
  )

describe(`text layout under marks (${ENGINE})`, () => {
  test('the page is real and the editor upgraded', async () => {
    const m = await measure()
    markBrowserTestRan()
    expect(m.error).toBeUndefined()
    // A zero-width measurement means happy-dom semantics leaked in, or the
    // element never upgraded. Assert the fixture is REAL before asserting
    // anything about it.
    expect(m.xs.length).toBeGreaterThan(10)
    expect(m.xs.some((c: any) => c.w > 0)).toBe(true)
    expect(m.box.h).toBeGreaterThan(0)
  })

  for (const tag of ['tosi-del', 'tosi-ins', 'tosi-misspelling']) {
    test(`<${tag}> and the text around it`, async () => {
      await raw.reload({ waitUntil: 'networkidle' })
      await raw.waitForFunction(
        () => !!document.querySelector('tosijs-styled-editor')?.shadowRoot
      )
      const before = await measure()
      const word = before.chars
        .trim()
        .split(/\s+/)
        .find((w: string) => w.length > 2)
      const w = await wrapWord(tag, word)
      expect(w.wrapped).toBe(true)
      const after = await measure()
      markBrowserTestRan()

      // Same characters, so the comparison is meaningful.
      expect(after.chars).toBe(before.chars)

      let maxDx = 0
      let moved = 0
      for (let i = 0; i < before.xs.length; i++) {
        const dx = Math.abs(after.xs[i].x - before.xs[i].x)
        if (dx > 0.01) moved++
        maxDx = Math.max(maxDx, dx)
      }
      const dh = Math.abs(after.box.h - before.box.h)
      const dy = Math.abs(after.box.y - before.box.y)

      let maxDy = 0
      for (let i = 0; i < before.xs.length; i++) {
        maxDy = Math.max(maxDy, Math.abs(after.xs[i].y - before.xs[i].y))
      }
      console.log(
        `  ${ENGINE} <${tag}>  glyphs ${
          before.xs.length
        }  maxΔx ${maxDx.toFixed(2)}px  maxΔy ${maxDy.toFixed(
          2
        )}px  moved ${moved}  Δheight ${dh.toFixed(2)}px  Δtop ${dy.toFixed(
          2
        )}px`
      )

      // Recorded, not asserted to zero: this test exists to PRODUCE the number
      // nobody has had. A threshold invented before the first measurement would
      // just encode a guess. The block must not grow, though — that shifts every
      // following block, which is the regression `display: contents` fixed for
      // the bounds markers.
      expect(dh).toBeLessThan(1)
    })
  }

  // THE case that should hurt. Wrapping a whole word puts the element at a
  // boundary where the cursive run already breaks, so it costs nothing. A
  // single-character <tosi-del> — what one Backspace produces — lands INSIDE a
  // word, which is where CLAUDE.md measured merely splitting a text node
  // reshaping Arabic by up to 4px in WebKit.
  for (const n of [1, 2]) {
    test(`a ${n}-character mark INSIDE an Arabic word`, async () => {
      await raw.reload({ waitUntil: 'networkidle' })
      await raw.waitForFunction(
        () => !!document.querySelector('tosijs-styled-editor')?.shadowRoot
      )
      const before = await measure()
      const hit = await page.read(
        new Function(
          'n',
          `
  const ed = document.querySelector('tosijs-styled-editor')
  const doc = ed.shadowRoot.querySelector('[part="doc"]')
  const p = [...doc.querySelectorAll('p')].find(el => /[\\u0600-\\u06FF]/.test(el.textContent))
  const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  let t
  while ((t = walk.nextNode())) {
    // a run of >=5 Arabic letters, so there is a true interior position
    const m = /[\\u0621-\\u064A]{5,}/.exec(t.data)
    if (!m) continue
    const at = m.index + 2 // strictly inside the cursive run
    const r = document.createRange()
    r.setStart(t, at); r.setEnd(t, at + n)
    const el = document.createElement('tosi-del')
    r.surroundContents(el)
    return { word: m[0], at, marked: el.textContent }
  }
  return null
`
        ) as any,
        [n]
      )
      expect(hit).not.toBeNull()
      const after = await measure()
      markBrowserTestRan()
      expect(after.chars).toBe(before.chars)

      let maxDx = 0
      let moved = 0
      for (let i = 0; i < before.xs.length; i++) {
        const dx = Math.abs(after.xs[i].x - before.xs[i].x)
        if (dx > 0.01) moved++
        maxDx = Math.max(maxDx, dx)
      }
      console.log(
        `  ${ENGINE} ${n}-char mid-word in ${JSON.stringify(
          hit.word
        )}  maxΔx ${maxDx.toFixed(2)}px  moved ${moved}/${
          before.xs.length
        }  Δheight ${Math.abs(after.box.h - before.box.h).toFixed(2)}px`
      )
      // Produce the number; do not invent a threshold for it.
      expect(after.xs.length).toBe(before.xs.length)
    })
  }

  test('the browser tier actually ran', () => {
    // "Zero tests ran" and "all tests passed" are different states.
    expect(browserTestsRan()).toBeGreaterThan(0)
  })
})

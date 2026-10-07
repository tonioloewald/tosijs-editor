/**
 * Where the touch affordances actually LAND, in a real engine (#3104).
 *
 * `lozengePlacement` is a pure function with property tests in
 * `src/tosijs-styled-editor.test.ts`, and those prove the arithmetic. They
 * cannot prove the thing that broke in 0.6.0: that the rects FED to it are the
 * selection's. The bug the owner reported from an iPhone — the menu sitting on
 * top of the start handle — was not an arithmetic error. Every rect in
 * happy-dom is zero, so no unit test in this repo can see a placement at all.
 *
 * So this lane asserts the two geometric claims #3104 makes, against measured
 * layout:
 *
 * - the lozenge's box never intersects any of the selection's LINE BOXES
 *   (`getClientRects()`, one rect per line — the union rect would call the gap
 *   between two lines of a wrapped selection "inside the selection", which is
 *   the same mistake `pointerInAnchorWord` exists to avoid)
 * - it flips above/below rather than leaving the document box, at either edge
 *
 * What it deliberately does NOT assert: anything a finger has to do. Handle
 * dragging is verified by hand on a real device over the preview tunnel.
 * Chrome's responsive mode has already produced misleading evidence about touch
 * in this repo (2026-10-05), so it does not count here either.
 *
 * Run: `bun run test:browser`, which brings up its own dev server.
 */
import { test, expect, beforeAll, afterAll, describe } from 'bun:test'
import { webkit, chromium, type Browser, type Page } from 'playwright'

const URL =
  process.env.AFFORDANCE_URL ?? 'https://localhost:8789/tosijs-styled-editor/'
const ENGINE = process.env.ENGINE ?? 'webkit'

let browser: Browser
let page: Page

/**
 * Select from one character to another by DRIVING THE EDITOR'S OWN PATHS —
 * `placeCaretAt` then `extendTo`, the same two calls a finger produces — rather
 * than placing bounds markers by hand. Hand-placed markers have misled this
 * repo three times (`CLAUDE.md`), and here they would skip the very
 * measurement under test.
 *
 * Returns the lozenge's box, the selection's per-line boxes, and the document's
 * box, all in client coordinates, so the assertions compare like with like.
 */
const place = async (
  startChar: number,
  endChar: number,
  paragraph: number
): Promise<{
  error?: string
  lozenge: { top: number; bottom: number; left: number; right: number }
  lines: Array<{ top: number; bottom: number }>
  doc: { top: number; bottom: number; left: number; right: number }
  side: 'above' | 'below'
  dot: { start: number; end: number }
}> =>
  page.evaluate(
    ({ startChar, endChar, paragraph }) => {
      const ed = document.querySelector('tosijs-styled-editor') as any
      const doc = ed.shadowRoot.querySelector('[part="doc"]')
      const p = doc.querySelectorAll('p')[paragraph]
      if (!p) return { error: `no paragraph ${paragraph}` } as any

      /** The centre of the nth rendered character, measured with a Range. */
      const centreOf = (index: number) => {
        const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
        let seen = 0
        let n: Node | null
        while ((n = walk.nextNode())) {
          const data = (n as Text).data
          if (seen + data.length > index) {
            const r = document.createRange()
            r.setStart(n, index - seen)
            r.setEnd(n, index - seen + 1)
            const b = r.getBoundingClientRect()
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
          }
          seen += data.length
        }
        return null
      }

      const from = centreOf(startChar)
      const to = centreOf(endChar)
      if (!from || !to) return { error: 'character out of range' } as any

      // A handle only exists as a result of touch, and the affordances are
      // hidden otherwise — so the gesture has to say it was a touch.
      ed.selectable.touchMode = true
      ed.selectable.placeCaretAt(from.x, from.y)
      ed.selectable.extendTo(to.x, to.y)
      doc.dispatchEvent(new Event('selectionchanged'))

      const lozengeEl = ed.shadowRoot.querySelector('.touch-lozenge')
      const selStart = doc.querySelector('.sel-start')
      const selEnd = doc.querySelector('.sel-end')
      if (!lozengeEl || !selStart || !selEnd) {
        return {
          error: `missing: ${[
            !lozengeEl && 'lozenge',
            !selStart && 'sel-start',
            !selEnd && 'sel-end',
          ]
            .filter(Boolean)
            .join(', ')}`,
        } as any
      }

      // One rect PER LINE BOX between the two markers. `setStartAfter` /
      // `setEndBefore` so the markers themselves are outside the range: they
      // are `display: contents` and generate no box, so including them adds
      // nothing but makes the intent unclear.
      const range = document.createRange()
      range.setStartAfter(selStart)
      range.setEndBefore(selEnd)
      const lines = [...range.getClientRects()]
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) }))

      const box = (el: Element) => {
        const r = el.getBoundingClientRect()
        return {
          top: +r.top.toFixed(2),
          bottom: +r.bottom.toFixed(2),
          left: +r.left.toFixed(2),
          right: +r.right.toFixed(2),
        }
      }
      const lozenge = box(lozengeEl)
      const dotStart = box(doc.querySelector('.touch-handle-start .touch-icon'))
      const dotEnd = box(doc.querySelector('.touch-handle-end .touch-icon'))

      return {
        lozenge,
        lines,
        doc: box(doc),
        side: lozenge.bottom <= lines[0].top ? 'above' : 'below',
        // The PAINTED diameter, which is the half of AFFORDANCE_SIZE's split
        // that a real engine can confirm: the hit box is 44 and invisible, the
        // dot is 14 and is what covers text.
        dot: {
          start: +(dotStart.right - dotStart.left).toFixed(2),
          end: +(dotEnd.right - dotEnd.left).toFixed(2),
        },
      } as any
    },
    { startChar, endChar, paragraph }
  )

beforeAll(async () => {
  browser = await (ENGINE === 'chromium' ? chromium : webkit).launch()
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    // Phone-ish, so the flip cases are reachable without a 4000px document.
    viewport: { width: 390, height: 700 },
  })
  page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  // Wait for the element to UPGRADE, not for a timer: a probe against an
  // un-upgraded element measures nothing and says so only by returning
  // suspiciously round numbers.
  await page.waitForFunction(
    () => !!document.querySelector('tosijs-styled-editor')?.shadowRoot,
    undefined,
    { timeout: 15000 }
  )
  // A document long enough that a selection can be near the top of the
  // document box, near the bottom, and in the middle.
  await page.evaluate(() => {
    const ed = document.querySelector('tosijs-styled-editor') as any
    ed.value = Array.from(
      { length: 24 },
      (_, i) =>
        `<p>Paragraph ${i} with enough words in it to wrap across more than one line on a narrow viewport.</p>`
    ).join('')
  })
}, 120000)

afterAll(async () => {
  await browser?.close()
})

describe(`touch affordance geometry (${ENGINE})`, () => {
  // THE PRECONDITION. Everything below compares boxes, and a probe that
  // silently failed to select anything would hand back degenerate rects that
  // satisfy "does not intersect" trivially. This is the shape of trap that made
  // the first version of `rtl-marks.test.ts` report a meaningless 1058px.
  test('the probe actually selects, and the dot is the PAINTED size', async () => {
    const r = await place(4, 30, 4)
    expect(r.error).toBeUndefined()
    expect(r.lines.length).toBeGreaterThan(0)
    expect(r.lozenge.right - r.lozenge.left).toBeGreaterThan(0)
    // 14px, not 44: the hit target stayed 44 and the painted circle shrank
    // inside it, which is the whole point of splitting the constant. A ±1
    // tolerance for device-pixel rounding.
    expect(r.dot.start).toBeGreaterThan(10)
    expect(r.dot.start).toBeLessThan(18)
    expect(r.dot.end).toBeGreaterThan(10)
    expect(r.dot.end).toBeLessThan(18)
  })

  test('the lozenge never intersects the selection’s line boxes', async () => {
    // A single-line selection, a wrapped one, and a multi-paragraph one — the
    // wrapped case is why this measures per line box rather than the union.
    for (const [from, to, para] of [
      [4, 12, 6],
      [4, 80, 6],
      [10, 40, 12],
    ] as const) {
      const r = await place(from, to, para)
      expect(r.error).toBeUndefined()
      for (const line of r.lines) {
        const overlaps =
          r.lozenge.top < line.bottom && r.lozenge.bottom > line.top
        expect(overlaps).toBe(false)
      }
    }
  })

  test('it flips below when there is no room above, and stays on screen', async () => {
    const top = await place(2, 20, 0)
    expect(top.error).toBeUndefined()
    expect(top.side).toBe('below')
    expect(top.lozenge.top).toBeGreaterThanOrEqual(top.doc.top - 1)
    expect(top.lozenge.bottom).toBeLessThanOrEqual(top.doc.bottom + 1)
  })

  test('…and sits above a selection with room above it', async () => {
    const middle = await place(2, 20, 8)
    expect(middle.error).toBeUndefined()
    expect(middle.side).toBe('above')
  })

  test('it is centred on the PAGE, wherever the selection is', async () => {
    // The claim that retired `menuAffordanceX`: two selections at very
    // different x, one lozenge position. Centred on the document box, so the
    // two margins match.
    const first = await place(2, 8, 10)
    const second = await place(40, 70, 10)
    expect(first.lozenge.left).toBeCloseTo(second.lozenge.left, 0)
    const leftGap = first.lozenge.left - first.doc.left
    const rightGap = first.doc.right - first.lozenge.right
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(2)
  })
})

/**
 * Where the touch affordances actually LAND, in a real engine (#3104).
 *
 * `lozengePlacement` is a pure function with property tests in
 * `src/tosijs-styled-editor.test.ts`, and those prove the arithmetic. They
 * cannot prove the thing that broke in 0.6.0: that the rects FED to it are the
 * selection's. Every rect in happy-dom is zero, so no unit test here can see a
 * placement at all.
 *
 * THIS LANE WAS VACUOUS ONCE AND THE SHAPE IS WORTH KEEPING IN VIEW
 * (0.7.0 pre-release review, B‑1). Measured: with `positionLozenge` replaced
 * by a stub that ignored the selection and pinned the lozenge to a constant y,
 * every vertical assertion below still PASSED. Two independent causes, both
 * now closed, and a third guard added so neither can come back quietly:
 *
 *  1. THE PROBE NEVER SCROLLED. `[part="doc"]` is a short scrolling viewport,
 *     and every paragraph but the first sat hundreds of pixels below it. The
 *     placement therefore hit its terminal y clamp every time and was
 *     byte-identical for five different selections. "Does not intersect the
 *     line boxes" is trivially true of a lozenge that is nowhere near them.
 *     `place()` now scrolls the selection into the band and the precondition
 *     REFUSES a selection that is not inside it.
 *  2. THE PROBE READ A RECT MID-TRANSITION. `.touch-lozenge` transitions
 *     `left`/`top` over 0.1s, and the probe measured synchronously after
 *     dispatching `selectionchanged` — so each assertion compared one
 *     selection's lines against the PREVIOUS selection's box. The probe now
 *     switches the transition off, which makes the rect the written value
 *     rather than something a timer is still moving. Waiting a guessed number
 *     of milliseconds would have been the other, worse, answer.
 *  3. A lozenge that ignores the selection produces the SAME y for every
 *     selection, and nothing above says it may not. `the lozenge's y depends
 *     on the selection` says it, and is the assertion the stub fails first.
 *
 * The general rule this cost, now in `practices/testing.md`: a browser lane
 * must be able to FAIL. A precondition that the subject EXISTS is necessary
 * and not sufficient — the old one passed while its subject was a thousand
 * pixels off-screen. `bin/falsify.ts` now runs this lane for the entries that
 * name it, so the question is asked on every release rather than by a
 * reviewer who happens to look.
 *
 * What it deliberately does NOT assert: anything a finger has to do. Handle
 * dragging is verified by hand on a real device over the preview tunnel.
 * Chrome's responsive mode has already produced misleading evidence about
 * touch in this repo (2026-10-05), so it does not count here either.
 *
 * Run: `bun run test:browser`, which brings up its own dev server.
 */
import { test, expect, beforeAll, afterAll, describe } from 'bun:test'
import { webkit, chromium, type Browser, type Page } from 'playwright'

const URL =
  process.env.AFFORDANCE_URL ?? 'https://localhost:8789/tosijs-styled-editor/'
const ENGINE = process.env.ENGINE ?? 'webkit'

/** Where in the document's visible band to put the selection. */
type Band = 'top' | 'middle' | 'bottom'

type Placement = {
  error?: string
  lozenge: { top: number; bottom: number; left: number; right: number }
  lines: Array<{ top: number; bottom: number }>
  doc: { top: number; bottom: number; left: number; right: number }
  side: 'above' | 'below'
  dot: { start: number; end: number }
  /** Every line of the selection inside the document's visible band? */
  inBand: boolean
}

let browser: Browser
let page: Page

/**
 * Select from one character to another by DRIVING THE EDITOR'S OWN PATHS —
 * `placeCaretAt` then `extendTo`, the same two calls a finger produces —
 * rather than placing bounds markers by hand. Hand-placed markers have misled
 * this repo three times (`CLAUDE.md`), and here they would skip the very
 * measurement under test.
 *
 * Then SCROLL the selection to `band` and re-run the placement, because a
 * selection outside the viewport tells you nothing about placement: see the
 * header.
 */
const place = async (
  startChar: number,
  endChar: number,
  paragraph: number,
  band: Band = 'middle'
): Promise<Placement> =>
  page.evaluate(
    ({ startChar, endChar, paragraph, band }) => {
      const ed = document.querySelector('tosijs-styled-editor') as any
      const doc = ed.shadowRoot.querySelector('[part="doc"]') as HTMLElement
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

      const selectBetween = (): string | null => {
        const from = centreOf(startChar)
        const to = centreOf(endChar)
        if (!from || !to) return 'character out of range'
        // A handle only exists as a result of touch, and the affordances are
        // hidden otherwise — so the gesture has to say it was a touch.
        ed.selectable.touchMode = true
        ed.selectable.placeCaretAt(from.x, from.y)
        ed.selectable.extendTo(to.x, to.y)
        doc.dispatchEvent(new Event('selectionchanged'))
        return null
      }

      let bad = selectBetween()
      if (bad) return { error: bad } as any

      // Put the selection where the test wants it in the visible band, then
      // re-select: scrolling moves the text under the markers, and the
      // placement has to be computed from where the text is NOW.
      const selLine = (): DOMRect | null => {
        const s = doc.querySelector('.sel-start')
        const e = doc.querySelector('.sel-end')
        if (!s || !e) return null
        const r = document.createRange()
        r.setStartAfter(s)
        r.setEndBefore(e)
        const rects = [...r.getClientRects()].filter(
          (x) => x.width > 0 && x.height > 0
        )
        return rects[0] ?? null
      }
      const first = selLine()
      if (!first) return { error: 'selection has no line boxes' } as any
      const docBox = doc.getBoundingClientRect()
      const margin = 60
      const wanted =
        band === 'top'
          ? docBox.top + margin
          : band === 'bottom'
            ? docBox.bottom - margin
            : docBox.top + docBox.height / 2
      doc.scrollTop += first.top - wanted
      // Re-run the gesture at the new coordinates rather than trusting the
      // markers to have survived a scroll: `characterAtPoint` is what the
      // editor uses and it reads the CURRENT layout.
      bad = selectBetween()
      if (bad) return { error: bad } as any

      const lozengeEl = ed.shadowRoot.querySelector(
        '.touch-lozenge'
      ) as HTMLElement
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

      // The box the code WROTE, not one a 0.1s transition is still moving
      // towards. Switching the transition off is the deterministic form of
      // "wait for it to settle" — and it is the editor's own animation, not
      // behaviour under test.
      lozengeEl.style.transition = 'none'
      // Force the style change to take effect before measuring.
      void lozengeEl.offsetWidth

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
      const docOut = box(doc)

      return {
        lozenge,
        lines,
        doc: docOut,
        side: lozenge.bottom <= lines[0].top ? 'above' : 'below',
        // The PAINTED diameter, which is the half of the old AFFORDANCE_SIZE
        // split that a real engine can confirm: the hit box is 44 and
        // invisible, the dot is 14 and is what covers text.
        dot: {
          start: +(dotStart.right - dotStart.left).toFixed(2),
          end: +(dotEnd.right - dotEnd.left).toFixed(2),
        },
        inBand: lines.every(
          (l) => l.top >= docOut.top - 1 && l.bottom <= docOut.bottom + 1
        ),
      } as any
    },
    { startChar, endChar, paragraph, band }
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
  await page.evaluate(() => {
    const ed = document.querySelector('tosijs-styled-editor') as any
    // The example's own box is ~170px tall, which is too short for "is there
    // room above or below" to mean anything. Give it a phone-sized band.
    ed.style.height = '460px'
    // A document long enough that a selection can be near the top of the
    // band, near the bottom, and in the middle — with scrolling in all three.
    ed.value = Array.from(
      { length: 24 },
      (_, i) =>
        `<p>Paragraph ${i} with enough words in it to wrap across more than one line on a narrow viewport.</p>`
    ).join('')
  })
  // The height change is a layout change; let the ResizeObserver settle it
  // before anything measures.
  await page.waitForFunction(
    () => {
      const ed = document.querySelector('tosijs-styled-editor') as any
      const doc = ed.shadowRoot.querySelector('[part="doc"]')
      return doc.getBoundingClientRect().height > 300
    },
    undefined,
    { timeout: 5000 }
  )
}, 120000)

afterAll(async () => {
  await browser?.close()
})

describe(`touch affordance geometry (${ENGINE})`, () => {
  // THE PRECONDITION, and it is now a DISCRIMINATING one. Everything below
  // compares boxes, and the version of this test that only asked "did we get
  // some line boxes and a dot" passed while the selection it described was a
  // thousand pixels outside the viewport. `inBand` is the assertion that was
  // missing.
  test('the probe selects INSIDE the visible band, and the dot is the PAINTED size', async () => {
    const r = await place(4, 30, 8)
    expect(r.error).toBeUndefined()
    expect(r.lines.length).toBeGreaterThan(0)
    expect(r.inBand).toBe(true)
    expect(r.lozenge.right - r.lozenge.left).toBeGreaterThan(0)
    expect(r.lozenge.bottom - r.lozenge.top).toBeGreaterThan(0)
    // 14px, not 44: the hit target stayed 44 and the painted circle shrank
    // inside it, which is the whole point of splitting the constant. A ±4
    // tolerance for device-pixel rounding.
    expect(r.dot.start).toBeGreaterThan(10)
    expect(r.dot.start).toBeLessThan(18)
    expect(r.dot.end).toBeGreaterThan(10)
    expect(r.dot.end).toBeLessThan(18)
  })

  /**
   * THE ANTI-VACUITY ASSERTION. A placement that ignores the selection puts
   * the lozenge in the same place every time, and every other test here is
   * satisfied by that. This one is not: three selections at three heights in
   * the band must produce three different y values.
   */
  test('the lozenge’s y depends on the selection', async () => {
    const top = await place(4, 30, 6, 'top')
    const middle = await place(4, 30, 10, 'middle')
    const bottom = await place(4, 30, 14, 'bottom')
    for (const r of [top, middle, bottom]) {
      expect(r.error).toBeUndefined()
      expect(r.inBand).toBe(true)
    }
    const ys = [top.lozenge.top, middle.lozenge.top, bottom.lozenge.top]
    expect(new Set(ys).size).toBe(3)
    // And it tracks the selection rather than merely differing: a selection
    // lower in the band gets a lower lozenge.
    expect(top.lozenge.top).toBeLessThan(bottom.lozenge.top)
  })

  test('the lozenge never intersects the selection’s line boxes', async () => {
    // A single-line selection, a wrapped one, and one at each end of the
    // band — the wrapped case is why this measures per line box rather than
    // the union.
    for (const [from, to, para, band] of [
      [4, 12, 6, 'middle'],
      [4, 80, 6, 'middle'],
      [10, 40, 12, 'top'],
      [10, 40, 12, 'bottom'],
    ] as const) {
      const r = await place(from, to, para, band)
      expect(r.error).toBeUndefined()
      expect(r.inBand).toBe(true)
      for (const line of r.lines) {
        const overlaps =
          r.lozenge.top < line.bottom && r.lozenge.bottom > line.top
        expect(overlaps).toBe(false)
      }
    }
  })

  test('it goes below when the selection is at the top of the band, above when it is at the bottom', async () => {
    const atTop = await place(2, 20, 6, 'top')
    expect(atTop.error).toBeUndefined()
    expect(atTop.inBand).toBe(true)
    expect(atTop.side).toBe('below')
    expect(atTop.lozenge.top).toBeGreaterThanOrEqual(atTop.doc.top - 1)
    expect(atTop.lozenge.bottom).toBeLessThanOrEqual(atTop.doc.bottom + 1)

    const atBottom = await place(2, 20, 14, 'bottom')
    expect(atBottom.error).toBeUndefined()
    expect(atBottom.inBand).toBe(true)
    expect(atBottom.side).toBe('above')
    expect(atBottom.lozenge.top).toBeGreaterThanOrEqual(atBottom.doc.top - 1)
    expect(atBottom.lozenge.bottom).toBeLessThanOrEqual(atBottom.doc.bottom + 1)
  })

  test('it is centred on the PAGE, wherever the selection is', async () => {
    // The claim that retired `menuAffordanceX`: two selections at very
    // different x, one lozenge position. Centred on the document box, so the
    // two margins match.
    const first = await place(2, 8, 10)
    const second = await place(40, 70, 10)
    expect(first.error).toBeUndefined()
    expect(second.error).toBeUndefined()
    expect(first.lozenge.left).toBeCloseTo(second.lozenge.left, 0)
    const leftGap = first.lozenge.left - first.doc.left
    const rightGap = first.doc.right - first.lozenge.right
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(2)
  })
})

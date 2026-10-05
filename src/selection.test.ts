import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { spanify, Selectable, stickySelectionBounds } from './selection'
import { isBefore } from './dom-utils'

describe('spanify', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  test('wraps each character in a span', () => {
    container.innerHTML = '<p>ABC</p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    const spans = p.querySelectorAll('.spanified')
    expect(spans.length).toBe(3)
    expect(spans[0].textContent).toBe('A')
    expect(spans[1].textContent).toBe('B')
    expect(spans[2].textContent).toBe('C')
  })

  test('wraps words when byWord is true', () => {
    container.innerHTML = '<p>hello world</p>'
    const p = container.querySelector('p')!
    spanify(p, true, true)
    const wordSpans = p.querySelectorAll('.spanified-word')
    // "hello", " ", "world" — "hello" and "world" are multi-char words
    expect(wordSpans.length).toBe(2) // hello, world (space is single char)
  })

  test('keeps an emoji whole instead of tearing its surrogate pair', () => {
    container.innerHTML = '<p>a\u{1F310}b</p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    const spans = [...p.querySelectorAll('.spanified')].map(
      (s) => s.textContent
    )
    // split('') would give 4 spans, the middle two being lone surrogates
    expect(spans).toEqual(['a', '\u{1F310}', 'b'])
    expect(p.textContent).toBe('a\u{1F310}b')
  })

  test('keeps a flag whole — two regional indicators are one grapheme', () => {
    container.innerHTML = '<p>\u{1F1EC}\u{1F1E7}!</p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    const spans = [...p.querySelectorAll('.spanified')].map(
      (s) => s.textContent
    )
    expect(spans).toEqual(['\u{1F1EC}\u{1F1E7}', '!'])
  })

  test('round-trips emoji through spanify and back', () => {
    const original = '<p>hi \u{1F310} \u{1F1EB}\u{1F1EE}</p>'
    container.innerHTML = original
    const p = container.querySelector('p')!
    spanify(p, true)
    spanify(p, false)
    expect(p.textContent).toBe('hi \u{1F310} \u{1F1EB}\u{1F1EE}')
    expect(p.textContent).not.toContain('\uFFFD')
  })

  test('whitespace stays a text node, never its own span', () => {
    container.innerHTML = '<p>hello world again</p>'
    const p = container.querySelector('p')!
    spanify(p, true, true)
    // isolating a space in an inline box changes WHICH spaces CSS collapses,
    // so words merge and gaps open mid-word
    const spaceSpans = [...p.querySelectorAll('.spanified')].filter((s) =>
      /^\s+$/.test(s.textContent || '')
    )
    expect(spaceSpans.length).toBe(0)
    // the spaces are still there, just not wrapped
    expect(p.textContent).toBe('hello world again')
  })

  test('unwraps spanified content', () => {
    container.innerHTML = '<p>ABC</p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    expect(p.querySelectorAll('.spanified').length).toBe(3)
    spanify(p, false)
    expect(p.querySelectorAll('.spanified').length).toBe(0)
    expect(p.textContent).toBe('ABC')
  })

  test('does not spanify inside .do-not-spanify', () => {
    container.innerHTML = '<p><span class="do-not-spanify">skip</span>ABC</p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    // Only "ABC" should be spanified (3 chars), not "skip"
    const spans = p.querySelectorAll('.spanified')
    expect(spans.length).toBe(3)
    expect(p.querySelector('.do-not-spanify')!.textContent).toBe('skip')
  })

  test('handles single character text node (no-op)', () => {
    container.innerHTML = '<p>X</p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    // Single character — doesn't need wrapping
    expect(p.textContent).toBe('X')
  })

  test('handles empty text nodes gracefully', () => {
    container.innerHTML = '<p></p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    expect(p.innerHTML).toBe('')
  })

  test('handles nested elements', () => {
    container.innerHTML = '<p><b>AB</b><i>CD</i></p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    const spans = p.querySelectorAll('.spanified')
    expect(spans.length).toBe(4)
  })
})

describe('Selectable', () => {
  let root: HTMLElement
  let sel: Selectable

  beforeEach(() => {
    root = document.createElement('div')
    root.innerHTML = '<p>Hello world</p><p>Second paragraph</p>'
    document.body.appendChild(root)
    sel = new Selectable(root)
  })

  afterEach(() => {
    sel.destroy()
    root.remove()
  })

  test('creates with root element', () => {
    expect(sel.root).toBe(root)
  })

  test('disables user-select on root', () => {
    expect(root.style.userSelect).toBe('none')
  })

  describe('bounds management', () => {
    test('createBounds returns fragment with start and end', () => {
      const fragment = sel.createBounds()
      const children = Array.from(fragment.childNodes)
      expect(children.length).toBe(2)
      expect((children[0] as Element).classList.contains('sel-start')).toBe(
        true
      )
      expect((children[1] as Element).classList.contains('sel-end')).toBe(true)
      expect((children[1] as Element).classList.contains('caret')).toBe(true)
    })

    test('removeBounds removes markers from DOM', () => {
      const p = root.querySelector('p')!
      p.appendChild(sel.createBounds())
      expect(sel.find('.sel-start')).not.toBeNull()
      expect(sel.find('.sel-end')).not.toBeNull()
      sel.removeBounds()
      expect(sel.find('.sel-start')).toBeNull()
      expect(sel.find('.sel-end')).toBeNull()
    })
  })

  describe('markRange', () => {
    test('marks leaf nodes between bounds as selected', () => {
      root.innerHTML =
        '<p><span class="a">A</span><span class="b">B</span><span class="c">C</span></p>'
      const spanA = root.querySelector('.a')!
      const spanC = root.querySelector('.c')!
      sel.markRange(spanA, spanC)
      // All three spans should get selected class (text nodes are only children)
      expect(root.querySelector('.a')!.classList.contains('selected')).toBe(
        true
      )
      expect(root.querySelector('.b')!.classList.contains('selected')).toBe(
        true
      )
      expect(root.querySelector('.c')!.classList.contains('selected')).toBe(
        true
      )
    })

    test('marks block as selected-block', () => {
      root.innerHTML = '<p>Hello</p><p>World</p>'
      const paragraphs = root.querySelectorAll('p')
      sel.markRange(paragraphs[0], paragraphs[1])
      expect(paragraphs[0].classList.contains('selected-block')).toBe(true)
      expect(paragraphs[1].classList.contains('selected-block')).toBe(true)
    })

    test('marks first-block and last-block', () => {
      root.innerHTML = '<p>First</p><p>Middle</p><p>Last</p>'
      const paragraphs = root.querySelectorAll('p')
      sel.markRange(paragraphs[0], paragraphs[2])
      expect(paragraphs[0].classList.contains('first-block')).toBe(true)
      expect(paragraphs[2].classList.contains('last-block')).toBe(true)
    })

    test('handles reversed order (last before first)', () => {
      root.innerHTML = '<p>First</p><p>Last</p>'
      const paragraphs = root.querySelectorAll('p')
      // Pass in reverse order
      sel.markRange(paragraphs[1], paragraphs[0])
      expect(paragraphs[0].classList.contains('first-block')).toBe(true)
      expect(paragraphs[1].classList.contains('last-block')).toBe(true)
    })
  })

  describe('unmark', () => {
    test('clears all selection classes', () => {
      root.innerHTML =
        '<p class="selected-block first-block"><span class="selected">A</span></p>'
      sel.unmark()
      expect(root.querySelector('.selected')).toBeNull()
      expect(root.querySelector('.selected-block')).toBeNull()
      expect(root.querySelector('.first-block')).toBeNull()
    })
  })

  describe('normalize', () => {
    test('removes whitespace-only root text nodes', () => {
      root.appendChild(document.createTextNode('   '))
      root.appendChild(document.createTextNode('\n'))
      const childCount = root.childNodes.length
      sel.normalize()
      expect(root.childNodes.length).toBeLessThan(childCount)
    })
  })

  describe('find and findAll', () => {
    test('find returns first matching element', () => {
      root.innerHTML = '<p class="test">A</p><p class="test">B</p>'
      const found = sel.find('.test')
      expect(found).not.toBeNull()
      expect(found!.textContent).toBe('A')
    })

    test('findAll returns all matching elements', () => {
      root.innerHTML = '<p class="test">A</p><p class="test">B</p>'
      const found = sel.findAll('.test')
      expect(found.length).toBe(2)
    })

    test('find returns null when no match', () => {
      expect(sel.find('.nonexistent')).toBeNull()
    })
  })

  describe('touchMode', () => {
    test('defaults to false', () => {
      expect(sel.touchMode).toBe(false)
    })
  })

  describe('selectionChanged', () => {
    test('dispatches selectionchanged event', () => {
      let fired = false
      root.addEventListener('selectionchanged', () => {
        fired = true
      })
      sel.selectionChanged()
      expect(fired).toBe(true)
    })
  })

  describe('resetBounds', () => {
    test('places bounds around selected content', () => {
      root.innerHTML = '<p><span class="selected">Hello</span></p>'
      sel.resetBounds()
      expect(sel.find('.sel-start')).not.toBeNull()
      expect(sel.find('.sel-end')).not.toBeNull()
    })

    test('no-op when nothing is selected', () => {
      root.innerHTML = '<p>Hello</p>'
      sel.resetBounds()
      expect(sel.find('.sel-start')).toBeNull()
    })
  })
})

describe('click position resolution', () => {
  let root: HTMLElement
  let sel: Selectable
  let rangeProto: any
  let realRangeRect: () => DOMRect

  // happy-dom has no layout, so give Ranges a synthetic one: each character is
  // 10px wide on a single line. characterAtPoint measures through Ranges now,
  // so this is the surface that has to be stubbed.
  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    sel = new Selectable(root)
    rangeProto = Object.getPrototypeOf(document.createRange())
    realRangeRect = rangeProto.getBoundingClientRect
    rangeProto.getBoundingClientRect = function (this: Range) {
      const i = this.startOffset
      return {
        left: i * 10,
        right: i * 10 + 10,
        top: 0,
        bottom: 10,
        width: 10,
        height: 10,
        x: i * 10,
        y: 0,
      } as DOMRect
    }
  })

  afterEach(() => {
    rangeProto.getBoundingClientRect = realRangeRect
    sel.destroy()
    root.remove()
  })

  test('a click resolves to a character without rewriting the document', () => {
    root.innerHTML = '<p>hello world</p>'
    const before = root.innerHTML
    sel.placeCaretAt(25, 5)
    // the caret is inserted, but nothing is spanified to find where it goes
    expect(root.querySelectorAll('.spanified').length).toBe(0)
    expect(root.querySelector('.sel-end')).not.toBeNull()
    expect(root.textContent).toBe('hello world')
    expect(before).toContain('hello world')
  })

  test('clicking right of the text puts the caret after the last character', () => {
    root.innerHTML = '<p>hello</p>'
    sel.placeCaretAt(500, 5)
    const caret = root.querySelector('.sel-end')!
    const range = document.createRange()
    range.setStartAfter(caret)
    range.setEnd(
      root.querySelector('p')!,
      root.querySelector('p')!.childNodes.length
    )
    expect(range.toString().replace(/\s+/g, '')).toBe('')
  })

  test('clicking left of the text puts the caret before the first character', () => {
    root.innerHTML = '<p>hello</p>'
    sel.placeCaretAt(-50, 5)
    const caret = root.querySelector('.sel-start')!
    const p = root.querySelector('p')!
    const range = document.createRange()
    range.setStart(p, 0)
    range.setEndBefore(caret)
    expect(range.toString().replace(/\s+/g, '')).toBe('')
  })
})

describe('sticky word selection', () => {
  // The whole design in one sentence: snapping engages only once the drag
  // LEAVES the word it began in. Everything below is a consequence of that,
  // and the first group is what keeps it from being infuriating.
  const T = 'the quick brown fox'
  const sel = (anchor: number, head: number): string => {
    const { start, end } = stickySelectionBounds(T, anchor, head)
    return T.slice(start, end)
  }

  describe('inside the anchor word, character precision survives', () => {
    test('a partial word can still be selected', () => {
      // "qui" out of "quick" — anchor and head both inside it
      expect(sel(4, 7)).toBe('qui')
    })

    test('backwards inside the word is still partial', () => {
      expect(sel(7, 4)).toBe('qui')
    })

    test('pulling a suffix out of a longer word works', () => {
      const t = 'prefix'
      const { start, end } = stickySelectionBounds(t, 3, 6)
      expect(t.slice(start, end)).toBe('fix')
    })
  })

  describe('crossing a boundary snaps BOTH ends', () => {
    test('a drag from mid-word into the next word takes whole words', () => {
      // started inside "quick", ended inside "brown"
      expect(sel(6, 12)).toBe('quick brown')
    })

    test('the anchor end snaps too, not just the head', () => {
      // a selection spanning words but starting mid-word is almost never meant
      expect(sel(6, 12).startsWith('quick')).toBe(true)
    })

    test('dragging backwards snaps symmetrically', () => {
      expect(sel(12, 6)).toBe('quick brown')
    })

    test('coming back inside the anchor word returns to precision', () => {
      // out to "brown" and back in: not sticky any more
      expect(sel(4, 12)).toBe('quick brown')
      expect(sel(4, 7)).toBe('qui')
    })
  })

  describe('punctuation is taken only when reached', () => {
    const P = 'hello, world'
    const pick = (a: number, h: number): string => {
      const { start, end } = stickySelectionBounds(P, a, h)
      return P.slice(start, end)
    }

    test('stopping inside the word does not take the comma', () => {
      expect(pick(0, 4)).toBe('hell')
    })

    test('reaching the end of the word keeps character precision', () => {
      // offset 5 is both the end of "hello" and the start of ","; treating it
      // as still inside the word is the conservative read — you have not left.
      expect(pick(1, 5)).toBe('ello')
    })

    test('dragging PAST the comma takes it, without the space after', () => {
      expect(pick(1, 6)).toBe('hello,')
    })

    test('the word-end boundary is still INSIDE the word', () => {
      // "the quick brown fox": offset 9 ends "quick", offset 10 starts "brown".
      // There is no offset that means "in the space" — they bracket it — so 9
      // must read as not-yet-left, or dragging to the end of a word would snap
      // and partial selections ending at a word end would be impossible.
      const atEnd = stickySelectionBounds(T, 6, 9)
      expect(T.slice(atEnd.start, atEnd.end)).toBe('ick')

      // one further and you have arrived in the next word
      expect(sel(6, 10)).toBe('quick brown')
    })

    test('leading punctuation comes along when reached backwards', () => {
      const Q = '(aside) text'
      const { start, end } = stickySelectionBounds(Q, 3, 0)
      expect(Q.slice(start, end)).toBe('(aside')
    })
  })

  describe('the anchor-word test can be answered visually', () => {
    // The rule is "snapping engages once the drag LEAVES the word it began in".
    // Asking that in LOGICAL offsets is right only while visual and logical
    // order agree. In a bidi run they oppose: `עברית` inside an English line is
    // ~43px wide and renders right-to-left, so a few pixels of RIGHTWARD
    // movement walks logically BACKWARDS out of the word — the offset test says
    // "left the word", both ends snap, and the whole run highlights as one
    // block on the first small movement. Reported from real use in Safari and
    // Chrome; the same gesture in English stays inside a word long enough to
    // show character precision, which is why only RTL looked broken.
    //
    // `Selectable.pointerInAnchorWord` answers it against the word's rendered
    // client rects instead. That needs layout, so it is verified in the browser
    // lane; what is pinned here is that the parameter overrides the offset test
    // in both directions.
    const T = 'the quick brown fox'

    test('claiming we are still inside keeps character precision', () => {
      // The head must be somewhere the OFFSET test would call "left the word",
      // or the two branches agree and the test proves nothing: anchor 5 is in
      // `quick` (4..9) and head 11 is inside `brown`. Logically that snaps to
      // `quick brown`; told the pointer is still over the anchor word, it does
      // not.
      const { start, end } = stickySelectionBounds(T, 5, 11, false)
      expect(T.slice(start, end)).toBe('uick b')
    })

    test('claiming we left snaps both ends, even mid-word', () => {
      // offsets say we are still inside `quick`, the caller says we left it
      const { start, end } = stickySelectionBounds(T, 5, 7, true)
      expect(T.slice(start, end)).toBe('quick')
    })

    test('omitting it keeps the original logical behaviour', () => {
      // the existing contract is unchanged when the caller does not measure
      expect(
        (({ start, end }) => T.slice(start, end))(
          stickySelectionBounds(T, 4, 7)
        )
      ).toBe('qui')
      expect(
        (({ start, end }) => T.slice(start, end))(
          stickySelectionBounds(T, 6, 12)
        )
      ).toBe('quick brown')
    })

    test('a one-word run cannot be partially selected by the offset test alone', () => {
      // The shape of the bug, as a pure-function fact: with the anchor mid-word
      // and the head one character outside it, the logical test snaps the whole
      // word. For a 5-character run that is the entire run.
      const heb = 'Another English item with עברית inside it'
      const anchor = 28 // inside עברית (26..31)
      const logical = stickySelectionBounds(heb, anchor, 25)
      expect(heb.slice(logical.start, logical.end)).toContain('עברית')
      // Same head — one character OUTSIDE the run, which is all a few pixels of
      // rightward movement amounts to here — but told the pointer is still over
      // the word. Precision survives, and the whole run is not swallowed.
      const visual = stickySelectionBounds(heb, anchor, 25, false)
      expect(heb.slice(visual.start, visual.end)).not.toContain('עברית')
    })
  })

  describe('degenerate input does not throw', () => {
    test('empty text', () => {
      expect(() => stickySelectionBounds('', 0, 0)).not.toThrow()
    })
    test('offsets past the end', () => {
      expect(() => stickySelectionBounds('hi', 99, 99)).not.toThrow()
    })
  })
})

/**
 * Word stickiness is PER POINTER, and `stickySelection` says so: `'touch'` by
 * default, `'always'`, `'never'`.
 *
 * Two bugs live here. First, stickiness was wired to the mouse and not to touch
 * — `dragAnchor` had a single assignment in `handleMouseDown` and
 * `extendSticky` a single caller in `handleMouseMove`, so `handleTouchMove`
 * moved the end bound to the character under the finger and nothing else, under
 * a comment reading "Same measurement as a mouse drag" (true of
 * `characterAtPoint`, false of the sticky rule). Second, once both paths had it,
 * the mouse should not: rounding a drag a mouse user aimed out to word
 * boundaries overrides a precise gesture, and the platform's answer for "select
 * this word" is already a double-click.
 *
 * So the tests drive the same gesture through both event families and assert
 * they DIFFER by default, and agree under `'always'` and `'never'`.
 */
describe('word stickiness is per pointer', () => {
  let root: HTMLElement
  let sel: Selectable
  let rangeProto: any
  let realRect: () => DOMRect
  let realRects: () => DOMRectList
  let realFromPoint: any

  /**
   * One line, 10px per character, so "hello world" spans x 0..110.
   *
   * Measured from the range's LOGICAL position in the paragraph, not from
   * `startOffset`/`endOffset` directly. That distinction is the whole subject
   * here: the bounds markers split the text node they sit in, so a range over
   * the word "hello" can run from offset 0 of "hel" to offset 2 of "lo world".
   * A stub reading the raw offsets calls that box 0..20 instead of 0..50, and
   * then reports the pointer as OUTSIDE the anchor word — which is a harness
   * defect that looks exactly like the product defect under test. The first
   * version of this test had it, and its "the mouse snaps" precondition passed
   * for the wrong reason.
   */
  const logical = (node: Node, offset: number): number => {
    const block = root.querySelector('p')!
    let seen = 0
    let found: number | null = null
    const walk = (n: Node): void => {
      if (found !== null) return
      if (n === node) {
        found = seen + offset
        return
      }
      if (n.nodeType === 3) {
        seen += (n as Text).data.length
        return
      }
      for (const c of Array.from(n.childNodes)) walk(c)
    }
    walk(block)
    return found ?? offset
  }

  beforeEach(() => {
    root = document.createElement('div')
    root.innerHTML = '<p>hello world</p>'
    document.body.appendChild(root)
    sel = new Selectable(root)
    rangeProto = Object.getPrototypeOf(document.createRange())
    realRect = rangeProto.getBoundingClientRect
    realRects = rangeProto.getClientRects
    const rect = function (this: Range) {
      const a = logical(this.startContainer, this.startOffset)
      const b = Math.max(logical(this.endContainer, this.endOffset), a + 1)
      return {
        left: a * 10,
        right: b * 10,
        top: 0,
        bottom: 10,
        width: (b - a) * 10,
        height: 10,
        x: a * 10,
        y: 0,
      } as DOMRect
    }
    rangeProto.getBoundingClientRect = rect
    rangeProto.getClientRects = function (this: Range) {
      return [rect.call(this)] as unknown as DOMRectList
    }
    // `handleTouchMove` resolves the element under the FINGER, because a
    // TouchEvent's target is where the touch began, not where it is now.
    // happy-dom returns null, which made the handler bail before reaching any
    // of the code under test.
    realFromPoint = (document as any).elementFromPoint
    ;(document as any).elementFromPoint = (x: number, y: number) => {
      const block = root.querySelector('p')
      if (!block) return null
      return x >= 0 && x <= 110 && y >= 0 && y <= 10 ? block : null
    }
  })

  afterEach(() => {
    rangeProto.getBoundingClientRect = realRect
    rangeProto.getClientRects = realRects
    ;(document as any).elementFromPoint = realFromPoint
    sel.destroy()
    root.remove()
  })

  /** The text between the bounds markers, read structurally. */
  const selectedText = (): string => {
    const block = root.querySelector('p')!
    let out = ''
    let inside = false
    const walk = (n: Node): void => {
      if (n instanceof Element) {
        if (n.classList.contains('sel-start')) {
          inside = true
          return
        }
        if (n.classList.contains('sel-end')) {
          inside = false
          return
        }
      }
      if (n.nodeType === 3) {
        if (inside) out += (n as Text).data
        return
      }
      for (const c of Array.from(n.childNodes)) walk(c)
    }
    walk(block)
    return out
  }

  const bothMarkersPresent = (): boolean =>
    !!root.querySelector('.sel-start') && !!root.querySelector('.sel-end')

  /** happy-dom has no `Touch` constructor; the handlers read only these. */
  const touchEvent = (type: string, x: number, y: number): Event => {
    const evt = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(evt, 'touches', {
      value: [{ clientX: x, clientY: y }],
    })
    return evt
  }

  const mouseDrag = (from: number, to: number): void => {
    const block = root.querySelector('p')!
    block.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: from,
        clientY: 5,
        detail: 1,
      })
    )
    block.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: to, clientY: 5 })
    )
    block.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        clientX: to,
        clientY: 5,
        detail: 1,
      })
    )
  }

  const touchDrag = (from: number, to: number): void => {
    const block = root.querySelector('p')!
    block.dispatchEvent(touchEvent('touchstart', from, 5))
    block.dispatchEvent(touchEvent('touchmove', to, 5))
    block.dispatchEvent(touchEvent('touchend', to, 5))
  }

  // THE PRECONDITION for everything below. Every assertion here is about
  // whether snapping happened, so a harness that cannot produce snapping at all
  // would make the lot of them vacuous — and an earlier version of this file
  // did exactly that. Forcing 'always' is the cheapest way to keep asking.
  test("with stickySelection 'always', a mouse drag snaps to word bounds", () => {
    sel.stickySelection = 'always'
    mouseDrag(25, 85) // inside "hello" -> inside "world"
    expect(bothMarkersPresent()).toBe(true)
    expect(selectedText()).toBe('hello world')
  })

  test('by DEFAULT a mouse drag does not snap — the platform behaviour', () => {
    mouseDrag(25, 85)
    expect(bothMarkersPresent()).toBe(true)
    const text = selectedText()
    expect(text).not.toBe('hello world')
    // It still selected the span it was dragged across, just not rounded out.
    expect(text.length).toBeGreaterThan(3)
    expect(text.length).toBeLessThan(11)
  })

  test('by default a TOUCH drag does snap — the finger has no precision', () => {
    touchDrag(25, 85)
    expect(bothMarkersPresent()).toBe(true)
    expect(selectedText()).toBe('hello world')
  })

  test("'never' turns it off for touch as well", () => {
    sel.stickySelection = 'never'
    touchDrag(25, 85)
    expect(bothMarkersPresent()).toBe(true)
    expect(selectedText()).not.toBe('hello world')
  })

  test('the same editor answers differently for the two pointers', () => {
    // A hybrid laptop is one document with two pointers, so this is one
    // Selectable, not two configurations.
    touchDrag(25, 85)
    const byTouch = selectedText()
    sel.removeBounds()
    ;(sel as any).dragAnchor = null
    mouseDrag(25, 85)
    const byMouse = selectedText()
    expect(byTouch).toBe('hello world')
    expect(byMouse).not.toBe(byTouch)
  })

  test('touchstart records an anchor, as mousedown does', () => {
    const block = root.querySelector('p')!
    expect((sel as any).dragAnchor).toBeNull()
    block.dispatchEvent(touchEvent('touchstart', 25, 5))
    const anchor = (sel as any).dragAnchor
    expect(anchor).not.toBeNull()
    expect(anchor.block).toBe(block)
    // Inside "hello" (0..5), which is what makes the drag above sticky at all.
    expect(anchor.index).toBeGreaterThanOrEqual(0)
    expect(anchor.index).toBeLessThanOrEqual(5)
  })

  test('a drag that stays INSIDE the anchor word keeps character precision', () => {
    // The half of the rule that must NOT fire: 25 -> 45 never leaves "hello".
    // Under 'always', so this is the sticky path declining to snap rather than
    // stickiness simply being off for the mouse.
    sel.stickySelection = 'always'
    mouseDrag(25, 45)
    const byMouse = selectedText()
    expect(bothMarkersPresent()).toBe(true)
    expect(byMouse).not.toBe('hello world')
    expect(byMouse.length).toBeLessThan(5)
  })

  // NOT a pin for the mouse/touch bug: inside the anchor word, sticky selection
  // and the old raw character placement produce the same answer, so this passed
  // against the unfixed code too (checked). It is kept as a guard against the
  // OPPOSITE regression — touch snapping to words when it should not — which is
  // a live hazard now that touch is sticky at all.
  test('and touch agrees with the mouse on that too', () => {
    sel.stickySelection = 'always'
    mouseDrag(25, 45)
    const byMouse = selectedText()
    sel.removeBounds()
    ;(sel as any).dragAnchor = null
    touchDrag(25, 45)
    expect(bothMarkersPresent()).toBe(true)
    expect(selectedText()).toBe(byMouse)
  })

  test('touchend clears the anchor, so the next gesture is not sticky to it', () => {
    const block = root.querySelector('p')!
    block.dispatchEvent(touchEvent('touchstart', 25, 5))
    // Asserted mid-gesture on purpose: without it, "null afterwards" is also
    // true of a path that never set an anchor, which is the bug this file
    // exists for — the test would pass against the unfixed code.
    expect((sel as any).dragAnchor).not.toBeNull()
    block.dispatchEvent(touchEvent('touchmove', 85, 5))
    block.dispatchEvent(touchEvent('touchend', 85, 5))
    expect((sel as any).dragAnchor).toBeNull()
  })
})

/**
 * What hybrid devices depend on. A Surface Pro raises `touchstart` for a finger
 * and then, unless the touch is prevented, Chrome synthesises a `mousedown`
 * too — which would flip `touchMode` to false mid-gesture and lose stickiness
 * on the very device that needs it. The defence is that the touch listeners are
 * non-passive and `handleTouchStart` prevents the default.
 */
describe('touch listeners stay non-passive, for hybrid devices', () => {
  let root: HTMLElement
  let sel: Selectable

  beforeEach(() => {
    root = document.createElement('div')
    root.innerHTML = '<p>hello world</p>'
    document.body.appendChild(root)
    sel = new Selectable(root)
  })

  afterEach(() => {
    sel.destroy()
    root.remove()
  })

  test('touchstart calls preventDefault, suppressing compatibility mouse events', () => {
    const block = root.querySelector('p')!
    const evt = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(evt, 'touches', {
      value: [{ clientX: 5, clientY: 5 }],
    })
    block.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
  })

  test('a mousedown after a touch would flip touchMode — hence the above', () => {
    const block = root.querySelector('p')!
    const touch = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(touch, 'touches', {
      value: [{ clientX: 5, clientY: 5 }],
    })
    block.dispatchEvent(touch)
    expect(sel.touchMode).toBe(true)
    // This is what Chrome sends if the touch is NOT prevented. Asserted so the
    // consequence is visible: it is why preventDefault is load-bearing rather
    // than merely tidy.
    block.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: 5,
        clientY: 5,
        detail: 1,
      })
    )
    expect(sel.touchMode).toBe(false)
  })
})

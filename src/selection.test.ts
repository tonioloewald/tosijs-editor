import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { spanify, Selectable } from './selection'
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
    const spans = [...p.querySelectorAll('.spanified')].map((s) => s.textContent)
    // split('') would give 4 spans, the middle two being lone surrogates
    expect(spans).toEqual(['a', '\u{1F310}', 'b'])
    expect(p.textContent).toBe('a\u{1F310}b')
  })

  test('keeps a flag whole — two regional indicators are one grapheme', () => {
    container.innerHTML = '<p>\u{1F1EC}\u{1F1E7}!</p>'
    const p = container.querySelector('p')!
    spanify(p, true)
    const spans = [...p.querySelectorAll('.spanified')].map((s) => s.textContent)
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
    const spaceSpans = [...p.querySelectorAll('.spanified')].filter(
      (s) => /^\s+$/.test(s.textContent || '')
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
        left: i * 10, right: i * 10 + 10, top: 0, bottom: 10,
        width: 10, height: 10, x: i * 10, y: 0,
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
    range.setEnd(root.querySelector('p')!, root.querySelector('p')!.childNodes.length)
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

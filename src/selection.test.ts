import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { spanify, Selectable } from './selection'

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
        true,
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
        true,
      )
      expect(root.querySelector('.b')!.classList.contains('selected')).toBe(
        true,
      )
      expect(root.querySelector('.c')!.classList.contains('selected')).toBe(
        true,
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

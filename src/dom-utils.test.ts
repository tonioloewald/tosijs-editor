import { test, expect, describe, beforeEach } from 'bun:test'
import {
  makeFilter,
  isBefore,
  siblingOrder,
  firstLeafNode,
  lastLeafNode,
  nextLeafNode,
  previousLeafNode,
  leafNodes,
  topSingleParentAncestor,
  closestSingleParentAncestor,
  allowSelection,
} from './dom-utils'

describe('makeFilter', () => {
  test('undefined filter matches everything', () => {
    const fn = makeFilter()
    expect(fn(document.createTextNode('hi'))).toBe(true)
    expect(fn(document.createElement('div'))).toBe(true)
  })

  test('function filter is used directly', () => {
    const fn = makeFilter((node) => node.nodeType === 3)
    expect(fn(document.createTextNode('hi'))).toBe(true)
    expect(fn(document.createElement('div'))).toBe(false)
  })

  test('string filter matches element selector', () => {
    const fn = makeFilter('.foo')
    const el = document.createElement('span')
    el.className = 'foo'
    expect(fn(el)).toBe(true)
    expect(fn(document.createElement('span'))).toBe(false)
    // text nodes never match selector filters
    expect(fn(document.createTextNode('hi'))).toBe(false)
  })
})

describe('isBefore', () => {
  test('returns true when a is before b', () => {
    const div = document.createElement('div')
    const a = document.createElement('span')
    const b = document.createElement('span')
    div.append(a, b)
    expect(isBefore(a, b)).toBe(true)
    expect(isBefore(b, a)).toBe(false)
  })
})

describe('siblingOrder', () => {
  test('returns index among siblings', () => {
    const div = document.createElement('div')
    const a = document.createElement('span')
    const b = document.createElement('span')
    const c = document.createElement('span')
    div.append(a, b, c)
    expect(siblingOrder(a)).toBe(0)
    expect(siblingOrder(b)).toBe(1)
    expect(siblingOrder(c)).toBe(2)
  })

  test('returns -1 for detached node', () => {
    const el = document.createElement('div')
    expect(siblingOrder(el)).toBe(-1)
  })

  test('counts text nodes', () => {
    const div = document.createElement('div')
    const text = document.createTextNode('hello')
    const span = document.createElement('span')
    div.append(text, span)
    expect(siblingOrder(text)).toBe(0)
    expect(siblingOrder(span)).toBe(1)
  })
})

describe('firstLeafNode', () => {
  test('returns the node itself if it has no children', () => {
    const text = document.createTextNode('hello')
    expect(firstLeafNode(text)).toBe(text)
  })

  test('traverses to deepest first child', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p><b><i>deep</i></b></p>'
    const leaf = firstLeafNode(div)
    expect(leaf.nodeType).toBe(3) // text node
    expect(leaf.textContent).toBe('deep')
  })

  test('finds first text in complex tree', () => {
    const div = document.createElement('div')
    div.innerHTML = '<ul><li>first</li><li>second</li></ul>'
    const leaf = firstLeafNode(div)
    expect(leaf.textContent).toBe('first')
  })
})

describe('lastLeafNode', () => {
  test('returns the node itself if it has no children', () => {
    const text = document.createTextNode('hello')
    expect(lastLeafNode(text)).toBe(text)
  })

  test('traverses to deepest last child', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p>first</p><p>last</p>'
    const leaf = lastLeafNode(div)
    expect(leaf.textContent).toBe('last')
  })
})

describe('nextLeafNode', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('div')
    root.innerHTML = '<p>AB</p><p>CD</p>'
    document.body.appendChild(root)
  })

  test('moves to next sibling leaf', () => {
    // Structure: div > p > "AB", p > "CD"
    const firstText = firstLeafNode(root) // "AB"
    const next = nextLeafNode(firstText, root)
    expect(next).not.toBeNull()
    expect(next!.textContent).toBe('CD')
  })

  test('returns null at end', () => {
    const lastText = lastLeafNode(root) // "CD"
    const next = nextLeafNode(lastText, root)
    expect(next).toBeNull()
  })

  test('with filter skips non-matching nodes', () => {
    root.innerHTML =
      '<p><span class="skip">A</span><span class="keep">B</span></p>'
    const first = firstLeafNode(root) // "A" inside .skip
    const next = nextLeafNode(first, root, (node) => {
      // only match text nodes whose parent has class "keep"
      return (
        node.nodeType === 3 &&
        node.parentElement !== null &&
        node.parentElement.classList.contains('keep')
      )
    })
    expect(next).not.toBeNull()
    expect(next!.textContent).toBe('B')
  })
})

describe('previousLeafNode', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('div')
    root.innerHTML = '<p>AB</p><p>CD</p>'
    document.body.appendChild(root)
  })

  test('moves to previous sibling leaf', () => {
    const lastText = lastLeafNode(root) // "CD"
    const prev = previousLeafNode(lastText, root)
    expect(prev).not.toBeNull()
    expect(prev!.textContent).toBe('AB')
  })

  test('returns null at start', () => {
    const firstText = firstLeafNode(root)
    const prev = previousLeafNode(firstText, root)
    expect(prev).toBeNull()
  })

  test('with filter skips non-matching nodes', () => {
    root.innerHTML =
      '<p><span class="keep">A</span><span class="skip">B</span></p>'
    const last = lastLeafNode(root) // "B" inside .skip
    const prev = previousLeafNode(last, root, (node) => {
      return (
        node.nodeType === 3 &&
        node.parentElement !== null &&
        node.parentElement.classList.contains('keep')
      )
    })
    expect(prev).not.toBeNull()
    expect(prev!.textContent).toBe('A')
  })
})

describe('leafNodes', () => {
  test('collects all text nodes', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p>A</p><p>B</p><p>C</p>'
    const leaves = leafNodes(div)
    expect(leaves.length).toBe(3)
    expect(leaves.map((n) => n.textContent)).toEqual(['A', 'B', 'C'])
  })

  test('includes non-text leaf elements like hr', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p>A</p><hr><p>B</p>'
    const leaves = leafNodes(div)
    expect(leaves.length).toBe(3)
    expect((leaves[1] as Element).tagName).toBe('HR')
  })

  test('with filter only returns matching nodes', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p>A</p><hr><p>B</p>'
    const textOnly = leafNodes(div, (node) => node.nodeType === 3)
    expect(textOnly.length).toBe(2)
  })

  test('handles empty elements', () => {
    const div = document.createElement('div')
    div.innerHTML = '<span></span>'
    const leaves = leafNodes(div)
    expect(leaves.length).toBe(1) // the empty span is a leaf
    expect((leaves[0] as Element).tagName).toBe('SPAN')
  })
})

describe('topSingleParentAncestor', () => {
  test('walks up through single-child parent, stops at multi-child parent', () => {
    const div = document.createElement('div')
    div.innerHTML = '<span>A</span><span>B</span>'
    const textA = div.querySelector('span')!.firstChild!
    // text "A" is only child of <span>, so walks up to <span>
    // <span> parent is div with 2 children, so stops at <span>
    expect(topSingleParentAncestor(textA)).toBe(div.querySelector('span')!)
  })

  test('walks up single-child chain', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p><b><i>deep</i></b></p>'
    const text = div.querySelector('i')!.firstChild!
    // chain: text -> i -> b -> p, all single-child up to div
    const top = topSingleParentAncestor(text, (node) => {
      return node !== div
    })
    expect(top).toBe(div.querySelector('p')!)
  })

  test('stops when filter rejects parent', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p><b><i>deep</i></b></p>'
    const text = div.querySelector('i')!.firstChild!
    const top = topSingleParentAncestor(text, (node) => {
      return (node as Element).tagName !== 'P'
    })
    expect(top).toBe(div.querySelector('b')!)
  })
})

describe('closestSingleParentAncestor', () => {
  test('finds matching ancestor in single-child chain', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p><span class="setText"><i>text</i></span></p>'
    const text = div.querySelector('i')!.firstChild!
    const result = closestSingleParentAncestor(text, '.setText')
    expect(result).toBe(div.querySelector('.setText'))
  })

  test('returns null if no match in chain', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p><b>text</b></p>'
    const text = div.querySelector('b')!.firstChild!
    const result = closestSingleParentAncestor(text, '.setText')
    expect(result).toBeNull()
  })

  test('stops at multi-child parent', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p class="setText"><span>A</span><span>B</span></p>'
    const text = div.querySelector('span')!.firstChild!
    // The .setText is on p, but p has 2 children so chain breaks at span
    const result = closestSingleParentAncestor(text, '.setText')
    expect(result).toBeNull()
  })
})

describe('allowSelection', () => {
  test('sets user-select to text when allowed', () => {
    const el = document.createElement('div')
    allowSelection(el, true)
    expect(el.style.userSelect).toBe('text')
  })

  test('sets user-select to none when disallowed', () => {
    const el = document.createElement('div')
    allowSelection(el, false)
    expect(el.style.userSelect).toBe('none')
  })
})

/**
 * DOM traversal utilities for the tosijs-styled-editor component.
 *
 * All operations work in terms of "leaf nodes" — nodes with no children
 * (text nodes, <img>, <hr>, <input>, etc.).
 */

export type NodeFilter = ((node: Node) => boolean) | string

/**
 * Normalize a filter to a predicate function.
 * - string: matches via Element.matches(selector) (text nodes never match)
 * - function: used directly
 * - undefined: matches everything
 */
export function makeFilter(filter?: NodeFilter): (node: Node) => boolean {
  if (typeof filter === 'function') {
    return filter
  }
  if (typeof filter === 'string') {
    const selector = filter
    return (node: Node) =>
      node.nodeType === 1 && (node as Element).matches(selector)
  }
  return () => true
}

/** Returns true if `a` comes before `b` in document order. */
export function isBefore(a: Node, b: Node): boolean {
  // compareDocumentPosition: bit 4 means `a` is before `b`
  return (a.compareDocumentPosition(b) & 4) !== 0
}

/** Returns the index of `node` among its parent's childNodes (-1 if no parent). */
export function siblingOrder(node: Node): number {
  const parent = node.parentNode
  if (!parent) return -1
  const children = parent.childNodes
  for (let i = 0; i < children.length; i++) {
    if (children[i] === node) return i
  }
  return -1
}

/** Returns the first leaf node (deepest first-child) within `node`. */
export function firstLeafNode(node: Node): Node {
  while (node.firstChild) {
    node = node.firstChild
  }
  return node
}

/** Returns the last leaf node (deepest last-child) within `node`. */
export function lastLeafNode(node: Node): Node {
  while (node.lastChild) {
    node = node.lastChild
  }
  return node
}

/**
 * Returns the next leaf node after `node`, stopping at `root`.
 * If `filter` is provided, skips nodes that don't match.
 */
export function nextLeafNode(
  node: Node,
  root?: Node,
  filter?: NodeFilter
): Node | null {
  const fn = filter !== undefined ? makeFilter(filter) : null
  let current: Node | null = node

  while (current) {
    if (current.nextSibling) {
      const next = firstLeafNode(current.nextSibling)
      if (!fn || fn(next)) return next
      current = next
      continue
    }
    if (current.parentNode && current.parentNode !== (root || null)) {
      current = current.parentNode
      continue
    }
    break
  }

  return null
}

/**
 * Returns the previous leaf node before `node`, stopping at `root`.
 * If `filter` is provided, skips nodes that don't match.
 */
export function previousLeafNode(
  node: Node,
  root?: Node,
  filter?: NodeFilter
): Node | null {
  const fn = filter !== undefined ? makeFilter(filter) : null
  let current: Node | null = node

  while (current) {
    if (current.previousSibling) {
      const prev = lastLeafNode(current.previousSibling)
      if (!fn || fn(prev)) return prev
      current = prev
      continue
    }
    if (current.parentNode && current.parentNode !== (root || null)) {
      current = current.parentNode
      continue
    }
    break
  }

  return null
}

/** Collect all leaf nodes within `node`, optionally filtered. */
export function leafNodes(node: Node, filter?: NodeFilter): Node[] {
  const result: Node[] = []
  const fn = filter !== undefined ? makeFilter(filter) : null

  function walk(n: Node) {
    if (!n.firstChild) {
      if (!fn || fn(n)) {
        result.push(n)
      }
    } else {
      for (let i = 0; i < n.childNodes.length; i++) {
        walk(n.childNodes[i])
      }
    }
  }

  walk(node)
  return result
}

/**
 * Walk up the chain of ancestors that have only one child.
 * Returns the topmost single-parent ancestor, or the node itself
 * if its parent has multiple children.
 */
export function topSingleParentAncestor(node: Node, filter?: NodeFilter): Node {
  const fn = makeFilter(filter)
  while (
    node.parentNode &&
    node.parentNode.childNodes.length === 1 &&
    fn(node.parentNode)
  ) {
    node = node.parentNode
  }
  return node
}

/**
 * Walk up the chain of single-parent ancestors until one satisfies the filter.
 * Returns null if none match before the chain breaks.
 */
export function closestSingleParentAncestor(
  node: Node,
  filter: NodeFilter
): Node | null {
  const fn = makeFilter(filter)
  let current: Node | null = node.parentNode
  while (current) {
    if (fn(current)) return current
    if (!current.parentNode || current.parentNode.childNodes.length !== 1) break
    current = current.parentNode
  }
  return null
}

/** Set user-select CSS on an element. */
export function allowSelection(element: HTMLElement, allow: boolean): void {
  element.style.userSelect = allow ? 'text' : 'none'
  // Also set webkitUserSelect for Safari
  ;(element.style as any).webkitUserSelect = allow ? 'text' : 'none'
}

/** A character position found by measurement: where it is, and which side of it */
export interface CharacterHit {
  node: Text
  offset: number
  rect: DOMRect
  after: boolean
}

/** Should this text node be considered for hit-testing? */
function isHitTestable(node: Node): boolean {
  if (node.nodeType !== 3 || !node.textContent) return false
  const parent = node.parentElement
  if (!parent) return false
  return !parent.closest('.not-selectable, .do-not-spanify, .not-editable')
}

/**
 * Find the character nearest a point WITHOUT changing the document.
 *
 * The editor used to answer this by wrapping every character in a span and
 * reading the spans' rects. That works, but it is a DOM mutation performed in
 * order to measure — and measuring by mutating changes the thing measured:
 * line-breaking shifts, and in engines that do not shape across inline box
 * boundaries, cursive scripts come apart.
 *
 * A Range reports the same geometry read-only. This is Range as a measuring
 * tape, not as a selection model: no execCommand, no browser selection, no
 * editing behaviour handed back to the engine.
 */
export function characterAtPoint(
  root: Element,
  x: number,
  y: number
): CharacterHit | null {
  const texts: Text[] = []
  const walk = (node: Node): void => {
    if (isHitTestable(node)) {
      texts.push(node as Text)
      return
    }
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  walk(root)
  if (texts.length === 0) return null

  const range = document.createRange()
  let best: CharacterHit | null = null
  let bestScore = Infinity

  // A caret goes at the NEAREST EDGE of the character under the pointer — that
  // single rule covers clicking, dragging from, and dragging to, so there is no
  // separate start-bound/end-bound rounding anywhere. The only direction-
  // dependent part is which logical offset an edge corresponds to:
  //
  //            left edge   right edge
  //   LTR run  offset i    offset i+1
  //   RTL run  offset i+1  offset i
  //
  // `after` means offset + 1. Testing the visual right half unconditionally got
  // RTL backwards, which is why LTR and RTL drifted in opposite directions.
  const isRtl = (node: Text): boolean => {
    const el = node.parentElement
    return !!el && getComputedStyle(el).direction === 'rtl'
  }

  for (const node of texts) {
    const text = node.textContent || ''
    const rtl = isRtl(node)
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue

      // Vertical distance dominates: a point below a line belongs to that line,
      // however far along it sits. Horizontal only separates within a line.
      const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
      const score = dy * 1000 + dx
      if (score < bestScore) {
        bestScore = score
        best = {
          node,
          offset: i,
          rect,
          after: rtl
            ? x - rect.left < rect.width / 2
            : x - rect.left >= rect.width / 2,
        }
      }
    }
  }
  return best
}

/**
 * Where a caret sitting at `marker` should actually paint.
 *
 * The marker is an empty element, so its own rect is 0x0 and carries no line
 * box — falling back to the PARENT's rect gives the height of the whole block,
 * which paints a caret several lines tall. The geometry has to come from an
 * adjacent character instead, measured with a Range.
 *
 * Which edge of that character depends on direction: a caret before a character
 * sits at its leading edge (left in LTR, right in RTL); a caret after the last
 * character sits at its trailing edge.
 */
export function caretGeometryAt(
  marker: Element,
  root: Element
): { left: number; top: number; height: number } | null {
  const nextText = (from: Node | null): Text | null => {
    let node = from
    while (node) {
      if (node.nodeType === 3 && (node as Text).data.length > 0) {
        return node as Text
      }
      node = nextLeafNode(node, root)
    }
    return null
  }
  const prevText = (from: Node | null): Text | null => {
    let node = from
    while (node) {
      if (node.nodeType === 3 && (node as Text).data.length > 0) {
        return node as Text
      }
      node = previousLeafNode(node, root)
    }
    return null
  }

  // A COLLAPSED range AT A TEXT OFFSET is the caret position straight from the
  // layout engine: zero width, the line box's height, and an x the engine
  // resolved for that logical offset, so bidi needs no direction handling here.
  // It must be a text offset — collapsed BEFORE the marker element the engine
  // returns an empty rect, which is what made the caret fall back to the
  // parent block's height and paint several lines tall.
  const caretAt = (node: Text, offset: number) => {
    const range = document.createRange()
    range.setStart(node, offset)
    range.collapse(true)
    const rect = range.getBoundingClientRect()
    return rect.height
      ? { left: rect.left, top: rect.top, height: rect.height }
      : null
  }

  const after = nextText(nextLeafNode(marker, root))
  if (after) {
    const geometry = caretAt(after, 0)
    if (geometry) return geometry
  }

  const before = prevText(previousLeafNode(marker, root))
  if (before) {
    const geometry = caretAt(before, before.data.length)
    if (geometry) return geometry
  }

  // Last resort: an adjacent character's box, edge chosen by direction.
  const rtl =
    getComputedStyle(marker.parentElement || marker).direction === 'rtl'
  const range = document.createRange()
  if (after) {
    range.setStart(after, 0)
    range.setEnd(after, 1)
    const rect = range.getBoundingClientRect()
    if (rect.height) {
      return {
        left: rtl ? rect.right : rect.left,
        top: rect.top,
        height: rect.height,
      }
    }
  }
  if (before) {
    range.setStart(before, before.data.length - 1)
    range.setEnd(before, before.data.length)
    const rect = range.getBoundingClientRect()
    if (rect.height) {
      return {
        left: rtl ? rect.left : rect.right,
        top: rect.top,
        height: rect.height,
      }
    }
  }

  return null
}

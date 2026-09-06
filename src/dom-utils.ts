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
export function topSingleParentAncestor(
  node: Node,
  filter?: NodeFilter
): Node {
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

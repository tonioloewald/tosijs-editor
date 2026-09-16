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

  // Cheap pre-pass. Measuring every character in the document costs one rect
  // per character, which is linear in document size and runs on every
  // mousemove of a drag — fine for a demo paragraph, jank for a real document.
  // A text node can only contain the answer if it is on (or nearest to) the
  // pointer's line, and that takes ONE rect per node to decide. Only the nodes
  // in the nearest vertical band are then measured character by character.
  let nearestBand = Infinity
  const bands: Array<{ node: Text; dy: number }> = []
  for (const node of texts) {
    range.selectNodeContents(node)
    const box = range.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0
    bands.push({ node, dy })
    if (dy < nearestBand) nearestBand = dy
  }
  if (bands.length === 0) return null
  // Keep a little slack: adjacent inline runs on one line can differ slightly
  // in box height, and a node spanning several lines contains the point anyway.
  const candidates = bands
    .filter((entry) => entry.dy <= nearestBand + 2)
    .map((entry) => entry.node)

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

  for (const node of candidates) {
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
      // Cursive scripts overlap: in Arabic a point often falls INSIDE several
      // glyph boxes at once, so dx is 0 for all of them and the winner used to
      // be whichever came first in document order. That makes the answer
      // non-monotonic as the pointer moves — dragging a selection could stop
      // advancing while the pointer kept going. Break the tie on distance to
      // the glyph's CENTRE, which does vary smoothly with x.
      const centreDistance = Math.abs(x - (rect.left + rect.right) / 2)
      const score = dy * 1000 + dx + centreDistance / 1000
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

/**
 * Schemes a URL-bearing attribute may use inside the document.
 *
 * `javascript:` is the one that matters — it executes in the embedding page's
 * origin, and `noopener` does not prevent it. `data:` is allowed only for
 * images, because `data:text/html` is a same-origin script vector.
 */
/**
 * Normalize a URL the way the URL parser does, for scheme testing only.
 *
 * WHATWG removes leading and trailing C0-or-space, and every ASCII tab/LF/CR
 * ANYWHERE, before matching a scheme. Testing the raw string instead let
 * `java&#9;script:` read as a schemeless relative path while the browser saw
 * `javascript:` — checking a different string from the one that gets parsed.
 *
 * It must mirror the parser in BOTH directions. Stripping all spaces was too
 * aggressive: `Chapter 3: Intro.html` became `Chapter3:Intro.html`, which
 * matches the scheme pattern, fails the allowlist, and had its href silently
 * removed — a legitimate relative link destroyed by the sanitizer. Interior
 * spaces are preserved here, and still break the scheme match exactly as they
 * do in the parser.
 *
 * ONE implementation, deliberately: this logic previously existed twice as
 * inline expressions, and the fix for the tab bypass reached only one of them.
 */
function forSchemeTest(value: string): string {
  return value
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
    .replace(/[\t\n\r]/g, '')
}

function isSafeUrl(value: string): boolean {
  const trimmed = forSchemeTest(value)
  // Protocol-relative and path-relative URLs carry no scheme and are fine.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp|svg\+xml);/i.test(trimmed)) {
    // SVG can carry script, so allow it only where it cannot execute (img src),
    // which the caller enforces by attribute name.
    return !/^data:image\/svg/i.test(trimmed)
  }
  return /^(https?|mailto|tel):/i.test(trimmed)
}

/**
 * Elements that can execute or re-target, and are never document content.
 *
 * Compared against `localName`, NOT `tagName`. `tagName` is upper-cased only
 * for elements in the HTML namespace: anything parsed into SVG or MathML
 * foreign content reports a LOWERCASE tagName, so an upper-case set silently
 * misses every entry there — `<svg><script>` survived, and an SVG `<style>`
 * needs no store-and-re-serve hop at all, since it applies document-wide the
 * moment it is inserted.
 */
const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'style',
  'form',
  'noscript',
  'template',
  // SVG animation can retarget an attribute — `<set attributeName="href"
  // to="javascript:…">` — which reintroduces a scheme we just checked.
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
])

/**
 * Attributes whose value is a URL.
 *
 * Enumerating these is the weak part of a denylist and it has already been
 * wrong: `ping`, `srcset` and `poster` were all missing, so
 * `<a ping="https://evil/collect">` sailed through. The scheme scan below is
 * the real defence — this list only decides which attributes get the STRICTER
 * treatment (rejecting schemes that are merely unknown, rather than only those
 * that are known-dangerous).
 */
const URL_ATTRIBUTES = [
  'href',
  'src',
  'srcset',
  'xlink:href',
  'action',
  'formaction',
  'ping',
  'poster',
  'background',
  'cite',
  'data',
  'longdesc',
  'profile',
  'usemap',
  'manifest',
]

/**
 * Schemes that execute, in ANY attribute.
 *
 * Checked against every attribute value regardless of name, because the
 * attribute list above cannot be trusted to be complete — a capability check
 * does not depend on having heard of the attribute.
 */
const DANGEROUS_SCHEME = /^(javascript|vbscript|livescript|mocha|data:text\/html)/i

/**
 * Attributes removed outright, whatever their value.
 *
 * Dangerous by CAPABILITY rather than by scheme, so no URL check catches them:
 * `ping` fires a POST to an arbitrary URL when a link is clicked — a perfectly
 * ordinary https URL, reporting that the reader clicked.
 *
 * NOT `is`, though it belongs here conceptually: `removeAttribute('is')` is a
 * NO-OP in Chrome once the attribute has been parsed, verified directly, so a
 * line for it would only look like protection. DOMPurify does not remove it
 * either. Neutralizing it means replacing the element rather than the
 * attribute, which is not worth doing inside a TreeWalker for an attack that
 * needs the host page to have registered a hostile customized built-in.
 */
const FORBIDDEN_ATTRIBUTES = new Set(['ping'])

/**
 * Clobber-proof accessors.
 *
 * Named form controls shadow same-named properties on their form, so a crafted
 * `<input name="localName">` or `name="attributes"` turns a string or a
 * NamedNodeMap into an element. These read the real getters off the prototype,
 * which an attacker cannot shadow.
 */
const localNameGetter = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'localName'
)?.get
const attributesGetter = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'attributes'
)?.get

function getLocalName(el: Element): string | undefined {
  return localNameGetter
    ? (localNameGetter.call(el) as string)
    : (el.localName as string)
}

function getAttributes(el: Element): NamedNodeMap | undefined {
  return attributesGetter
    ? (attributesGetter.call(el) as NamedNodeMap)
    : el.attributes
}

/**
 * Strip executable content from a subtree, IN PLACE.
 *
 * The editor replaced `contentEditable` but not the sanitization the browser
 * was doing on its behalf: pasted and dropped HTML is written into the live
 * document, and from there into `value`, `internals.setFormValue` and every
 * undo snapshot — so an unsanitized payload is stored, re-served, and re-fired
 * on undo. Must run BEFORE any node enters the document.
 *
 * This is deliberately a denylist for elements and an allowlist for URL
 * schemes: unknown ELEMENTS are content (including a plugin's custom elements,
 * which must survive — see EXTENSIBILITY.md), whereas unknown SCHEMES are not.
 */
export function sanitizeInPlace(root: Element | DocumentFragment): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  const doomed: Element[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    const el = node as Element
    // DOM CLOBBERING: a form's named controls shadow its own properties, so
    // `<form><input name="localName">` makes `el.localName` return that INPUT
    // rather than a string — `.toLowerCase()` then throws and takes the whole
    // paste with it. Reading through the prototype's own getter cannot be
    // clobbered, because the attacker can only shadow the instance.
    const localName = String(getLocalName(el) ?? '').toLowerCase()
    if (FORBIDDEN_TAGS.has(localName)) {
      doomed.push(el)
      continue
    }
    for (const attr of Array.from(getAttributes(el) ?? [])) {
      const name = attr.name.toLowerCase()
      // Every inline handler, however it is spelled.
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if (FORBIDDEN_ATTRIBUTES.has(name)) {
        el.removeAttribute(attr.name)
        continue
      }
      const normalized = forSchemeTest(attr.value)
      // Capability check first: an executing scheme is dangerous wherever it
      // appears, including in an attribute this list has never heard of.
      if (DANGEROUS_SCHEME.test(normalized)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRIBUTES.includes(name) && !isSafeUrl(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  }
  // Removing during the walk invalidates it, so do it after.
  for (const el of doomed) el.remove()
}

/**
 * Is this URL safe to NAVIGATE to, or to write into an href?
 *
 * Stricter than `isSafeUrl`: that one allows raster `data:image/*` because an
 * `<img src>` may legitimately carry one, while a link must never — so this
 * rejects every `data:` URL. Both must normalize identically, or the stricter
 * check is the one that gets bypassed: `da&#9;ta:image/png;…` passed here while
 * `data:image/png;…` was correctly rejected.
 */
export function isSafeNavigationUrl(value: string): boolean {
  return isSafeUrl(value) && !/^data:/i.test(forSchemeTest(value))
}

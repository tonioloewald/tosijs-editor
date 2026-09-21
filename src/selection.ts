/**
 * Selection management for tosijs-styled-editor.
 *
 * Replaces browser selection behavior entirely. Selections are tracked
 * using marker elements (.sel-start, .sel-end) and the .selected class.
 *
 * Key concept: "spanification" — wrapping each character (or word) in a
 * <span> so we can determine exact screen positions without browser
 * selection APIs.
 */

import {
  characterAtPoint,
  type CharacterHit,
  firstLeafNode,
  lastLeafNode,
  nextLeafNode,
  previousLeafNode,
  leafNodes,
  isBefore,
  allowSelection,
} from './dom-utils'

/**
 * Split text into user-perceived characters.
 *
 * NOT `split('')`, which splits by UTF-16 code unit: an emoji is a surrogate
 * PAIR, so that tears it into two lone surrogates that render as `?`. Even
 * `[...text]` is not enough — it splits by code point, which still breaks a
 * flag (two regional indicators), a skin-tone modifier, a ZWJ family, and any
 * base + combining mark. Grapheme segmentation is the only correct unit here,
 * because every one of those is ONE thing a user can click on or delete.
 */
function characters(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (!Segmenter) return Array.from(text)
  const segmenter = new Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (piece) => piece.segment)
}

/**
 * The bounds of the word containing `offset`, by Unicode word segmentation.
 *
 * This replaces the old approach of wrapping every word in a `.spanified-word`
 * element and reading boundaries off the DOM: the boundaries are a property of
 * the TEXT, so they can be computed from it directly and the document left
 * alone. Falls back to a whitespace split where Intl.Segmenter is missing.
 */
function wordBoundsAt(text: string, offset: number): { start: number; end: number } {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: 'word' })
    for (const piece of segmenter.segment(text)) {
      const end = piece.index + piece.segment.length
      if (offset >= piece.index && offset < end) {
        return { start: piece.index, end }
      }
    }
    return { start: offset, end: offset }
  }
  let start = offset
  let end = offset
  while (start > 0 && !/\s/.test(text[start - 1])) start--
  while (end < text.length && !/\s/.test(text[end])) end++
  return { start, end }
}

/**
 * Where a drag selection should actually end, given where it started.
 *
 * Dragging character by character is precise and miserable for selecting
 * prose; snapping to words is pleasant right up until you need half a word,
 * at which point it is infuriating. The rule that gets both:
 *
 *   **Snapping engages only once the drag LEAVES the word it began in.**
 *
 * In practice that means it snaps **as soon as you cross a space**, which is
 * more eager than it sounds and is the behaviour people like on trying it. It
 * is structural rather than a tuned threshold: offsets BRACKET the space (in
 * `the quick brown fox`, 9 ends `quick` and 10 starts `brown`), so there is no
 * "crossed the gap but not yet arrived" position for it to wait in. Anything
 * gentler would mean inventing a pixel margin to hold it back.
 *
 * Inside the anchor word you keep character precision, so pulling `fix` out of
 * `prefix` still works. The moment you cross into another word, both ends snap
 * — including the anchor end, because a selection that spans words but starts
 * mid-word is almost never what was meant. Coming back inside the anchor word
 * returns to character precision, and that is not jittery in practice because
 * the anchor word is a large target to re-enter.
 *
 * Punctuation is included only when the pointer has actually reached it. The
 * segmenter treats `,` and `(` as their own segments, so dragging onto the
 * comma in `hello,` takes the comma and stopping inside `hello` does not —
 * "as necessary" falls out rather than needing a rule.
 */
export function stickySelectionBounds(
  text: string,
  anchor: number,
  head: number
): { start: number; end: number } {
  const anchorWord = wordBoundsAt(text, anchor)

  // Still inside the word we started in: the user is being precise, let them.
  if (head >= anchorWord.start && head <= anchorWord.end) {
    return head < anchor
      ? { start: head, end: anchor }
      : { start: anchor, end: head }
  }

  const headWord = wordBoundsAt(text, head)

  // Do not drag whitespace along. Landing in the gap between two words means
  // you have left the first and not arrived at the second, so the boundary is
  // the edge of the text you actually crossed — otherwise every selection ends
  // with a trailing space you did not ask for.
  const trimEnd = (index: number): number => {
    let i = index
    while (i > 0 && /\s/.test(text[i - 1])) i--
    return i
  }
  const trimStart = (index: number): number => {
    let i = index
    while (i < text.length && /\s/.test(text[i])) i++
    return i
  }

  return head < anchor
    ? { start: trimStart(headWord.start), end: anchorWord.end }
    : { start: anchorWord.start, end: trimEnd(headWord.end) }
}

/** Check if a node is a text node not inside a .do-not-spanify element */
function isSpanifiableText(node: Node): boolean {
  return node.nodeType === 3 && !node.parentElement?.closest('.do-not-spanify')
}

/**
 * Wrap text nodes inside `element` into individual character spans
 * (or word spans if byWord is true). When `make` is false, unwraps
 * existing spanification.
 */
export function spanify(element: Element, make: boolean, byWord = false): void {
  if (make) {
    const textNodes = leafNodes(element, isSpanifiableText)
    for (const textNode of textNodes) {
      const text = textNode.textContent || ''
      let pieces: string[]

      if (byWord) {
        pieces = text.match(/\s+|\w+|[^\w\s]+/g) || [text]
      } else {
        pieces = characters(text)
      }

      if (pieces.length <= 1 && characters(text).length <= 1) continue

      const parent = textNode.parentNode
      if (!parent) continue

      // Remove spanified class from parent if it has it
      if (parent instanceof Element) {
        parent.classList.remove('spanified')
      }

      const fragment = document.createDocumentFragment()
      for (const piece of pieces) {
        // Whitespace stays a TEXT NODE, never its own span.
        //
        // Isolating a space in an inline box changes which spaces CSS collapses:
        // the same number collapse, but not the same ones, so words merge and
        // gaps open mid-word as the pointer sweeps across. Leaving whitespace in
        // the text reproduces the original layout exactly, space for space —
        // and costs nothing, because a click in a gap already resolves to the
        // nearest character via characterAtPoint().
        if (/^\s+$/.test(piece)) {
          fragment.appendChild(document.createTextNode(piece))
          continue
        }
        // More than one USER-PERCEIVED character, not more than one code unit
        if (characters(piece).length > 1) {
          const wordSpan = document.createElement('span')
          wordSpan.className = 'spanified-word'
          wordSpan.textContent = piece
          spanify(wordSpan, true, false) // recursively spanify words into chars
          fragment.appendChild(wordSpan)
        } else {
          const charSpan = document.createElement('span')
          charSpan.className = 'spanified'
          charSpan.textContent = piece
          fragment.appendChild(charSpan)
        }
      }
      parent.replaceChild(fragment, textNode)
    }
  } else {
    // Unwrap spanified elements
    const wordSpans = Array.from(element.querySelectorAll('.spanified-word'))
    for (const span of wordSpans) {
      const parent = span.parentNode
      if (parent) {
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span)
        }
        parent.removeChild(span)
      }
    }
    const charSpans = Array.from(element.querySelectorAll('.spanified'))
    for (const span of charSpans) {
      const parent = span.parentNode
      if (parent) {
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span)
        }
        parent.removeChild(span)
      }
    }
    element.normalize()
  }
}

/**
 * Selectable manages custom text selection within a root element.
 * It replaces browser selection with DOM-based markers.
 */
export class Selectable {
  root: HTMLElement
  selecting: number | false = false
  touchMode = false

  constructor(root: HTMLElement) {
    this.root = root
    this.setup()
  }

  private lastHovered: Element | null = null
  /** A click inside a selection, resolved on mouseup if no drag started */
  /** Where a character-granularity drag started, for word stickiness. */
  private dragAnchor: { block: Element; index: number } | null = null

  private pendingCollapse: { x: number; y: number; target: Element } | null =
    null

  private setup(): void {
    allowSelection(this.root, false)
    this.root.addEventListener('mousemove', this.handleMouseMove)
    this.root.addEventListener('mousedown', this.handleMouseDown)
    this.root.addEventListener('mouseup', this.handleMouseUp)
    this.root.addEventListener('mouseleave', this.handleMouseLeave)
    this.root.addEventListener('touchstart', this.handleTouchStart, {
      passive: false,
    })
    this.root.addEventListener('touchmove', this.handleTouchMove, {
      passive: false,
    })
    this.root.addEventListener('touchend', this.handleTouchEnd, {
      passive: false,
    })
  }

  destroy(): void {
    this.root.removeEventListener('mousemove', this.handleMouseMove)
    this.root.removeEventListener('mousedown', this.handleMouseDown)
    this.root.removeEventListener('mouseup', this.handleMouseUp)
    this.root.removeEventListener('mouseleave', this.handleMouseLeave)
    this.root.removeEventListener('touchstart', this.handleTouchStart)
    this.root.removeEventListener('touchmove', this.handleTouchMove)
    this.root.removeEventListener('touchend', this.handleTouchEnd)
  }

  private handleMouseMove = (evt: MouseEvent): void => {
    const target = evt.target as Element
    if (
      target.closest('.not-selectable') ||
      target.classList.contains('not-selectable')
    ) {
      return
    }

    // Despanify previous hover target's block if it's not selected
    if (this.lastHovered && this.lastHovered !== target) {
      const prevBlock = this.topLevelAncestor(this.lastHovered)
      const currBlock = this.topLevelAncestor(target)
      if (
        prevBlock &&
        prevBlock !== currBlock &&
        !prevBlock.classList.contains('selected-block')
      ) {
        spanify(prevBlock, false)
      }
    }

    // Hover no longer rewrites the document. Hit-testing is done by measuring
    // with a Range when it is actually needed, so moving the pointer across a
    // paragraph changes nothing — which is what made text jitter under it.
    if (target instanceof Element && target !== this.root) {
      this.lastHovered = target
    }

    // Extending a drag-selection is the same measurement problem as placing the
    // caret, so it uses the same answer. This used to require `target` to BE a
    // `.spanified` span, which only held because hover spanified everything the
    // pointer touched; once hover stopped rewriting the document that condition
    // was never true again and drag-selection silently stopped extending in
    // every language. Measure the character under the pointer instead.
    if (this.selecting) {
      const hit = characterAtPoint(this.root, evt.clientX, evt.clientY)
      const selEnd = this.find('.sel-end')
      if (hit && selEnd) {
        if (!this.extendSticky(hit)) {
          const range = document.createRange()
          range.setStart(hit.node, hit.after ? hit.offset + 1 : hit.offset)
          range.collapse(true)
          // insertNode MOVES selEnd: it is already in the document, so this
          // relocates the existing marker rather than cloning it.
          range.insertNode(selEnd)
          this.root.normalize()
        }
        this.extendSelection()
        this.onBoundsChanged?.()
      }
    }

    evt.preventDefault()
    evt.stopPropagation()
  }

  /**
   * Put the caret at the character nearest a point. Used when a click inside a
   * selection turns out not to be a drag, and to show the live drop position
   * while dragging — we own the caret, so the drop indicator IS the caret.
   */
  placeCaretAt(x: number, y: number): void {
    // Measured, not spanified: the old path rewrote the whole paragraph into
    // per-character spans just to read their rects, which moved line breaks and
    // (in engines that do not shape across inline boundaries) pulled cursive
    // scripts apart. A Range reports the same geometry read-only.
    const hit = characterAtPoint(this.root, x, y)
    if (!hit) return
    this.removeBounds()
    const range = document.createRange()
    range.setStart(hit.node, hit.after ? hit.offset + 1 : hit.offset)
    range.collapse(true)
    range.insertNode(this.createBounds())
    this.root.normalize()
    this.onBoundsChanged?.()
  }


  /**
   * The block's whole text, with the map back to the nodes that hold it.
   *
   * Segmenting one text node is not good enough: nodes are split by the bounds
   * markers and by inline elements, so a word is routinely spread across
   * several and segmenting a fragment finds the part of a word on one side of
   * a previous caret.
   */
  textIndexOf(block: Element): {
    text: string
    locate: (index: number) => { node: Text; offset: number } | null
    indexOf: (node: Text, offset: number) => number | null
  } {
    const parts: Array<{ node: Text; start: number }> = []
    let text = ''
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let current: Node | null
    while ((current = walker.nextNode())) {
      const textNode = current as Text
      parts.push({ node: textNode, start: text.length })
      text += textNode.data
    }
    return {
      text,
      locate: (index) => {
        for (let i = parts.length - 1; i >= 0; i--) {
          if (index >= parts[i].start) {
            return { node: parts[i].node, offset: index - parts[i].start }
          }
        }
        return null
      },
      indexOf: (node, offset) => {
        const part = parts.find((p) => p.node === node)
        return part ? part.start + offset : null
      },
    }
  }

  /**
   * Move BOTH bounds, snapped to word boundaries once the drag has left the
   * word it started in. Returns false when stickiness does not apply and the
   * caller should fall back to moving the end bound only.
   *
   * Only plain character drags are sticky. A double-click drag is already
   * word-granular by construction, and a drag that crosses into another block
   * falls back — the text index is per-block, and a selection spanning blocks
   * has bigger units than words anyway.
   */
  private extendSticky(hit: CharacterHit): boolean {
    const anchor = this.dragAnchor
    if (this.selecting !== 1 || !anchor) return false
    const block = this.topLevelAncestor(hit.node)
    if (!block || block !== anchor.block) return false

    const index = this.textIndexOf(block)
    const head = index.indexOf(
      hit.node,
      hit.after ? hit.offset + 1 : hit.offset
    )
    if (head === null) return false

    const { start, end } = stickySelectionBounds(index.text, anchor.index, head)
    const startPos = index.locate(start)
    const endPos = index.locate(end)
    if (!startPos || !endPos) return false

    const selStart = this.find('.sel-start')
    const selEnd = this.find('.sel-end')
    if (!selStart || !selEnd) return false

    // End first: inserting the start marker splits the text node and would
    // invalidate the later offset.
    const endRange = document.createRange()
    endRange.setStart(endPos.node, Math.min(endPos.offset, endPos.node.length))
    endRange.collapse(true)
    endRange.insertNode(selEnd)

    const startRange = document.createRange()
    startRange.setStart(
      startPos.node,
      Math.min(startPos.offset, startPos.node.length)
    )
    startRange.collapse(true)
    startRange.insertNode(selStart)

    this.root.normalize()
    return true
  }

  /** Put the bounds around the word containing an offset in a text node. */
  selectWordAt(node: Text, offset: number): void {
    const block = this.topLevelAncestor(node) || this.root
    const index = this.textIndexOf(block)
    const at = index.indexOf(node, offset)
    if (at === null) return

    const { start, end } = wordBoundsAt(index.text, at)
    const locate = index.locate
    const startPos = locate(start)
    const endPos = locate(end)
    if (!startPos || !endPos) return

    this.removeBounds()

    const startEl = document.createElement('span')
    startEl.className = 'sel-start'
    const endEl = document.createElement('span')
    endEl.className = 'sel-end caret'

    // End first: inserting the start marker splits the text node and would
    // invalidate the later offset.
    const endRange = document.createRange()
    endRange.setStart(endPos.node, Math.min(endPos.offset, endPos.node.length))
    endRange.collapse(true)
    endRange.insertNode(endEl)

    const startRange = document.createRange()
    startRange.setStart(
      startPos.node,
      Math.min(startPos.offset, startPos.node.length)
    )
    startRange.collapse(true)
    startRange.insertNode(startEl)

    this.onBoundsChanged?.()
  }

  private handleMouseDown = (evt: MouseEvent): void => {
    this.touchMode = false
    let target = evt.target as Element
    if (
      target.closest('.not-selectable') ||
      target.classList.contains('not-selectable')
    ) {
      return
    }

    // A mousedown inside an existing selection may be the start of a DRAG.
    // preventDefault() on mousedown suppresses the browser's drag initiation
    // entirely, so dragstart would never fire — and collapsing the selection
    // here would destroy the thing being dragged. Native editors defer both to
    // mouseup, which is also what makes click-inside-a-selection feel right.
    if (
      evt.detail === 1 &&
      !evt.shiftKey &&
      target.closest?.('.selected') &&
      !target.closest?.('.not-selectable')
    ) {
      this.pendingCollapse = { x: evt.clientX, y: evt.clientY, target }
      return
    }

    this.selecting = evt.detail // click count: 1=char, 2=word, 3=block

    // Where did the click land? Measured with a Range — no spanification, so
    // clicking does not reflow the paragraph it lands in.
    const hit = characterAtPoint(this.root, evt.clientX, evt.clientY)

    if (hit) {
      if (evt.shiftKey) {
        // Extend: move the end bound to the clicked character
        const selEnd = this.find('.sel-end')
        if (selEnd) {
          selEnd.remove()
          const range = document.createRange()
          range.setStart(hit.node, hit.after ? hit.offset + 1 : hit.offset)
          range.collapse(true)
          range.insertNode(selEnd)
          this.root.normalize()
          this.extendSelection()
        }
      } else if (this.selecting === 1) {
        // Remember where the drag began, so the move handler can tell whether
        // the pointer has left the anchor word yet.
        const block = this.topLevelAncestor(hit.node)
        this.dragAnchor = block
          ? {
              block,
              index:
                this.textIndexOf(block).indexOf(
                  hit.node,
                  hit.after ? hit.offset + 1 : hit.offset
                ) ?? 0,
            }
          : null
        this.placeCaretAt(evt.clientX, evt.clientY)
      } else if (this.selecting === 2) {
        // Double click selects a word. The boundaries come from segmenting the
        // TEXT, so the document is not rewritten to find them — spanifying the
        // block here left per-character spans in the DOM for as long as the
        // selection lived, and in engines that do not shape across inline
        // boundaries that visibly reflowed cursive scripts.
        this.selectWordAt(hit.node, hit.offset)
        this.extendSelection()
      } else {
        // Triple click selects the block, which extendSelection derives from
        // the caret's ancestry — no character-level structure needed.
        this.placeCaretAt(evt.clientX, evt.clientY)
        this.extendSelection()
      }
    } else if (
      target instanceof HTMLElement &&
      target.querySelectorAll('.spanified').length === 0 &&
      target !== this.root
    ) {
      // Clicked an empty element (e.g. empty table cell) — place caret inside it
      this.removeBounds()
      const bounds = this.createBounds()
      target.appendChild(bounds)
    }

    evt.preventDefault()
    evt.stopPropagation()
  }

  private handleMouseUp = (evt: MouseEvent): void => {
    // A click inside a selection that did NOT become a drag collapses it here
    const pending = this.pendingCollapse
    this.pendingCollapse = null
    if (pending) {
      const moved =
        Math.abs(evt.clientX - pending.x) + Math.abs(evt.clientY - pending.y)
      if (moved < 4) {
        this.unmark()
        this.selecting = 1
        this.placeCaretAt(pending.x, pending.y)
        this.selecting = false
        this.selectionChanged()
      }
      return
    }

    const target = evt.target as Element
    if (
      target.closest('.not-selectable') ||
      target.classList.contains('not-selectable')
    ) {
      return
    }

    if (this.selecting) {
      const mode = this.selecting
      this.extendSelection()
      // Word/block gestures grow the selection past the clicked character, but
      // the bounds markers stay where the click landed — which leaves the caret
      // blinking mid-word. Re-derive them from the marked range.
      // Character selection already ends with .sel-end under the pointer.
      if (mode !== 1) this.resetBounds()
      this.normalizeBoundsOrder()
      this.selecting = false
      this.dragAnchor = null
    }
    // Despanify non-selected blocks to clean up hover spanification
    for (const child of Array.from(this.root.children)) {
      if (!child.classList.contains('selected-block')) {
        spanify(child, false)
      }
    }
    this.lastHovered = null
    this.selectionChanged()

    evt.preventDefault()
    evt.stopPropagation()
  }

  private handleMouseLeave = (): void => {
    // Despanify the last hovered block when cursor leaves the doc
    if (this.lastHovered) {
      const block = this.topLevelAncestor(this.lastHovered)
      if (block && !block.classList.contains('selected-block')) {
        spanify(block, false)
      }
      this.lastHovered = null
    }
  }

  private handleTouchStart = (evt: TouchEvent): void => {
    if (evt.touches.length !== 1) return
    this.touchMode = true
    const touch = evt.touches[0]
    let target = evt.target as Element
    if (
      target.closest('.not-selectable') ||
      target.classList.contains('not-selectable')
    ) {
      return
    }

    this.selecting = 1

    // Measured, like the mouse path. This used to spanify the touched element
    // and hit-test the resulting spans, which rewrote the document on every
    // touch and left the spans behind.
    const hit = characterAtPoint(this.root, touch.clientX, touch.clientY)
    if (hit) {
      this.placeCaretAt(touch.clientX, touch.clientY)
    } else if (target instanceof HTMLElement && target !== this.root) {
      // Empty element (e.g. empty table cell)
      this.removeBounds()
      const bounds = this.createBounds()
      target.appendChild(bounds)
    }

    if (evt.cancelable) evt.preventDefault()
  }

  private handleTouchMove = (evt: TouchEvent): void => {
    if (!this.selecting || evt.touches.length !== 1) return
    const touch = evt.touches[0]
    const rootNode = this.root.getRootNode() as Document | ShadowRoot
    let target = (
      rootNode.elementFromPoint
        ? rootNode.elementFromPoint(touch.clientX, touch.clientY)
        : document.elementFromPoint(touch.clientX, touch.clientY)
    ) as Element | null
    if (
      !target ||
      target.closest('.not-selectable') ||
      target.classList.contains('not-selectable')
    ) {
      return
    }

    // Same measurement as a mouse drag: move the end bound to the character
    // under the finger. No spanification, so dragging a touch selection does
    // not reflow the text it is dragging across.
    const hit = characterAtPoint(this.root, touch.clientX, touch.clientY)
    const selEnd = this.find('.sel-end')
    if (hit && selEnd) {
      const range = document.createRange()
      range.setStart(hit.node, hit.after ? hit.offset + 1 : hit.offset)
      range.collapse(true)
      range.insertNode(selEnd)
      this.root.normalize()
      this.extendSelection()
      this.onBoundsChanged?.()
    }

    if (evt.cancelable) evt.preventDefault()
  }

  private handleTouchEnd = (evt: TouchEvent): void => {
    if (this.selecting) {
      this.extendSelection()
      this.normalizeBoundsOrder()
      this.selecting = false
    }
    // Despanify non-selected blocks
    for (const child of Array.from(this.root.children)) {
      if (!child.classList.contains('selected-block')) {
        spanify(child, false)
      }
    }
    this.lastHovered = null
    this.selectionChanged()
    if (evt.cancelable) evt.preventDefault()
  }

  /** Trigger selectionchanged event and focus the caret */
  selectionChanged(): void {
    this.focus()
    this.root.dispatchEvent(
      new CustomEvent('selectionchanged', { bubbles: true })
    )
  }

  /**
   * Set by the component. The markers in the text are inert spans — a replaced
   * element there breaks the shaping run, which is what tore Arabic words apart
   * around the caret — so the visible caret and the focusable element live
   * OUTSIDE the document, and this is how they learn the bounds moved.
   */
  onBoundsChanged?: () => void
  /** The focusable element that stands in for the caret */
  focusTarget?: HTMLElement

  focus(): void {
    this.focusTarget?.focus()
    this.onBoundsChanged?.()
  }

  /** Create a document fragment with sel-start and sel-end markers */
  createBounds(): DocumentFragment {
    const fragment = document.createDocumentFragment()
    const start = document.createElement('span')
    start.className = 'sel-start'
    const end = document.createElement('span')
    end.className = 'sel-end caret'
    fragment.appendChild(start)
    fragment.appendChild(end)
    return fragment
  }

  /**
   * Put the bound markers in TEXTUAL order.
   *
   * While a drag is in flight `.sel-end` is the moving bound and `.sel-start`
   * the anchor, so dragging backwards leaves the end marker earlier in the
   * document than the start. That is the right model for dragging but the wrong
   * one for painting: the edges are coloured by which marker they are, so a
   * backwards drag showed the colours swapped. Once the gesture is complete the
   * labels are re-assigned by document order, so start is always textually
   * first — and in RTL that means it paints on the right.
   */
  normalizeBoundsOrder(): void {
    const start = this.find('.sel-start')
    const end = this.find('.sel-end')
    if (!start || !end || start === end) return
    if (isBefore(start, end)) return
    start.className = 'sel-end caret'
    end.className = 'sel-start'
    this.onBoundsChanged?.()
  }

  /** Find an element within the root */
  find(selector: string): Element | null {
    return this.root.querySelector(selector)
  }

  /** Find all matching elements within the root */
  findAll(selector: string): Element[] {
    return Array.from(this.root.querySelectorAll(selector))
  }

  /** Mark the selection between the current bounds */
  markBounds(): void {
    const start = this.find('.sel-start')
    const end = this.find('.sel-end')
    if (start && end) {
      this.markRange(start, end)
    }
    this.onBoundsChanged?.()
  }

  /** Remove selection bound markers */
  removeBounds(): void {
    for (const el of this.findAll('.sel-start, .sel-end')) {
      el.remove()
    }
    this.onBoundsChanged?.()
  }

  /**
   * How many characters of `block`'s text precede `node`.
   *
   * The bounds markers hold no text, so this is a position the document's
   * STRUCTURE cannot invalidate — which is what makes it safe to hand to code
   * that is about to restructure the nodes.
   */
  private textOffsetOf(block: Element, node: Node): number {
    let total = 0
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let current: Node | null
    while ((current = walker.nextNode())) {
      if (
        node.compareDocumentPosition(current) &
        Node.DOCUMENT_POSITION_PRECEDING
      ) {
        total += (current as Text).data.length
      }
    }
    return total
  }

  /**
   * Run `fn` over a document whose text is NOT split by the bounds markers.
   *
   * The markers are real elements sitting between two characters, so they cut
   * the text node in half. Any code that walks text nodes and reads them as
   * LANGUAGE sees the halves: with the caret after `br` in `the brown fox`, a
   * plain `createTreeWalker` walk yields `the br` and `own fox`. A spell
   * checker asked about that flags `br`; a proofreader asked to rewrite it
   * gets two fragments, one ending mid-word, and rewrites them independently.
   *
   * This is not a rare state. There is no blur handler anywhere, so the marker
   * left behind by one click stays in the text indefinitely — and a caret
   * inside a word is the single commonest thing a caret does.
   *
   * Position is remembered as a LOGICAL OFFSET into the block's text rather
   * than as a node, because `fn` is expected to restructure the nodes (that is
   * usually the point of calling this). If `fn` changes the text itself, the
   * offset lands as close as the new text allows.
   *
   * Synchronous by design: holding the caret out of the document across an
   * `await` would make it vanish during a network call and lets a click add a
   * second pair of markers. Callers that need to await should suspend around
   * each synchronous phase and let no node reference cross the boundary.
   */
  withoutBounds<T>(fn: () => T): T {
    const markers = this.findAll('.sel-start, .sel-end') as HTMLElement[]
    if (markers.length === 0) return fn()

    const saved = markers.map((el) => {
      // `topLevelAncestor` answers the marker itself when it is already a
      // direct child of the root. Treat that as "the root is the container",
      // not as "no container" — otherwise the marker is dropped below.
      const found = this.topLevelAncestor(el)
      const container = !found || found === el ? this.root : found
      return {
        el,
        container,
        // Where to land if the block has no text to measure against. A
        // textless block is not exotic: backspacing the last character of a
        // paragraph leaves exactly that, and the empty-block sweep
        // deliberately KEEPS the block holding the caret.
        parent: el.parentNode,
        next: el.nextSibling,
        offset: this.textOffsetOf(container, el),
      }
    })
    for (const { el } of saved) el.remove()
    this.normalize()

    try {
      return fn()
    } finally {
      // A `finally` whose whole job is to put view state back MUST have no
      // path that drops it. Losing the caret here means the editor stops
      // accepting input — and the entry point that calls this
      // (`checkSpelling`) is one the host invokes on blur or before submit,
      // so the failure surfaces inside the host's app as a dead editor.
      for (const { el, container, parent, next, offset } of saved) {
        // Recompute per marker: putting the first one back splits a text node
        // and invalidates any index taken before it.
        const pos = container.isConnected
          ? this.textIndexOf(container).locate(offset)
          : null
        if (pos) {
          const range = document.createRange()
          range.setStart(pos.node, Math.min(pos.offset, pos.node.length))
          range.collapse(true)
          range.insertNode(el)
          continue
        }
        // No text node to locate against. Fall back, in order of fidelity:
        // exactly where it was, then the end of its container, then the root.
        if (parent?.isConnected && (!next || next.parentNode === parent)) {
          parent.insertBefore(el, next)
        } else if (container.isConnected) {
          container.appendChild(el)
        } else {
          this.root.appendChild(el)
        }
      }
      this.normalize()
      this.onBoundsChanged?.()
    }
  }

  /** Restore bounds to match the current .selected elements */
  resetBounds(): this {
    const selected = this.findAll('.selected')
    if (selected.length === 0) return this

    this.removeBounds()

    const startMarker = document.createElement('span')
    startMarker.className = 'sel-start'
    const endMarker = document.createElement('span')
    endMarker.className = 'sel-end caret'

    const firstSelected = selected[0]
    const lastSelected = selected[selected.length - 1]

    const firstLeaf = firstLeafNode(firstSelected)
    const lastLeaf = lastLeafNode(lastSelected)

    firstLeaf.parentNode?.insertBefore(startMarker, firstLeaf)
    lastLeaf.parentNode?.insertBefore(endMarker, lastLeaf.nextSibling)

    this.onBoundsChanged?.()
    return this
  }

  /** Extend the selection based on the current click mode */
  extendSelection(): void {
    const startEl = this.find('.sel-start')
    const endEl = this.find('.sel-end')
    if (!startEl || !endEl) return

    let first: Element = startEl
    let last: Element = endEl

    switch (this.selecting) {
      case 1:
        // Character selection — bounds are already in place
        break
      case 2:
        // Word selection — expand to word boundaries
        if (first.closest('.spanified-word')) {
          first = first.closest('.spanified-word')!
        }
        if (last.closest('.spanified-word')) {
          last = last.closest('.spanified-word')!
        }
        break
      default:
        // Block selection — expand to block boundaries
        first = this.topLevelAncestor(first) || first
        last = this.topLevelAncestor(last) || last
        break
    }

    this.markRange(first, last)
    this.onBoundsChanged?.()
  }

  /** Get the top-level child of root that contains `node` */
  private topLevelAncestor(node: Node): Element | null {
    let current: Node | null = node
    while (current && current.parentNode !== this.root) {
      current = current.parentNode
    }
    return current instanceof Element ? current : null
  }

  /** Clear all selection markers */
  unmark(): void {
    for (const el of this.findAll('.selected')) {
      el.classList.remove('selected')
      el.removeAttribute('draggable')
      el.removeAttribute('data-drag')
      if (
        el instanceof HTMLElement &&
        el.classList.length === 0 &&
        el.getAttribute('class') !== null
      ) {
        el.removeAttribute('class')
      }
    }
    // Unwrap spans that have no attributes
    for (const span of this.findAll('span')) {
      if (span.attributes.length === 0) {
        const parent = span.parentNode
        if (parent) {
          while (span.firstChild) {
            parent.insertBefore(span.firstChild, span)
          }
          parent.removeChild(span)
        }
      }
    }
    for (const el of this.findAll('.selected-block')) {
      el.classList.remove('selected-block')
    }
    for (const el of this.findAll('.first-block')) {
      el.classList.remove('first-block')
    }
    for (const el of this.findAll('.last-block')) {
      el.classList.remove('last-block')
    }
  }

  /** Check if a node is a direct child of root (a "block") */
  isBlock(node: Node): boolean {
    return node.parentNode === this.root
  }

  /** Mark a range of elements as selected */
  markRange(first: Element, last: Element): void {
    if (!first) return
    if (!last) last = first

    // Ensure correct order
    if (!isBefore(first, last) && first !== last) {
      const temp = last
      last = first
      first = temp
    }

    this.unmark()

    // Find top-level blocks
    const firstBlock = this.isBlock(first)
      ? first
      : this.topLevelAncestor(first)
    const lastBlock = this.isBlock(last) ? last : this.topLevelAncestor(last)

    if (!firstBlock || !lastBlock) return

    firstBlock.classList.add('first-block')
    lastBlock.classList.add('last-block')

    // Mark block range
    const blocks: Element[] = [firstBlock]
    if (firstBlock !== lastBlock) {
      let current = firstBlock.nextElementSibling
      while (current && current !== lastBlock) {
        blocks.push(current)
        current = current.nextElementSibling
      }
      blocks.push(lastBlock)
    }
    for (const block of blocks) {
      block.classList.add('selected-block')
    }

    // Despanify non-selected blocks
    for (const child of Array.from(this.root.children)) {
      if (!child.classList.contains('selected-block')) {
        spanify(child, false)
      }
    }

    // Mark selected leaf nodes
    let firstNode: Node | null =
      first.classList.contains('sel-start') ||
      first.classList.contains('sel-end')
        ? nextLeafNode(first, this.root)
        : firstLeafNode(first)
    let lastNode: Node | null =
      last.classList.contains('sel-start') || last.classList.contains('sel-end')
        ? previousLeafNode(last, this.root)
        : lastLeafNode(last)

    if (!firstNode || !lastNode) return

    // Collect all leaf nodes in selected blocks
    const allLeaves: Node[] = []
    for (const block of blocks) {
      allLeaves.push(...leafNodes(block))
    }

    const firstIdx = allLeaves.indexOf(firstNode)
    const lastIdx = allLeaves.indexOf(lastNode)

    if (firstIdx < 0 || lastIdx < 0) return

    for (let i = firstIdx; i <= lastIdx; i++) {
      this.markNode(allLeaves[i])
    }
  }

  /** The representations a dragged selection offers */
  static DRAG_TYPES = 'text/html;text/plain'

  /** Make a selected element a draggable object */
  private makeDraggable(el: Element): void {
    el.setAttribute('draggable', 'true')
    el.setAttribute('data-drag', Selectable.DRAG_TYPES)
  }

  /** Mark a single node as selected */
  private markNode(node: Node): void {
    if (node.nodeType === 3) {
      // Text node
      const parent = node.parentNode
      if (parent && (parent as Element).childNodes.length === 1) {
        // Only child — mark the parent
        ;(parent as Element).classList.add('selected')
        this.makeDraggable(parent as Element)
      } else if (parent) {
        // Wrap in a span
        const span = document.createElement('span')
        span.className = 'selected'
        parent.insertBefore(span, node)
        span.appendChild(node)
        this.makeDraggable(span)
      }
    } else if (node instanceof Element) {
      if (
        !node.classList.contains('sel-start') &&
        !node.classList.contains('sel-end')
      ) {
        node.classList.add('selected')
        this.makeDraggable(node)
      }
    }
  }

  /** Despanify all non-selected blocks */
  despanify(): void {
    for (const child of Array.from(this.root.children)) {
      if (!child.classList.contains('selected-block')) {
        spanify(child, false)
      }
    }
    this.lastHovered = null
  }

  normalize(): this {
    const root = this.root
    for (let i = root.childNodes.length - 1; i >= 0; i--) {
      const child = root.childNodes[i]
      if (child.nodeType === 3 && /^\s*$/.test(child.textContent || '')) {
        root.removeChild(child)
      }
    }
    // Strip whitespace text nodes from grid tables — they become grid items and break layout
    for (const table of Array.from(root.querySelectorAll('.editor-table'))) {
      for (let i = table.childNodes.length - 1; i >= 0; i--) {
        const child = table.childNodes[i]
        if (child.nodeType === 3) {
          table.removeChild(child)
        }
      }
    }
    root.normalize()
    return this
  }
}

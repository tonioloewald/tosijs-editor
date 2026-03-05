/**
 * Selection management for tosi-editable.
 *
 * Replaces browser selection behavior entirely. Selections are tracked
 * using marker elements (.sel-start, .sel-end) and the .selected class.
 *
 * Key concept: "spanification" — wrapping each character (or word) in a
 * <span> so we can determine exact screen positions without browser
 * selection APIs.
 */

import {
  firstLeafNode,
  lastLeafNode,
  nextLeafNode,
  previousLeafNode,
  leafNodes,
  isBefore,
  allowSelection,
} from './dom-utils'

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
        pieces = text.split('')
      }

      if (pieces.length <= 1 && text.length <= 1) continue

      const parent = textNode.parentNode
      if (!parent) continue

      // Remove spanified class from parent if it has it
      if (parent instanceof Element) {
        parent.classList.remove('spanified')
      }

      const fragment = document.createDocumentFragment()
      for (const piece of pieces) {
        if (piece.length > 1) {
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

  constructor(root: HTMLElement) {
    this.root = root
    this.setup()
  }

  private lastHovered: Element | null = null

  private setup(): void {
    allowSelection(this.root, false)
    this.root.addEventListener('mousemove', this.handleMouseMove)
    this.root.addEventListener('mousedown', this.handleMouseDown)
    this.root.addEventListener('mouseup', this.handleMouseUp)
    this.root.addEventListener('mouseleave', this.handleMouseLeave)
  }

  destroy(): void {
    this.root.removeEventListener('mousemove', this.handleMouseMove)
    this.root.removeEventListener('mousedown', this.handleMouseDown)
    this.root.removeEventListener('mouseup', this.handleMouseUp)
    this.root.removeEventListener('mouseleave', this.handleMouseLeave)
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

    // Spanify on hover so mousedown can pinpoint exact position
    // But never spanify the root itself — only its descendants
    if (target instanceof Element && target !== this.root) {
      spanify(target, true, true)
      this.lastHovered = target
    }

    if (this.selecting && target.classList.contains('spanified')) {
      const rect = target.getBoundingClientRect()
      const selEnd = this.find('.sel-end')
      if (selEnd) {
        if (evt.clientX - rect.left < rect.width / 2) {
          target.before(selEnd)
        } else {
          target.after(selEnd)
        }
        this.extendSelection()
      }
    }

    evt.preventDefault()
    evt.stopPropagation()
  }

  private handleMouseDown = (evt: MouseEvent): void => {
    let target = evt.target as Element
    if (
      target.closest('.not-selectable') ||
      target.classList.contains('not-selectable')
    ) {
      return
    }

    this.selecting = evt.detail // click count: 1=char, 2=word, 3=block

    // Spanify if not already (e.g. fast click before mousemove fires)
    if (!target.classList.contains('spanified') && target instanceof Element) {
      spanify(target, true, true)
      // target was a container — find the spanified char at click position
      for (const span of Array.from(target.querySelectorAll('.spanified'))) {
        const r = span.getBoundingClientRect()
        if (
          evt.clientX >= r.left &&
          evt.clientX <= r.right &&
          evt.clientY >= r.top &&
          evt.clientY <= r.bottom
        ) {
          target = span
          break
        }
      }
    }

    if (target.classList.contains('spanified')) {
      const rect = target.getBoundingClientRect()
      if (evt.shiftKey) {
        // Extend selection
        const selEnd = this.find('.sel-end')
        if (selEnd) {
          if (evt.clientX - rect.left < rect.width / 2) {
            target.before(selEnd)
          } else {
            target.after(selEnd)
          }
          this.extendSelection()
        }
      } else if (this.selecting === 1) {
        // Begin new selection
        this.removeBounds()
        const bounds = this.createBounds()
        if (evt.clientX - rect.left < rect.width / 2) {
          target.before(bounds)
        } else {
          target.after(bounds)
        }
      } else {
        // Double/triple click — extend selection mode
        this.extendSelection()
      }
    }

    evt.preventDefault()
    evt.stopPropagation()
  }

  private handleMouseUp = (evt: MouseEvent): void => {
    const target = evt.target as Element
    if (
      target.closest('.not-selectable') ||
      target.classList.contains('not-selectable')
    ) {
      return
    }

    if (this.selecting) {
      this.extendSelection()
      this.selecting = false
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

  /** Trigger selectionchanged event and focus the caret */
  selectionChanged(): void {
    this.focus()
    this.root.dispatchEvent(
      new CustomEvent('selectionchanged', { bubbles: true }),
    )
  }

  /** Focus the caret input */
  focus(): void {
    const caret = this.find('.caret') as HTMLInputElement | null
    if (caret) caret.focus()
  }

  /** Create a document fragment with sel-start and sel-end markers */
  createBounds(): DocumentFragment {
    const fragment = document.createDocumentFragment()
    const start = document.createElement('input')
    start.className = 'sel-start'
    const end = document.createElement('input')
    end.className = 'sel-end caret'
    fragment.appendChild(start)
    fragment.appendChild(end)
    return fragment
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
  }

  /** Remove selection bound markers */
  removeBounds(): void {
    for (const el of this.findAll('.sel-start, .sel-end')) {
      el.remove()
    }
  }

  /** Restore bounds to match the current .selected elements */
  resetBounds(): this {
    const selected = this.findAll('.selected')
    if (selected.length === 0) return this

    this.removeBounds()

    const startMarker = document.createElement('input')
    startMarker.className = 'sel-start'
    const endMarker = document.createElement('input')
    endMarker.className = 'sel-end caret'

    const firstSelected = selected[0]
    const lastSelected = selected[selected.length - 1]

    const firstLeaf = firstLeafNode(firstSelected)
    const lastLeaf = lastLeafNode(lastSelected)

    firstLeaf.parentNode?.insertBefore(startMarker, firstLeaf)
    lastLeaf.parentNode?.insertBefore(endMarker, lastLeaf.nextSibling)

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

  /** Mark a single node as selected */
  private markNode(node: Node): void {
    if (node.nodeType === 3) {
      // Text node
      const parent = node.parentNode
      if (parent && (parent as Element).childNodes.length === 1) {
        // Only child — mark the parent
        ;(parent as Element).classList.add('selected')
      } else if (parent) {
        // Wrap in a span
        const span = document.createElement('span')
        span.className = 'selected'
        parent.insertBefore(span, node)
        span.appendChild(node)
      }
    } else if (node instanceof Element) {
      if (
        !node.classList.contains('sel-start') &&
        !node.classList.contains('sel-end')
      ) {
        node.classList.add('selected')
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
    root.normalize()
    return this
  }
}

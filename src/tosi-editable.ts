/*#
# tosi-editable

`<tosi-editable>` is a rich text editor web component that **does not use**
`contentEditable`, `execCommand`, or browser selection/range APIs.

Instead, it manages selection and editing entirely through DOM manipulation,
giving full control over editing behavior.

## Usage

```html
<tosi-editable widgets="default">
  <p>Edit this text!</p>
  <p>It supports <b>bold</b>, <i>italic</i>, and more.</p>
</tosi-editable>
```
```css
tosi-editable {
  background: white;
  border: 1px solid #ccc;
  min-height: 200px;
}
tosi-editable [part="toolbar"] {
  background: #f8f8f8;
  border-bottom: 1px solid #ccc;
}
```

## How It Works

The editor uses three layers:

1. **DOM utilities** — leaf-node traversal (every operation works with text nodes)
2. **Selection** — custom selection via "spanification" (wrapping chars in spans)
3. **Commands** — extensible command system for formatting

The caret is an actual `<input>` element, which means mobile browsers
will show their keyboard automatically.

## Commands

Commands are invoked via `doCommand(commandString)`:

- `setText font-weight bold` — style selected characters
- `setBlockType h1` — change block type
- `setBlocks text-align center` — style selected blocks
- `updateUndo undo` / `updateUndo redo` — undo/redo

Multiple commands can be chained with semicolons:
`setText font-weight bold; setText font-style italic`
*/

import {
  Component as WebComponent,
  ElementCreator,
  PartsMap,
  elements,
  type XinStyleSheet,
} from 'tosijs'
import { Selectable, spanify } from './selection'
import { commands, executeCommand, type EditableContext } from './commands'
import {
  firstLeafNode,
  nextLeafNode,
  previousLeafNode,
  leafNodes,
  topSingleParentAncestor,
} from './dom-utils'
import {
  cellOf,
  tableOf,
  nextCell,
  prevCell,
  cellBelow,
  cellAbove,
  getColumnCount,
  getColumnWidths,
  setColumnWidths,
  getCellsInRow,
  getRowCount,
  rowOfCell,
  colOfCell,
  createCell,
  isHeaderCell,
} from './table-utils'

const { slot, div } = elements

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,pre,blockquote,p,div,ul,ol,th,td'

function deletableFilter(node: Node): boolean {
  if (node instanceof Element) {
    return (
      !node.classList.contains('sel-start') &&
      !node.classList.contains('sel-end')
    )
  }
  return node.nodeType !== 3 || node.textContent !== ''
}

function whitespaceFilter(node: Node): boolean {
  return node.nodeType === 3 && /\s/.test(node.textContent || '')
}

interface EditableParts extends PartsMap {
  menubar: HTMLElement
  toolbar: HTMLElement
  doc: HTMLElement
}

export class TosiEditable extends WebComponent<EditableParts> {
  static formAssociated = true

  static initAttributes = {
    widgets: 'none' as 'none' | 'minimal' | 'default',
    name: '',
    required: false,
  }

  static styleSpec: XinStyleSheet = {
    ':host': {
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
    },
    ':host ::slotted(*)': {
      flex: '0 0 auto',
    },
    ':host [part="menubar"]': {
      padding: '2px 4px',
      display: 'flex',
      gap: '2px',
      flex: '0 0 auto',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    ':host [part="toolbar"]': {
      padding: '2px 4px',
      display: 'flex',
      gap: '2px',
      flex: '0 0 auto',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    ':host [part="doc"]': {
      flex: '1 1 auto',
      padding: '8px',
      cursor: 'text',
      overflowY: 'auto',
    },
    // Blocks inside doc
    ':host [part="doc"] > *': {
      position: 'relative',
      padding: '4px 8px',
      margin: '0',
    },
    ':host [part="doc"] > blockquote': {
      padding: '4px 40px',
    },
    // Selection bounds — inline-block with negative margins to avoid displacing text
    ':host .caret, :host .sel-start, :host .sel-end': {
      display: 'inline-block',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      width: '2px',
      border: '0',
      padding: '0',
      marginLeft: '-1px',
      marginRight: '-1px',
      marginBottom: '-4px',
      marginTop: '-6px',
      background: 'black',
    },
    ':host .sel-start': {
      minHeight: '6px',
      background: 'green',
    },
    ':host .sel-end': {
      minHeight: '6px',
      background: 'red',
    },
    // Blinking caret
    ':host .caret': {
      animation: 'blink 1s steps(2, start) infinite',
    },
    ':host .caret:focus': {
      outline: 'none',
    },
    '@keyframes blink': {
      to: {
        background: 'transparent',
      },
    },
    // Selected text
    ':host .selected, :host .selected-unwrap': {
      background: 'rgba(0,0,255,0.3)',
    },
    // Selected blocks
    ':host .selected-block': {
      background: '#ddf',
    },
    ':host .first-block': {
      position: 'relative',
    },
    ':host .last-block': {
      position: 'relative',
    },
    // Spanified characters in debug mode — inset box-shadow to visualize spans
    '.debug .spanified': {
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
    },
    // Word spans — inline to avoid disrupting line height
    ':host .spanified-word': {
      display: 'inline',
    },
    // Annotations
    ':host .annotation::after': {
      position: 'relative',
      top: '-4px',
      content: '"\\2020"',
    },
    ':host .annotation > span': {
      display: 'block',
      padding: '4px 8px',
      fontWeight: 'normal',
      fontStyle: 'normal',
      fontSize: '12px',
      background: '#ffc',
      position: 'absolute',
      right: '0',
      maxWidth: '200px',
    },
    // User-select disabled on doc
    ':host [part="doc"] *': {
      userSelect: 'none',
      webkitUserSelect: 'none',
    },
    // Lists
    ':host ul, :host ol': {
      paddingLeft: '30px',
    },
    // Debug mode — sel-start/end visible, selected blocks outlined
    '.debug .sel-start': {
      background: 'green',
      opacity: '0.5',
      width: '2px',
      minHeight: '1em',
      display: 'inline-block',
    },
    '.debug .sel-end': {
      background: 'red',
      opacity: '0.5',
      width: '2px',
      minHeight: '1em',
      display: 'inline-block',
    },
    '.debug .selected-block': {
      outline: '1px dashed blue',
    },
    // Grid-based tables
    ':host .editor-table': {
      display: 'grid',
      listStyle: 'none',
      padding: '0',
      margin: '8px 0',
      border: '1px solid #ccc',
      borderRadius: '2px',
    },
    ':host .editor-table > li': {
      padding: '4px 8px',
      borderRight: '1px solid #ddd',
      borderBottom: '1px solid #ddd',
      minHeight: '1.5em',
      outline: 'none',
    },
    ':host .editor-table > li.table-header': {
      fontWeight: 'bold',
      background: '#f0f0f0',
    },
  }

  selectable!: Selectable
  active = true
  pastemode: 'merge' | 'remove' | 'preserve' | 'paragraphs' = 'merge'

  private undo: string[] = []
  private undoDepth = 0
  private reasonForLastUndo?: string
  private lastKey = 0
  private lastCursorX = 0
  private isInitialized = false

  // Column resize state
  private resizeTable: HTMLElement | null = null
  private resizeCol = -1
  private resizeStartX = 0
  private resizeStartWidths: number[] = []

  private _value = ''

  get value(): string {
    return this.isInitialized ? this.parts.doc.innerHTML : this._value
  }

  set value(html: string) {
    const oldValue = this._value
    this._value = html
    if (this.isInitialized && this.parts.doc.innerHTML !== html) {
      this.parts.doc.innerHTML = html
    }
    if (oldValue !== html && this.internals) {
      this.internals.setFormValue(html)
    }
  }

  /** The editable commands — extend this object to add custom commands */
  commands = { ...commands }

  content = [
    slot({
      name: 'menubar',
      part: 'menubar',
    }),
    slot({
      name: 'toolbar',
      part: 'toolbar',
    }),
    div({
      part: 'doc',
      tabindex: '0',
    }),
  ]

  formResetCallback() {
    this.value = ''
  }

  connectedCallback(): void {
    super.connectedCallback()

    const { doc } = this.parts

    // Initialize doc content from: 1) pre-set value, 2) light DOM children
    if (doc.innerHTML === '') {
      if (this._value.trim() !== '') {
        doc.innerHTML = this._value
      } else {
        // Gather non-slotted light DOM children (those without a slot attribute)
        const lightChildren = Array.from(this.childNodes).filter(
          (n) => !(n instanceof Element && n.hasAttribute('slot')),
        )
        if (lightChildren.length > 0) {
          const frag = document.createDocumentFragment()
          for (const child of lightChildren) {
            frag.appendChild(child)
          }
          doc.appendChild(frag)
        }
      }
    }

    this.isInitialized = true

    // Set up selection system
    this.selectable = new Selectable(doc)

    // Add initial bounds
    const firstP =
      doc.querySelector('p,h1,h2,h3,h4,h5,h6,div,blockquote,pre') ||
      doc.firstElementChild
    if (firstP) {
      firstP.appendChild(this.selectable.createBounds())
    }
    this.selectable.normalize()

    // Keyboard events — capture phase so we get Tab before the browser moves focus
    doc.addEventListener('keydown', this.handleKeydown, true)
    doc.addEventListener('keypress', this.handleKeypress)

    // Clipboard events
    doc.addEventListener('copy', this.handleCopy)
    doc.addEventListener('cut', this.handleCut)
    doc.addEventListener('paste', this.handlePaste)

    // Column resize events
    doc.addEventListener('pointerdown', this.handleResizePointerDown)
    doc.addEventListener('pointermove', this.handleResizePointerMove)
    doc.addEventListener('pointerup', this.handleResizePointerUp)

    // Selection change updates undo
    doc.addEventListener('selectionchanged', () => {
      this.updateUndo('new', 'selectionchanged')
    })

    // Toolbar button events — listen on host since buttons are slotted light DOM
    this.addEventListener('click', this.handleToolbarClick)
    this.addEventListener('change', this.handleToolbarChange)

    // Initialize undo
    this.updateUndo('init')
    this.focus()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.selectable?.destroy()
  }

  /** Get the editing context for commands */
  private getContext(): EditableContext {
    return {
      root: this.parts.doc,
      selectable: this.selectable,
      find: (sel) => this.parts.doc.querySelector(sel),
      findAll: (sel) => Array.from(this.parts.doc.querySelectorAll(sel)),
      selectedLeafNodes: () => this.selectedLeafNodes(),
      selectedBlocks: () => this.selectedBlocks(),
      insertionPoint: () => this.insertionPoint(),
      block: (node) => this.block(node),
      normalize: () => this.normalize(),
      focus: () => this.focus(),
      updateUndo: (cmd, reason) => this.updateUndo(cmd, reason),
    }
  }

  /** Execute a command string */
  doCommand(commandString: string): void {
    executeCommand(this.getContext(), commandString)
  }

  focus(): void {
    this.selectable?.focus()
  }

  normalize(): void {
    this.selectable?.normalize()
  }

  /** Get all leaf nodes in the current selection */
  selectedLeafNodes(): Node[] {
    return leafNodes(this.parts.doc).filter((node) => {
      const parent = node.parentElement
      return parent?.closest('.selected') !== null
    })
  }

  /** Get the selected blocks */
  selectedBlocks(): Element[] {
    return Array.from(this.parts.doc.querySelectorAll('.selected-block'))
  }

  /** Get the caret input if it exists in the doc */
  insertionPoint(): HTMLInputElement | null {
    return this.parts.doc.querySelector('input.caret')
  }

  /** Get the top-level block containing a node */
  block(node: Node): Element | null {
    let current: Node | null = node
    while (current && current.parentNode !== this.parts.doc) {
      current = current.parentNode
    }
    return current instanceof Element ? current : null
  }

  /** Find the table cell containing the caret, if any */
  private caretCell(): HTMLElement | null {
    const ip = this.insertionPoint()
    return ip ? cellOf(ip) : null
  }

  /** Find the list item (<li> in a non-table <ul>/<ol>) containing a node, or null */
  private listItemOf(node: Node): HTMLElement | null {
    let current: Node | null = node
    while (current && current !== this.parts.doc) {
      if (
        current instanceof Element &&
        current.tagName === 'LI' &&
        current.parentElement &&
        (current.parentElement.tagName === 'UL' || current.parentElement.tagName === 'OL') &&
        !current.parentElement.classList.contains('editor-table')
      ) {
        return current as HTMLElement
      }
      current = current.parentNode
    }
    return null
  }

  /** Move the caret (bounds) into a cell, selecting all content */
  private moveCaretToCell(cell: HTMLElement): void {
    this.selectable.unmark()
    this.selectable.removeBounds()
    const start = document.createElement('input')
    start.className = 'sel-start'
    const end = document.createElement('input')
    end.className = 'sel-end caret'
    cell.insertBefore(start, cell.firstChild)
    cell.appendChild(end)
    this.selectable.normalize()
    this.selectable.markBounds()
    this.selectable.selectionChanged()
  }

  /** Insert a new row above the current cell and move caret into it */
  private tableMoveUp(cell: HTMLElement): void {
    const table = tableOf(cell)
    if (!table) return
    const colCount = getColumnCount(table)
    const row = rowOfCell(cell, colCount)
    const rowCells = getCellsInRow(table, row, colCount)
    const firstRowCell = rowCells[0]
    for (let c = 0; c < colCount; c++) {
      firstRowCell.before(createCell())
    }
    const newAbove = cellAbove(cell)
    if (newAbove) this.moveCaretToCell(newAbove)
    this.updateUndo('new')
  }

  /** Insert a new row below the current cell and move caret into it */
  private tableMoveDown(cell: HTMLElement): void {
    const table = tableOf(cell)
    if (!table) return
    const colCount = getColumnCount(table)
    const row = rowOfCell(cell, colCount)
    const rowCells = getCellsInRow(table, row, colCount)
    const lastRowCell = rowCells[rowCells.length - 1]
    for (let c = 0; c < colCount; c++) {
      lastRowCell.after(createCell())
    }
    const newBelow = cellBelow(cell)
    if (newBelow) this.moveCaretToCell(newBelow)
    this.updateUndo('new')
  }

  /** Exit the table, placing the caret in the block before or after it */
  private exitTable(cell: HTMLElement, direction: 'before' | 'after'): void {
    const table = tableOf(cell)
    if (!table) return
    const tableBlock = this.block(table)
    if (!tableBlock) return

    const sibling =
      direction === 'before'
        ? tableBlock.previousElementSibling
        : tableBlock.nextElementSibling

    if (sibling) {
      this.selectable.unmark()
      this.selectable.removeBounds()
      if (direction === 'before') {
        sibling.appendChild(this.selectable.createBounds())
      } else {
        sibling.insertBefore(this.selectable.createBounds(), sibling.firstChild)
      }
      this.selectable.normalize()
      this.selectable.markBounds()
      this.selectable.selectionChanged()
    } else {
      // No sibling — create a new paragraph
      const p = document.createElement('p')
      p.textContent = '\u00A0'
      if (direction === 'before') {
        tableBlock.before(p)
      } else {
        tableBlock.after(p)
      }
      this.selectable.unmark()
      this.selectable.removeBounds()
      p.appendChild(this.selectable.createBounds())
      this.selectable.normalize()
      this.selectable.markBounds()
      this.selectable.selectionChanged()
      this.updateUndo('new')
    }
  }

  /** Split a list item at the caret, creating a new <li> after it.
   *  If the item is empty, exit the list instead (convert to <p>). */
  private splitListItem(li: HTMLElement): void {
    const ip = this.insertionPoint()
    if (!ip) return

    const list = li.parentElement
    if (!list) return

    // If the <li> is empty (just whitespace/nbsp), exit the list
    const textContent = li.textContent?.replace(/\u00A0/g, '').trim()
    if (!textContent) {
      // Convert this <li> to a <p> after the list
      const p = document.createElement('p')
      p.textContent = '\u00A0'
      // Move bounds into the new paragraph
      this.selectable.removeBounds()
      p.appendChild(this.selectable.createBounds())

      // If this is the only <li>, remove the entire list
      if (list.children.length <= 1) {
        list.after(p)
        list.remove()
      } else if (!li.previousElementSibling) {
        // First item — put <p> before the list
        list.before(p)
        li.remove()
      } else if (!li.nextElementSibling) {
        // Last item — put <p> after the list
        list.after(p)
        li.remove()
      } else {
        // Middle item — split the list in two
        const newList = document.createElement(list.tagName)
        let sibling = li.nextElementSibling
        while (sibling) {
          const next = sibling.nextElementSibling
          newList.appendChild(sibling)
          sibling = next
        }
        list.after(p)
        p.after(newList)
        li.remove()
      }

      this.selectable.normalize()
      this.selectable.markBounds()
      this.updateUndo('new')
      return
    }

    // Split the <li>: create a new <li> and move content after the caret into it
    const newLi = document.createElement('li')
    let node: Node | null = ip.nextSibling
    while (node) {
      const next: Node | null = node.nextSibling
      newLi.appendChild(node)
      node = next
    }

    // Move the caret markers into the new <li>
    const selStart = li.querySelector('.sel-start')
    const selEnd = li.querySelector('.sel-end')
    if (selEnd) newLi.insertBefore(selEnd, newLi.firstChild)
    if (selStart) newLi.insertBefore(selStart, newLi.firstChild)

    // Ensure neither <li> is empty
    if (!newLi.textContent?.trim()) {
      const placeholder = document.createTextNode('\u00A0')
      if (selStart) selStart.before(placeholder)
      else newLi.appendChild(placeholder)
    }
    if (!li.textContent?.trim()) {
      li.appendChild(document.createTextNode('\u00A0'))
    }

    li.after(newLi)
    this.selectable.markBounds()
    this.updateUndo('new')
  }

  /** Check if a list item is effectively empty (only whitespace/nbsp/bounds) */
  private isListItemEmpty(li: HTMLElement): boolean {
    return !li.textContent?.replace(/\u00A0/g, '').trim()
  }

  /** Remove a list item, merging with previous <li> or exiting the list */
  private removeListItem(li: HTMLElement): void {
    const list = li.parentElement
    if (!list) return

    const prevLi = li.previousElementSibling
    if (prevLi && prevLi.tagName === 'LI') {
      // Merge this <li>'s content into the previous <li>
      while (li.firstChild) {
        prevLi.appendChild(li.firstChild)
      }
      li.remove()
    } else {
      // First <li> — convert to <p> before the list
      const p = document.createElement('p')
      while (li.firstChild) {
        p.appendChild(li.firstChild)
      }
      list.before(p)
      li.remove()
      if (list.children.length === 0) {
        list.remove()
      }
    }
    this.normalize()
    this.selectable.markBounds()
    this.updateUndo('new')
  }

  /** Backspace inside a list item: delete within the <li>, or merge with previous <li> */
  private listBackspace(li: HTMLElement): void {
    if (!this.deleteSelection()) {
      const ip = this.insertionPoint()
      if (!ip) return

      // If item is empty, remove it immediately
      if (this.isListItemEmpty(li)) {
        this.removeListItem(li)
        return
      }

      const prev = previousLeafNode(ip, li, deletableFilter)
      if (prev) {
        // There's content before the caret in this <li> — delete it normally
        if (prev.nodeType === 3 && (prev.textContent || '').length > 1) {
          prev.textContent = prev.textContent!.slice(0, -1)
        } else {
          const top = topSingleParentAncestor(prev)
          if (li.contains(top)) {
            top.parentNode?.removeChild(top)
          }
        }
        this.normalize()
        this.updateUndo()
      } else {
        // At start of <li> — merge with previous <li> or exit list
        this.removeListItem(li)
      }
    }
  }

  /** Forward delete inside a list item: delete within the <li>, or merge with next <li> */
  private listForwardDelete(li: HTMLElement): void {
    if (!this.deleteSelection()) {
      const ip = this.insertionPoint()
      if (!ip) return

      const next = nextLeafNode(ip, li, deletableFilter)
      if (next) {
        // There's content after the caret in this <li> — delete it normally
        if (next.nodeType === 3 && (next.textContent || '').length > 1) {
          next.textContent = next.textContent!.slice(1)
        } else {
          const top = topSingleParentAncestor(next)
          if (li.contains(top)) {
            top.parentNode?.removeChild(top)
          }
        }
        this.normalize()
        this.updateUndo()
      } else {
        // At end of <li> — merge next <li> into this one
        const nextLi = li.nextElementSibling
        if (nextLi && nextLi.tagName === 'LI') {
          while (nextLi.firstChild) {
            li.appendChild(nextLi.firstChild)
          }
          nextLi.remove()
          this.normalize()
          this.selectable.markBounds()
          this.updateUndo('new')
        }
        // If last <li>, do nothing (don't escape the list)
      }
    }
  }

  /** Group spanified characters by visual line (rounded top value) */
  private groupByLine(spans: Element[]): Element[][] {
    const lineMap = new Map<number, Element[]>()
    for (const span of spans) {
      const rect = span.getBoundingClientRect()
      const top = Math.round(rect.top)
      let line = lineMap.get(top)
      if (!line) {
        line = []
        lineMap.set(top, line)
      }
      line.push(span)
    }
    // Sort by top position, return as array of lines
    const sortedKeys = Array.from(lineMap.keys()).sort((a, b) => a - b)
    return sortedKeys.map((k) => lineMap.get(k)!)
  }

  /** Find the spanified char on a line closest to targetX */
  private closestCharOnLine(line: Element[], targetX: number): Element {
    let best = line[0]
    let bestDist = Infinity
    for (const span of line) {
      const rect = span.getBoundingClientRect()
      const mid = rect.left + rect.width / 2
      const dist = Math.abs(mid - targetX)
      if (dist < bestDist) {
        bestDist = dist
        best = span
      }
    }
    return best
  }

  /** Position bounds at a spanified character, then despanify the block */
  private positionAtSpanChar(
    span: Element,
    targetX: number,
    extendSelection: boolean,
    blockToDespanify: Element,
  ): void {
    // Place bounds while spans still exist in the DOM
    const rect = span.getBoundingClientRect()
    const start = this.selectable.find('.sel-start')
    const end = this.selectable.find('.sel-end')
    if (!start || !end) return

    if (targetX < rect.left + rect.width / 2) {
      span.before(end)
    } else {
      span.after(end)
    }
    if (!extendSelection) {
      end.parentNode?.insertBefore(start, end)
    }
    // Despanify, then mark selection
    spanify(blockToDespanify, false)
    this.selectable.markBounds()
    this.focus()
  }

  /** Move caret up or down by visual line */
  private moveVertical(direction: 'up' | 'down', extendSelection: boolean): void {
    const ip = this.insertionPoint()
    if (!ip) return

    const currentBlock = this.block(ip)
    if (!currentBlock) return

    // Determine sticky X: capture on first vertical move, reuse on subsequent ones
    const isConsecutiveVertical = this.lastKey === 38 || this.lastKey === 40
    if (!isConsecutiveVertical) {
      const caretRect = ip.getBoundingClientRect()
      this.lastCursorX = caretRect.left
    }
    const targetX = this.lastCursorX

    // When inside a list item, use the <li> as the container for spanification
    // instead of the whole <ul>/<ol> block
    const li = this.listItemOf(ip)
    const container = li || currentBlock

    // Spanify current container to get character positions
    spanify(container, true)
    const spans = Array.from(container.querySelectorAll('.spanified'))

    if (spans.length > 0) {
      const lines = this.groupByLine(spans)
      const caretRect = ip.getBoundingClientRect()
      const caretTop = Math.round(caretRect.top)

      // Find which line the caret is on (nearest by top)
      let currentLineIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < lines.length; i++) {
        const lineTop = Math.round(lines[i][0].getBoundingClientRect().top)
        const dist = Math.abs(lineTop - caretTop)
        if (dist < bestDist) {
          bestDist = dist
          currentLineIdx = i
        }
      }

      const targetLineIdx = direction === 'up' ? currentLineIdx - 1 : currentLineIdx + 1

      if (targetLineIdx >= 0 && targetLineIdx < lines.length) {
        // Target line is within this container
        const targetChar = this.closestCharOnLine(lines[targetLineIdx], targetX)
        this.positionAtSpanChar(targetChar, targetX, extendSelection, container)
        return
      }
    }

    // Target line is outside this container
    spanify(container, false)

    if (li) {
      // Inside a list: move to adjacent <li> sibling, or exit the list
      const siblingLi = direction === 'up'
        ? li.previousElementSibling
        : li.nextElementSibling

      if (siblingLi && siblingLi.tagName === 'LI') {
        // Move to adjacent list item
        spanify(siblingLi, true)
        const siblingSpans = Array.from(siblingLi.querySelectorAll('.spanified'))

        if (siblingSpans.length === 0) {
          spanify(siblingLi, false)
          this.moveCaretToEmptyContainer(siblingLi, direction, extendSelection)
          return
        }

        const siblingLines = this.groupByLine(siblingSpans)
        const targetLine = direction === 'up'
          ? siblingLines[siblingLines.length - 1]
          : siblingLines[0]
        const targetChar = this.closestCharOnLine(targetLine, targetX)
        this.positionAtSpanChar(targetChar, targetX, extendSelection, siblingLi)
        return
      }

      // No sibling <li> — exit the list to adjacent block
      const sibling = direction === 'up'
        ? currentBlock.previousElementSibling
        : currentBlock.nextElementSibling

      if (!sibling) return
      this.moveVerticalToBlock(sibling, direction, targetX, extendSelection)
      return
    }

    // Not in a list: move to adjacent block
    const sibling = direction === 'up'
      ? currentBlock.previousElementSibling
      : currentBlock.nextElementSibling

    if (!sibling) return
    this.moveVerticalToBlock(sibling, direction, targetX, extendSelection)
  }

  /** Move caret into an empty container (no spanifiable content) */
  private moveCaretToEmptyContainer(
    container: Element,
    direction: 'up' | 'down',
    extendSelection: boolean,
  ): void {
    const start = this.selectable.find('.sel-start')
    const end = this.selectable.find('.sel-end')
    if (!start || !end) return

    if (direction === 'up') {
      container.appendChild(end)
    } else {
      container.insertBefore(end, container.firstChild)
    }
    if (!extendSelection) {
      end.parentNode?.insertBefore(start, end)
    }
    this.selectable.markBounds()
    this.focus()
  }

  /** Move caret vertically into a sibling block, handling lists and regular blocks */
  private moveVerticalToBlock(
    sibling: Element,
    direction: 'up' | 'down',
    targetX: number,
    extendSelection: boolean,
  ): void {
    // If sibling is a list, enter its first/last <li>
    const isList = (sibling.tagName === 'UL' || sibling.tagName === 'OL') &&
      !sibling.classList.contains('editor-table')
    const targetContainer = isList
      ? (direction === 'up'
        ? sibling.querySelector(':scope > li:last-child')
        : sibling.querySelector(':scope > li:first-child')) || sibling
      : sibling

    spanify(targetContainer, true)
    const siblingSpans = Array.from(targetContainer.querySelectorAll('.spanified'))

    if (siblingSpans.length === 0) {
      spanify(targetContainer, false)
      this.moveCaretToEmptyContainer(targetContainer, direction, extendSelection)
      return
    }

    const siblingLines = this.groupByLine(siblingSpans)
    const targetLine = direction === 'up'
      ? siblingLines[siblingLines.length - 1]
      : siblingLines[0]

    const targetChar = this.closestCharOnLine(targetLine, targetX)
    this.positionAtSpanChar(targetChar, targetX, extendSelection, targetContainer)
  }

  /** Insert a character at the caret */
  private contentKey(key: string): void {
    const ip = this.insertionPoint()
    if (ip) {
      ip.before(document.createTextNode(key))
      this.normalize()
      this.updateUndo()
    }
  }

  /** Delete the character before the caret */
  private backspace(): void {
    if (!this.deleteSelection()) {
      const ip = this.insertionPoint()
      if (!ip) return

      const node = previousLeafNode(ip, this.parts.doc, deletableFilter)
      if (!node) return

      const caretBlock = this.block(ip)
      const deletionBlock = this.block(node)

      if (node.nodeType === 3 && (node.textContent || '').length > 1) {
        node.textContent = node.textContent!.slice(0, -1)
      } else {
        const top = topSingleParentAncestor(node)
        top.parentNode?.removeChild(top)
        this.normalize()
      }

      // Merge blocks if deletion crossed a block boundary
      if (
        deletionBlock &&
        caretBlock &&
        this.parts.doc.contains(deletionBlock) &&
        deletionBlock !== caretBlock
      ) {
        while (caretBlock.firstChild) {
          deletionBlock.appendChild(caretBlock.firstChild)
        }
        caretBlock.remove()
      }
      this.updateUndo()
    }
  }

  /** Forward delete */
  private forwardDelete(): void {
    if (!this.deleteSelection()) {
      const ip = this.insertionPoint()
      if (!ip) return

      const node = nextLeafNode(ip, this.parts.doc, deletableFilter)
      if (!node) return

      const caretBlock = this.block(ip)
      const deletionBlock = this.block(node)

      if (node.nodeType === 3 && (node.textContent || '').length > 1) {
        node.textContent = node.textContent!.slice(1)
      } else {
        const top = topSingleParentAncestor(node)
        top.parentNode?.removeChild(top)
        this.normalize()
      }

      // Merge blocks if deletion crossed a block boundary
      if (
        deletionBlock &&
        caretBlock &&
        this.parts.doc.contains(deletionBlock) &&
        deletionBlock !== caretBlock
      ) {
        while (deletionBlock.firstChild) {
          caretBlock.appendChild(deletionBlock.firstChild)
        }
        deletionBlock.remove()
      }
      this.updateUndo()
    }
  }

  /** Delete the current selection, return true if something was deleted */
  deleteSelection(): boolean {
    const blocks = this.selectedBlocks()
    let wasAnythingDeleted = false

    // Remove completely selected blocks (not first or last)
    for (const block of blocks) {
      if (
        !block.classList.contains('first-block') &&
        !block.classList.contains('last-block')
      ) {
        block.remove()
      }
    }

    const nodes = this.selectedLeafNodes()
    if (nodes.length) {
      for (const node of nodes) {
        const top = topSingleParentAncestor(node)
        top.parentNode?.removeChild(top)
      }
      wasAnythingDeleted = true
    }

    // Collapse to caret — remove sel-start, keep only the caret
    const selStart = this.parts.doc.querySelector('.sel-start')
    if (selStart && !selStart.classList.contains('caret')) {
      selStart.remove()
    }
    // Clean up selection markers
    this.selectable.unmark()

    if (blocks.length > 1) {
      // Merge first and last blocks
      const firstBlock = blocks[0]
      const lastBlock = blocks[blocks.length - 1]
      if (
        this.parts.doc.contains(firstBlock) &&
        this.parts.doc.contains(lastBlock)
      ) {
        while (firstBlock.firstChild) {
          lastBlock.insertBefore(firstBlock.firstChild, lastBlock.firstChild)
        }
        firstBlock.remove()
      }
      this.selectable.markBounds()
      this.focus()
    } else if (wasAnythingDeleted) {
      this.updateUndo()
      this.selectable.selectionChanged()
    }

    return wasAnythingDeleted
  }

  /** Split the current block at the caret position (Enter key) */
  private splitAtCaret(): boolean {
    const ip = this.insertionPoint()
    if (!ip) return false

    const currentBlock = this.block(ip)
    if (!currentBlock) return false

    // Create a new block of the same type
    const newBlock = document.createElement(currentBlock.tagName)

    // Move everything after the caret into the new block
    let node: Node | null = ip.nextSibling
    while (node) {
      const next: Node | null = node.nextSibling
      newBlock.appendChild(node)
      node = next
    }

    // Also move the caret markers into the new block
    const selStart = currentBlock.querySelector('.sel-start')
    const selEnd = currentBlock.querySelector('.sel-end')
    if (selEnd) {
      newBlock.insertBefore(selEnd, newBlock.firstChild)
    }
    if (selStart) {
      newBlock.insertBefore(selStart, newBlock.firstChild)
    }

    // If new block is empty, add an empty text node
    if (!newBlock.textContent?.trim()) {
      const br = document.createTextNode('\u00A0') // nbsp as placeholder
      if (selStart) {
        selStart.before(br)
      } else {
        newBlock.appendChild(br)
      }
    }

    // If old block is empty, add an empty text node
    if (!currentBlock.textContent?.trim()) {
      currentBlock.appendChild(document.createTextNode('\u00A0'))
    }

    currentBlock.after(newBlock)
    this.selectable.markBounds()
    this.updateUndo('new')
    return true
  }

  /** Move caret left */
  private arrowLeft(evt: KeyboardEvent): void {
    const start = this.selectable.find('.sel-start')
    if (!start) return

    let previous: Node | null
    if (evt.altKey) {
      previous = previousLeafNode(start, this.parts.doc, whitespaceFilter)
    } else {
      previous = previousLeafNode(start, this.parts.doc, deletableFilter)
    }
    if (previous) {
      this.moveBoundsBefore(previous, evt.shiftKey)
    }
  }

  /** Move caret right */
  private arrowRight(evt: KeyboardEvent): void {
    const end = this.selectable.find('.sel-end')
    if (!end) return

    let next: Node | null
    if (evt.altKey) {
      next = nextLeafNode(end, this.parts.doc, whitespaceFilter)
    } else {
      next = nextLeafNode(end, this.parts.doc, deletableFilter)
    }
    if (next) {
      this.moveBoundsAfter(next, evt.shiftKey)
    }
  }

  /** Move bounds to before a target node */
  private moveBoundsBefore(target: Node, extendSelection: boolean): void {
    const start = this.selectable.find('.sel-start')
    const end = this.selectable.find('.sel-end')
    if (!start || !end) return

    if (target.nodeType === 3 && (target.textContent || '').length > 1) {
      ;(target as Text).splitText((target.textContent || '').length - 1)
    }
    target.parentNode?.insertBefore(start, target)
    if (!extendSelection) {
      start.after(end)
    }
    this.selectable.markBounds()
    this.focus()
  }

  /** Move bounds to after a target node */
  private moveBoundsAfter(target: Node, extendSelection: boolean): void {
    const start = this.selectable.find('.sel-start')
    const end = this.selectable.find('.sel-end')
    if (!start || !end) return

    if (target.nodeType === 3 && (target.textContent || '').length > 1) {
      ;(target as Text).splitText(1)
    }
    target.parentNode?.insertBefore(end, target.nextSibling)
    if (!extendSelection) {
      end.parentNode?.insertBefore(start, end)
    }
    this.selectable.markBounds()
    this.focus()
  }

  /** Manage undo/redo stack */
  updateUndo(command?: string, reason?: string): void {
    if (this.undo.length === 0) {
      command = 'init'
    }
    if (reason && this.reasonForLastUndo === reason) {
      command = undefined
    }
    this.reasonForLastUndo = reason

    const html = this.parts.doc.innerHTML

    switch (command) {
      case 'init':
        this.undo = [html]
        this.undoDepth = 0
        break
      case 'new':
        if (this.undoDepth) {
          this.undo = this.undo.slice(this.undoDepth)
          this.undoDepth = 0
        }
        this.undo.unshift(html)
        break
      case 'undo':
        if (this.undoDepth < this.undo.length - 1) {
          this.undoDepth++
          this.parts.doc.innerHTML = this.undo[this.undoDepth]
          this.focus()
        }
        break
      case 'redo':
        if (this.undoDepth > 0) {
          this.undoDepth--
          this.parts.doc.innerHTML = this.undo[this.undoDepth]
          this.focus()
        }
        break
      default:
        if (this.undoDepth || this.undo.length === 1) {
          this.undo = this.undo.slice(this.undoDepth)
          this.undoDepth = 0
          this.undo.unshift(html)
        } else {
          this.undo[0] = html
        }
    }

    // Update undo/redo button states
    this.updateUndoButtons()

    // Update form value
    if (this.internals) {
      this.internals.setFormValue(html)
    }
  }

  private updateUndoButtons(): void {
    const toolbar = this.parts.toolbar
    const undoBtn = toolbar.querySelector(
      '[value="updateUndo undo"]',
    ) as HTMLButtonElement | null
    const redoBtn = toolbar.querySelector(
      '[value="updateUndo redo"]',
    ) as HTMLButtonElement | null
    if (undoBtn) undoBtn.disabled = this.undoDepth >= this.undo.length - 1
    if (redoBtn) redoBtn.disabled = this.undoDepth === 0
  }

  /** Handle shortcuts (ctrl/cmd+key) */
  private handleShortcut(evt: KeyboardEvent): void {
    // Find matching toolbar button
    const key = evt.key.toLowerCase()
    const shortcutStr = `${evt.ctrlKey || evt.metaKey ? 'ctrl+' : ''}${key}`

    const btn = this.parts.toolbar.querySelector(
      `[data-shortcut="${shortcutStr}"]`,
    ) as HTMLElement | null
    if (btn) {
      const value = btn.getAttribute('value')
      if (value) {
        this.doCommand(value)
        evt.preventDefault()
        evt.stopPropagation()
      }
    }
  }

  private handleKeydown = (evt: KeyboardEvent): void => {
    if (!this.active) return
    const target = evt.target as Element
    if (target.closest('.not-editable')) return

    const cell = this.caretCell()
    const ip = this.insertionPoint()
    const li = ip ? this.listItemOf(ip) : null

    switch (evt.key) {
      case 'Tab':
        evt.preventDefault()
        if (cell) {
          if (evt.shiftKey) {
            // Move to previous cell
            const prev = prevCell(cell)
            if (prev) this.moveCaretToCell(prev)
          } else {
            // Move to next cell, or create a new row if at the end
            const next = nextCell(cell)
            if (next) {
              this.moveCaretToCell(next)
            } else {
              // At last cell — create a new row
              const table = tableOf(cell)
              if (table) {
                const colCount = getColumnCount(table)
                for (let c = 0; c < colCount; c++) {
                  table.appendChild(createCell())
                }
                const newFirst = nextCell(cell)
                if (newFirst) this.moveCaretToCell(newFirst)
                this.updateUndo('new')
              }
            }
          }
        }
        break
      case 'Backspace':
        evt.preventDefault()
        if (cell) {
          // In a table cell: don't let backspace escape the cell
          if (ip) {
            const prev = previousLeafNode(ip, cell, deletableFilter)
            if (prev) {
              if (prev.nodeType === 3 && (prev.textContent || '').length > 1) {
                prev.textContent = prev.textContent!.slice(0, -1)
              } else {
                const top = topSingleParentAncestor(prev)
                if (cell.contains(top)) {
                  top.parentNode?.removeChild(top)
                }
              }
              this.normalize()
              this.updateUndo()
            }
          }
        } else if (li) {
          this.listBackspace(li)
        } else {
          this.backspace()
        }
        break
      case 'Delete':
        evt.preventDefault()
        if (cell) {
          // In a table cell: don't let delete escape the cell
          if (ip) {
            const next = nextLeafNode(ip, cell, deletableFilter)
            if (next) {
              if (next.nodeType === 3 && (next.textContent || '').length > 1) {
                next.textContent = next.textContent!.slice(1)
              } else {
                const top = topSingleParentAncestor(next)
                if (cell.contains(top)) {
                  top.parentNode?.removeChild(top)
                }
              }
              this.normalize()
              this.updateUndo()
            }
          }
        } else if (li) {
          this.listForwardDelete(li)
        } else {
          this.forwardDelete()
        }
        break
      case 'Enter':
        evt.preventDefault()
        if (cell) {
          if (evt.shiftKey) {
            // Shift+Enter: move to cell below, or create a new row
            this.tableMoveDown(cell)
          } else {
            // Enter: insert <br> within the cell
            if (ip) {
              ip.before(document.createElement('br'))
              this.normalize()
              this.updateUndo()
            }
          }
        } else if (li) {
          this.deleteSelection()
          this.splitListItem(li)
        } else {
          this.deleteSelection()
          this.splitAtCaret()
        }
        break
      case 'ArrowLeft':
        evt.preventDefault()
        this.arrowLeft(evt)
        break
      case 'ArrowRight':
        evt.preventDefault()
        this.arrowRight(evt)
        break
      case 'ArrowUp':
        evt.preventDefault()
        if (cell) {
          if (evt.shiftKey) {
            // Shift+ArrowUp: move up or create new row above
            this.tableMoveUp(cell)
          } else {
            const above = cellAbove(cell)
            if (above) {
              this.moveCaretToCell(above)
            } else {
              // At first row — exit table upward
              this.exitTable(cell, 'before')
            }
          }
        } else {
          this.moveVertical('up', evt.shiftKey)
        }
        break
      case 'ArrowDown':
        evt.preventDefault()
        if (cell) {
          if (evt.shiftKey) {
            // Shift+ArrowDown: move down or create new row
            this.tableMoveDown(cell)
          } else {
            const below = cellBelow(cell)
            if (below) {
              this.moveCaretToCell(below)
            } else {
              // At last row — exit table downward
              this.exitTable(cell, 'after')
            }
          }
        } else {
          this.moveVertical('down', evt.shiftKey)
        }
        break
    }
    this.lastKey = evt.keyCode
  }

  private handleKeypress = (evt: KeyboardEvent): void => {
    if (!this.active) return
    const target = evt.target as Element
    if (target.closest('.not-editable')) return

    if (evt.ctrlKey || evt.metaKey) {
      this.handleShortcut(evt)
    } else {
      this.deleteSelection()
      if (evt.key.length === 1) {
        this.contentKey(evt.key)
      }
    }
    evt.preventDefault()
    evt.stopPropagation()
  }

  private handleCopy = (evt: ClipboardEvent): void => {
    const selected = Array.from(this.parts.doc.querySelectorAll('.selected'))
    if (selected.length === 0) return

    let html = ''
    let text = ''
    for (const el of selected) {
      html += (el as HTMLElement).outerHTML
      text += el.textContent
    }

    evt.clipboardData?.setData('text/html', html)
    evt.clipboardData?.setData('text/plain', text)
    evt.preventDefault()
  }

  private handleCut = (evt: ClipboardEvent): void => {
    this.handleCopy(evt)
    this.deleteSelection()
  }

  private handlePaste = (evt: ClipboardEvent): void => {
    if (!this.active) return

    const html = evt.clipboardData?.getData('text/html')
    const text = evt.clipboardData?.getData('text/plain')

    this.deleteSelection()
    const ip = this.insertionPoint()
    if (!ip) return

    if (this.pastemode === 'remove' || !html) {
      // Plain text paste
      if (text) {
        ip.before(document.createTextNode(text))
      }
    } else {
      // HTML paste
      const temp = document.createElement('div')
      temp.innerHTML = html
      while (temp.firstChild) {
        ip.before(temp.firstChild)
      }
    }

    this.normalize()
    this.updateUndo('new')
    evt.preventDefault()
  }

  /** Find the cell edge near a pointer position, returns [table, colIndex] or null */
  private cellEdgeAt(evt: PointerEvent): [HTMLElement, number] | null {
    const target = evt.target as Element
    const cell = target.closest('.editor-table > li') as HTMLElement | null
    if (!cell) return null
    const table = cell.parentElement
    if (!table || !table.classList.contains('editor-table')) return null

    const rect = cell.getBoundingClientRect()
    const colCount = getColumnCount(table)
    const col = colOfCell(cell, colCount)
    const edgeThreshold = 4

    // Check right edge (resize column to the right)
    if (
      Math.abs(evt.clientX - rect.right) < edgeThreshold &&
      col < colCount - 1
    ) {
      return [table, col]
    }
    // Check left edge (resize column to the left)
    if (Math.abs(evt.clientX - rect.left) < edgeThreshold && col > 0) {
      return [table, col - 1]
    }
    return null
  }

  private handleResizePointerDown = (evt: PointerEvent): void => {
    const edge = this.cellEdgeAt(evt)
    if (!edge) return

    const [table, col] = edge
    this.resizeTable = table
    this.resizeCol = col
    this.resizeStartX = evt.clientX

    // Get current pixel widths from the table's actual rendered columns
    const firstRowCells = getCellsInRow(table, 0, getColumnCount(table))
    this.resizeStartWidths = firstRowCells.map(
      (c) => c.getBoundingClientRect().width,
    )

    evt.preventDefault()
    evt.stopPropagation()
    this.parts.doc.setPointerCapture(evt.pointerId)
  }

  private handleResizePointerMove = (evt: PointerEvent): void => {
    // Update cursor when hovering near cell edges
    if (!this.resizeTable) {
      const edge = this.cellEdgeAt(evt)
      this.parts.doc.style.cursor = edge ? 'col-resize' : ''
      return
    }

    // Active resize drag
    const dx = evt.clientX - this.resizeStartX
    const newWidths = [...this.resizeStartWidths]
    newWidths[this.resizeCol] = Math.max(30, newWidths[this.resizeCol] + dx)
    newWidths[this.resizeCol + 1] = Math.max(
      30,
      newWidths[this.resizeCol + 1] - dx,
    )

    setColumnWidths(
      this.resizeTable,
      newWidths.map((w) => `${w}px`),
    )
  }

  private handleResizePointerUp = (evt: PointerEvent): void => {
    if (this.resizeTable) {
      this.updateUndo('new')
      this.resizeTable = null
      this.resizeCol = -1
      this.parts.doc.style.cursor = ''
      this.parts.doc.releasePointerCapture(evt.pointerId)
    }
  }

  private isToolbarEvent(target: Element): boolean {
    // Check if the event target is inside a slotted toolbar/menubar element
    return (
      target.closest('[slot="toolbar"]') !== null ||
      target.closest('[slot="menubar"]') !== null
    )
  }

  private handleToolbarClick = (evt: Event): void => {
    const target = evt.target as Element
    if (!this.isToolbarEvent(target)) return

    const btn = target.closest('button')
    if (!btn) return

    const value = btn.getAttribute('value')
    if (value) {
      this.doCommand(value)
    }
  }

  private handleToolbarChange = (evt: Event): void => {
    const target = evt.target as Element
    if (!this.isToolbarEvent(target)) return

    const select = target.closest('select') || target.closest('tosi-select')
    if (!select) return

    const value = (select as HTMLSelectElement).value
    if (value) {
      this.doCommand(value)
    }
  }

  render(): void {
    super.render()
  }
}

export const tosiEditable = TosiEditable.elementCreator({
  tag: 'tosi-editable',
}) as ElementCreator<TosiEditable>

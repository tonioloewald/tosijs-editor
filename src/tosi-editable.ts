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

    // Keyboard events
    doc.addEventListener('keydown', this.handleKeydown)
    doc.addEventListener('keypress', this.handleKeypress)

    // Clipboard events
    doc.addEventListener('copy', this.handleCopy)
    doc.addEventListener('cut', this.handleCut)
    doc.addEventListener('paste', this.handlePaste)

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

    switch (evt.key) {
      case 'Backspace':
        evt.preventDefault()
        this.backspace()
        break
      case 'Delete':
        evt.preventDefault()
        this.forwardDelete()
        break
      case 'Enter':
        evt.preventDefault()
        this.deleteSelection()
        this.splitAtCaret()
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
        // Arrow up/down require layout info not available in unit tests
        break
      case 'ArrowDown':
        evt.preventDefault()
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

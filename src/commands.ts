/**
 * Command system for tosijs-styled-editor.
 *
 * Commands are the interface between the toolbar/keyboard and
 * the editing engine. Each command is a method that receives
 * the editable context and arguments parsed from the command string.
 */

import { closestSingleParentAncestor } from './dom-utils'
import type { Selectable } from './selection'
import { spanify } from './selection'
import {
  cellOf,
  tableOf,
  getColumnCount,
  getColumnWidths,
  setColumnWidths,
  rowOfCell,
  colOfCell,
  getCellsInRow,
  getCellsInCol,
  getRowCount,
  createCell,
  createTable,
  isHeaderCell,
} from './table-utils'

/** A command implementation */
export type Command = (ctx: EditableContext, ...args: string[]) => void

/** Context passed to every command */
export interface EditableContext {
  root: HTMLElement
  selectable: Selectable
  /**
   * The command registry `executeCommand` resolves names against.
   * Omitted contexts fall back to the built-in `commands`.
   */
  commands?: Record<string, Command>
  find(selector: string): Element | null
  findAll(selector: string): Element[]
  selectedLeafNodes(): Node[]
  selectedBlocks(): Element[]
  insertionPoint(): HTMLInputElement | null
  block(node: Node): Element | null
  normalize(): void
  focus(): void
  updateUndo(command?: string, reason?: string): void
}

/** Parse a "key value key value" argument list into a CSS object */
export function makeCSS(args: string[]): Record<string, string> | null {
  if (args.length % 2 !== 0) {
    console.error('Error: expected even number of arguments', args)
    return null
  }
  const css: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    css[args[i]] = args[i + 1].replace(/\+/g, ' ')
  }
  return css
}

/** Apply a CSS object to an element */
function applyCSS(element: HTMLElement, css: Record<string, string>): void {
  for (const [key, value] of Object.entries(css)) {
    element.style.setProperty(key, value)
  }
}

/** A real list, as opposed to a grid table (which is also a <ul>) */
function isListElement(el: Element): boolean {
  return (
    (el.tagName === 'UL' || el.tagName === 'OL') &&
    !el.classList.contains('editor-table')
  )
}

/**
 * Replace a list with one paragraph per item. Children are moved rather than
 * copied so the caret markers inside them survive.
 */
function unwrapList(list: Element): void {
  const parent = list.parentNode
  if (!parent) return
  for (const item of Array.from(list.children)) {
    const paragraph = document.createElement('p')
    while (item.firstChild) paragraph.appendChild(item.firstChild)
    paragraph.classList.add('selected-block')
    parent.insertBefore(paragraph, list)
  }
  list.remove()
}

/**
 * Fold immediately-adjacent lists of the same type into one, so converting a
 * paragraph under an existing list joins it instead of starting a second list
 * (which would restart <ol> numbering). Returns the surviving list.
 */
function mergeAdjacentLists(list: Element): Element {
  let survivor = list
  const previous = survivor.previousElementSibling
  if (
    previous &&
    isListElement(previous) &&
    previous.tagName === survivor.tagName
  ) {
    while (survivor.firstChild) previous.appendChild(survivor.firstChild)
    previous.classList.add('selected-block')
    survivor.remove()
    survivor = previous
  }
  const next = survivor.nextElementSibling
  if (next && isListElement(next) && next.tagName === survivor.tagName) {
    while (next.firstChild) survivor.appendChild(next.firstChild)
    next.remove()
  }
  return survivor
}


/**
 * Set (or clear) a link's target.
 *
 * `target="_blank"` without `rel="noopener"` hands the opened page a live
 * `window.opener` reference to this one, so the two travel together.
 */
function applyLinkTarget(link: Element, target: string): void {
  if (!target || target === '_self') {
    link.removeAttribute('target')
    link.removeAttribute('rel')
    return
  }
  link.setAttribute('target', target)
  link.setAttribute('rel', 'noopener')
}

/** A stable key for a footnote pair, independent of its current number */
let footnoteSeq = 0
function footnoteKey(): string {
  footnoteSeq += 1
  return `fn-${Date.now().toString(36)}-${footnoteSeq}`
}

/**
 * Renumber footnotes from DOCUMENT ORDER and reorder the list to match.
 *
 * Numbers are never stored — they are derived here — so inserting a footnote
 * in the middle renumbers everything after it, and deleting a marker drops its
 * entry. The stable identity is `data-footnote`, not the number.
 */
export function renumberFootnotes(root: HTMLElement): void {
  const refs = Array.from(
    root.querySelectorAll('.footnote-ref[data-footnote]')
  ).filter((ref) => !ref.closest('.footnotes'))
  let list = root.querySelector('ol.footnotes')

  if (refs.length === 0) {
    list?.remove()
    return
  }
  if (!list) {
    list = document.createElement('ol')
    list.className = 'footnotes'
    root.appendChild(list)
  }

  const existing = new Map<string, Element>()
  for (const item of Array.from(list.children)) {
    const key = item.getAttribute('data-footnote')
    if (key) existing.set(key, item)
  }

  refs.forEach((ref, index) => {
    const key = ref.getAttribute('data-footnote')!
    const link = ref.querySelector('a')
    if (link) {
      link.textContent = String(index + 1)
      link.setAttribute('href', `#${key}`)
    }
    let item = existing.get(key)
    if (!item) {
      item = document.createElement('li')
      item.className = 'footnote'
      item.setAttribute('data-footnote', key)
      item.textContent = 'Footnote text'
    }
    item.id = key
    existing.delete(key)
    list!.appendChild(item)
  })

  // Markers that no longer exist take their entries with them
  for (const orphan of existing.values()) orphan.remove()
}

/** Command definitions — extensible by adding new methods */
export const commands: Record<string, Command> = {
  /**
   * Style selected characters with CSS properties.
   * Usage: setText font-weight bold font-style italic
   */
  setText(ctx: EditableContext, ...args: string[]) {
    const css = makeCSS(args)
    if (!css) return

    // Despanify so we work with real text nodes
    ctx.selectable.resetBounds()
    spanify(ctx.root, false)
    ctx.selectable.markBounds()
    ctx.normalize()

    // Grab selected leaf nodes and remove bounds (they break single-parent chains)
    const nodes = ctx.selectedLeafNodes()
    ctx.selectable.removeBounds()

    for (const node of nodes) {
      if (node.nodeType === 3) {
        // Try to find an existing setText span in the single-parent chain
        const existing = closestSingleParentAncestor(node, '.setText')
        if (existing && existing instanceof HTMLElement) {
          applyCSS(existing, css)
        } else {
          // Wrap in a new styled span
          const span = document.createElement('span')
          span.className = 'setText'
          applyCSS(span, css)
          node.parentNode?.insertBefore(span, node)
          span.appendChild(node)
        }
      }
    }

    // Restore selection and update undo
    ctx.selectable.resetBounds()
    ctx.focus()
    ctx.updateUndo('new')
  },

  /**
   * Change the block type of selected blocks.
   * Usage: setBlockType h1
   */
  setBlockType(ctx: EditableContext, newNodeType: string) {
    const blocks = ctx.selectedBlocks()
    for (const block of blocks) {
      const newBlock = document.createElement(newNodeType)
      // Move children
      while (block.firstChild) {
        newBlock.appendChild(block.firstChild)
      }
      newBlock.classList.add('selected-block')
      block.parentNode?.replaceChild(newBlock, block)
    }
    ctx.updateUndo('new')
  },

  /**
   * Turn the selected blocks into a bulleted or numbered list, or back into
   * paragraphs. Asking for the type a selection already has toggles it off.
   * Usage: setList ul | setList ol | setList none
   */
  setList(ctx: EditableContext, listType = 'ul') {
    const wanted = listType.toLowerCase()
    // A grid table is a <ul>; never rewrite one as a list
    const blocks = ctx
      .selectedBlocks()
      .filter((block) => !block.classList.contains('editor-table'))
    if (blocks.length === 0) return

    const alreadyWanted =
      blocks.every(isListElement) &&
      blocks.every((block) => block.tagName.toLowerCase() === wanted)

    if (wanted === 'none' || alreadyWanted) {
      for (const block of blocks) {
        if (isListElement(block)) unwrapList(block)
      }
      ctx.updateUndo('new')
      return
    }

    // Group runs of adjacent blocks so a multi-block selection makes ONE list
    const groups: Element[][] = []
    for (const block of blocks) {
      const run = groups[groups.length - 1]
      if (run && run[run.length - 1].nextElementSibling === block) {
        run.push(block)
      } else {
        groups.push([block])
      }
    }

    for (const group of groups) {
      const list = document.createElement(wanted)
      list.classList.add('selected-block')
      for (const block of group) {
        if (isListElement(block)) {
          // A list of the other type — carry its items across as-is
          while (block.firstChild) list.appendChild(block.firstChild)
        } else {
          const item = document.createElement('li')
          while (block.firstChild) item.appendChild(block.firstChild)
          list.appendChild(item)
        }
      }
      group[0].parentNode?.insertBefore(list, group[0])
      for (const block of group) block.remove()
      mergeAdjacentLists(list)
    }
    ctx.updateUndo('new')
  },

  /**
   * Wrap the selected text in a link, or repoint a link already covering it.
   * Opens in a new tab unless told otherwise.
   * Usage: setLink https://example.com | setLink https://example.com _self
   */
  setLink(ctx: EditableContext, url: string, target = '_blank') {
    if (!url) return
    ctx.selectable.resetBounds()
    spanify(ctx.root, false)
    ctx.selectable.markBounds()
    ctx.normalize()
    const nodes = ctx.selectedLeafNodes()
    ctx.selectable.removeBounds()

    for (const node of nodes) {
      if (node.nodeType !== 3) continue
      const existing = closestSingleParentAncestor(node, 'a')
      if (existing instanceof Element) {
        existing.setAttribute('href', url)
        applyLinkTarget(existing, target)
      } else {
        const link = document.createElement('a')
        link.setAttribute('href', url)
        applyLinkTarget(link, target)
        node.parentNode?.insertBefore(link, node)
        link.appendChild(node)
      }
    }
    ctx.selectable.resetBounds()
    ctx.focus()
    ctx.updateUndo('new')
  },

  /** Unwrap any link covering the selection. Usage: removeLink */
  removeLink(ctx: EditableContext) {
    ctx.selectable.resetBounds()
    spanify(ctx.root, false)
    ctx.selectable.markBounds()
    const nodes = ctx.selectedLeafNodes()
    ctx.selectable.removeBounds()

    const links = new Set<Element>()
    for (const node of nodes) {
      const link =
        node.parentElement?.closest('a') ??
        (node instanceof Element ? node.closest('a') : null)
      if (link && ctx.root.contains(link)) links.add(link)
    }
    for (const link of links) {
      const parent = link.parentNode
      if (!parent) continue
      while (link.firstChild) parent.insertBefore(link.firstChild, link)
      parent.removeChild(link)
    }
    ctx.selectable.resetBounds()
    ctx.focus()
    ctx.updateUndo('new')
  },

  /**
   * Insert an image at the caret. An <img> is a leaf node, so selection and
   * deletion already treat it as one thing.
   * Usage: insertImage https://example.com/cat.png A cat
   */
  insertImage(ctx: EditableContext, url: string, ...alt: string[]) {
    const ip = ctx.insertionPoint()
    if (!ip || !url) return
    const image = document.createElement('img')
    image.setAttribute('src', url)
    image.setAttribute('alt', alt.join(' '))
    ip.before(image)
    ctx.normalize()
    ctx.focus()
    ctx.updateUndo('new')
  },

  /**
   * Insert a footnote marker at the caret and its entry at the end of the
   * document. Numbers come from document order, so inserting one in the middle
   * renumbers the rest.
   * Usage: insertFootnote optional initial text
   */
  insertFootnote(ctx: EditableContext, ...text: string[]) {
    const ip = ctx.insertionPoint()
    if (!ip) return
    const key = footnoteKey()

    const marker = document.createElement('sup')
    marker.className = 'footnote-ref'
    marker.setAttribute('data-footnote', key)
    const link = document.createElement('a')
    link.setAttribute('href', `#${key}`)
    link.textContent = '?'
    marker.appendChild(link)
    ip.before(marker)

    let list = ctx.root.querySelector('ol.footnotes')
    if (!list) {
      list = document.createElement('ol')
      list.className = 'footnotes'
      ctx.root.appendChild(list)
    }
    const item = document.createElement('li')
    item.className = 'footnote'
    item.setAttribute('data-footnote', key)
    item.id = key
    item.textContent = text.length ? text.join(' ') : 'Footnote text'
    list.appendChild(item)

    renumberFootnotes(ctx.root)
    ctx.normalize()
    ctx.focus()
    ctx.updateUndo('new')
  },

  /** Recompute footnote numbers and order. Usage: renumberFootnotes */
  renumberFootnotes(ctx: EditableContext) {
    renumberFootnotes(ctx.root)
    ctx.updateUndo('new')
  },

  /**
   * Apply CSS to selected blocks.
   * Usage: setBlocks text-align center
   */
  setBlocks(ctx: EditableContext, ...args: string[]) {
    const css = makeCSS(args)
    if (!css) return
    for (const block of ctx.selectedBlocks()) {
      applyCSS(block as HTMLElement, css)
    }
    ctx.updateUndo('new')
  },

  /**
   * Undo/redo.
   * Usage: updateUndo undo | updateUndo redo
   */
  updateUndo(ctx: EditableContext, command: string) {
    ctx.updateUndo(command)
  },

  /**
   * Toggle debug mode on the editor root.
   * Usage: setDebug
   */
  setDebug(ctx: EditableContext) {
    ctx.root.classList.toggle('debug')
  },

  /**
   * Insert an annotation at the insertion point.
   * Usage: annotate note
   */
  annotate(ctx: EditableContext, type: string) {
    const insertionPoint = ctx.insertionPoint()
    if (!insertionPoint) return

    const template = document.querySelector(`.annotation-template .${type}`)
    if (!template) return

    const span = document.createElement('span')
    span.className = 'annotation do-not-spanify not-selectable not-editable'
    const body = template.cloneNode(true) as Element
    body.classList.add('annotation-body')
    span.appendChild(body)
    insertionPoint.after(span)
    ctx.updateUndo('new')
  },

  /**
   * Insert a table at the caret.
   * Usage: insertTable 3       (3 cols, 2 rows, 1 header row)
   *        insertTable 4 5 1   (4 cols, 5 rows, 1 header row)
   */
  insertTable(ctx: EditableContext, ...args: string[]) {
    const cols = parseInt(args[0]) || 3
    const rows = parseInt(args[1]) || 2
    const headerRows = parseInt(args[2]) || 1
    const ip = ctx.insertionPoint()
    if (!ip) return

    const block = ctx.block(ip)
    const table = createTable(cols, rows, headerRows)

    if (block) {
      block.after(table)
    } else {
      ctx.root.appendChild(table)
    }

    // Move caret into first cell
    const firstCell = table.querySelector('li')
    if (firstCell) {
      firstCell.innerHTML = ''
      firstCell.appendChild(ctx.selectable.createBounds())
      ctx.selectable.normalize()
      ctx.focus()
    }
    ctx.updateUndo('new')
  },

  /**
   * Insert a row relative to the caret's current row.
   * Usage: insertTableRow after  (default)
   *        insertTableRow before
   */
  insertTableRow(ctx: EditableContext, position = 'after') {
    const ip = ctx.insertionPoint()
    if (!ip) return
    const cell = cellOf(ip)
    if (!cell) return
    const table = tableOf(cell)
    if (!table) return

    const colCount = getColumnCount(table)
    const row = rowOfCell(cell, colCount)
    const isHeader = position === 'before' && row === 0 && isHeaderCell(cell)

    // Find the reference cell — last cell of the target row for 'after', first cell for 'before'
    const rowCells = getCellsInRow(table, row, colCount)
    const refCell =
      position === 'before' ? rowCells[0] : rowCells[rowCells.length - 1]

    for (let c = 0; c < colCount; c++) {
      const newCell = createCell(isHeader)
      if (position === 'before') {
        refCell.before(newCell)
      } else {
        refCell.after(newCell)
      }
    }
    ctx.updateUndo('new')
  },

  /**
   * Insert a column relative to the caret's current column.
   * Usage: insertTableCol after  (default)
   *        insertTableCol before
   */
  insertTableCol(ctx: EditableContext, position = 'after') {
    const ip = ctx.insertionPoint()
    if (!ip) return
    const cell = cellOf(ip)
    if (!cell) return
    const table = tableOf(cell)
    if (!table) return

    const colCount = getColumnCount(table)
    const col = colOfCell(cell, colCount)
    const rowCount = getRowCount(table)

    // Insert cells row by row, working backwards to avoid index shifts
    for (let r = rowCount - 1; r >= 0; r--) {
      const rowCells = getCellsInRow(table, r, colCount)
      const refCell = rowCells[col]
      const isHeader = isHeaderCell(refCell)
      const newCell = createCell(isHeader)
      if (position === 'before') {
        refCell.before(newCell)
      } else {
        refCell.after(newCell)
      }
    }

    // Update grid-template-columns
    const widths = getColumnWidths(table)
    const insertAt = position === 'before' ? col : col + 1
    widths.splice(insertAt, 0, '1fr')
    setColumnWidths(table, widths)

    ctx.updateUndo('new')
  },

  /**
   * Delete the row containing the caret.
   */
  deleteTableRow(ctx: EditableContext) {
    const ip = ctx.insertionPoint()
    if (!ip) return
    const cell = cellOf(ip)
    if (!cell) return
    const table = tableOf(cell)
    if (!table) return

    const colCount = getColumnCount(table)
    const rowCount = getRowCount(table)
    if (rowCount <= 1) return // Don't delete the last row

    const row = rowOfCell(cell, colCount)
    const rowCells = getCellsInRow(table, row, colCount)

    // Move caret to the row above or below before deleting
    const targetRow = row > 0 ? row - 1 : 1
    const targetCells = getCellsInRow(table, targetRow, colCount)
    if (targetCells.length > 0) {
      const targetCell = targetCells[0]
      targetCell.appendChild(ctx.selectable.createBounds())
      ctx.selectable.normalize()
      ctx.focus()
    }

    for (const c of rowCells) {
      c.remove()
    }
    ctx.updateUndo('new')
  },

  /**
   * Delete the column containing the caret.
   */
  deleteTableCol(ctx: EditableContext) {
    const ip = ctx.insertionPoint()
    if (!ip) return
    const cell = cellOf(ip)
    if (!cell) return
    const table = tableOf(cell)
    if (!table) return

    const colCount = getColumnCount(table)
    if (colCount <= 1) return // Don't delete the last column

    const col = colOfCell(cell, colCount)

    // Move caret to adjacent column before deleting
    const row = rowOfCell(cell, colCount)
    const targetCol = col > 0 ? col - 1 : 1
    const targetCells = getCellsInRow(table, row, colCount)
    if (targetCells[targetCol]) {
      targetCells[targetCol].appendChild(ctx.selectable.createBounds())
      ctx.selectable.normalize()
      ctx.focus()
    }

    // Delete column cells from bottom to top to avoid index shifts
    const colCells = getCellsInCol(table, col, colCount)
    for (let i = colCells.length - 1; i >= 0; i--) {
      colCells[i].remove()
    }

    // Update grid-template-columns
    const widths = getColumnWidths(table)
    widths.splice(col, 1)
    setColumnWidths(table, widths)

    ctx.updateUndo('new')
  },

  /**
   * Toggle header styling on the caret's row.
   */
  toggleHeaderRow(ctx: EditableContext) {
    const ip = ctx.insertionPoint()
    if (!ip) return
    const cell = cellOf(ip)
    if (!cell) return
    const table = tableOf(cell)
    if (!table) return

    const colCount = getColumnCount(table)
    const row = rowOfCell(cell, colCount)
    const rowCells = getCellsInRow(table, row, colCount)

    const shouldBeHeader = !isHeaderCell(rowCells[0])
    for (const c of rowCells) {
      c.classList.toggle('table-header', shouldBeHeader)
    }
    ctx.updateUndo('new')
  },
}

/**
 * Parse and execute a command string.
 * Supports chained commands separated by semicolons.
 * Example: "setText font-weight bold; setBlockType h2"
 */
export function executeCommand(
  ctx: EditableContext,
  commandString: string
): void {
  const registry = ctx.commands ?? commands
  const commandList = commandString.split(/;\s*/)
  for (const cmd of commandList) {
    const pieces = cmd.trim().split(/\s+/)
    const name = pieces.shift()
    if (!name) continue

    const fn = registry[name]
    if (fn) {
      fn(ctx, ...pieces)
    } else {
      console.error('unrecognized command', name)
    }
  }
}

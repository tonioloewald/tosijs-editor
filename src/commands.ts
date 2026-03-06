/**
 * Command system for tosi-editable.
 *
 * Commands are the interface between the toolbar/keyboard and
 * the editing engine. Each command is a method that receives
 * the editable context and arguments parsed from the command string.
 */

import {
  leafNodes,
  topSingleParentAncestor,
  closestSingleParentAncestor,
} from './dom-utils'
import type { Selectable } from './selection'
import { spanify } from './selection'
import {
  cellOf,
  tableOf,
  getColumnCount,
  getColumnWidths,
  setColumnWidths,
  cellIndex,
  rowOfCell,
  colOfCell,
  getCellsInRow,
  getCellsInCol,
  getRowCount,
  createCell,
  createTable,
  isHeaderCell,
} from './table-utils'

/** Context passed to every command */
export interface EditableContext {
  root: HTMLElement
  selectable: Selectable
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

/** Command definitions — extensible by adding new methods */
export const commands: Record<
  string,
  (ctx: EditableContext, ...args: string[]) => void
> = {
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
  commandString: string,
): void {
  const commandList = commandString.split(/;\s*/)
  for (const cmd of commandList) {
    const pieces = cmd.trim().split(/\s+/)
    const name = pieces.shift()
    if (!name) continue

    const fn = commands[name]
    if (fn) {
      fn(ctx, ...pieces)
    } else {
      console.error('unrecognized command', name)
    }
  }
}

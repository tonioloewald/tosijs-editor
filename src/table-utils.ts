/**
 * Table utilities for the grid-based table editor.
 *
 * Tables are `<ul class="editor-table">` with CSS grid layout.
 * Cells are `<li>` elements. Column count is derived from
 * `grid-template-columns`. Header cells have class `table-header`.
 */

const TABLE_CLASS = 'editor-table'

function isLI(node: Node): node is HTMLElement {
  return node instanceof Element && node.tagName === 'LI'
}

function isUL(node: Node): node is HTMLElement {
  return node instanceof Element && node.tagName === 'UL'
}

/** Check if a node is inside a table cell */
export function isTableCell(node: Node): boolean {
  return cellOf(node) !== null
}

/** Find the <li> cell containing a node, or null */
export function cellOf(node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current) {
    if (
      isLI(current) &&
      current.parentElement?.classList.contains(TABLE_CLASS)
    ) {
      return current
    }
    current = current.parentNode
  }
  return null
}

/** Find the .editor-table <ul> containing a node, or null */
export function tableOf(node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current) {
    if (isUL(current) && current.classList.contains(TABLE_CLASS)) {
      return current
    }
    current = current.parentNode
  }
  return null
}

/** Get the number of columns from grid-template-columns */
export function getColumnCount(table: HTMLElement): number {
  const cols = table.style.gridTemplateColumns.trim()
  if (!cols) return 1
  return cols.split(/\s+/).length
}

/** Get the column widths as an array of strings */
export function getColumnWidths(table: HTMLElement): string[] {
  const cols = table.style.gridTemplateColumns.trim()
  if (!cols) return ['1fr']
  return cols.split(/\s+/)
}

/** Set the column widths from an array of strings */
export function setColumnWidths(table: HTMLElement, widths: string[]): void {
  table.style.gridTemplateColumns = widths.join(' ')
}

/** Get the index of a cell among its sibling <li> elements */
export function cellIndex(cell: HTMLElement): number {
  const table = cell.parentElement
  if (!table) return -1
  const cells = Array.from(table.querySelectorAll(':scope > li'))
  return cells.indexOf(cell)
}

/** Get which row a cell is in (0-based) */
export function rowOfCell(cell: HTMLElement, colCount: number): number {
  return Math.floor(cellIndex(cell) / colCount)
}

/** Get which column a cell is in (0-based) */
export function colOfCell(cell: HTMLElement, colCount: number): number {
  return cellIndex(cell) % colCount
}

/** Get the cell in the same column one row down, or null */
export function cellBelow(cell: HTMLElement): HTMLElement | null {
  const table = cell.parentElement
  if (!table) return null
  const colCount = getColumnCount(table)
  const idx = cellIndex(cell)
  const targetIdx = idx + colCount
  const cells = Array.from(table.querySelectorAll(':scope > li'))
  return targetIdx < cells.length ? (cells[targetIdx] as HTMLElement) : null
}

/** Get the cell in the same column one row up, or null */
export function cellAbove(cell: HTMLElement): HTMLElement | null {
  const table = cell.parentElement
  if (!table) return null
  const colCount = getColumnCount(table)
  const idx = cellIndex(cell)
  const targetIdx = idx - colCount
  if (targetIdx < 0) return null
  const cells = Array.from(table.querySelectorAll(':scope > li'))
  return cells[targetIdx] as HTMLElement
}

/** Get the next <li> sibling, or null */
export function nextCell(cell: HTMLElement): HTMLElement | null {
  const next = cell.nextElementSibling
  return next && isLI(next) ? (next as HTMLElement) : null
}

/** Get the previous <li> sibling, or null */
export function prevCell(cell: HTMLElement): HTMLElement | null {
  const prev = cell.previousElementSibling
  return prev && isLI(prev) ? (prev as HTMLElement) : null
}

/** Check if a cell is a header cell */
export function isHeaderCell(cell: HTMLElement): boolean {
  return cell.classList.contains('table-header')
}

/** Create a single table cell */
export function createCell(isHeader = false): HTMLElement {
  const li = document.createElement('li')
  if (isHeader) {
    li.classList.add('table-header')
  }
  li.innerHTML = '\u00A0'
  return li
}

/** Get all cells in a specific row */
export function getCellsInRow(
  table: HTMLElement,
  row: number,
  colCount: number,
): HTMLElement[] {
  const cells = Array.from(table.querySelectorAll(':scope > li'))
  const start = row * colCount
  return cells.slice(start, start + colCount) as HTMLElement[]
}

/** Get all cells in a specific column */
export function getCellsInCol(
  table: HTMLElement,
  col: number,
  colCount: number,
): HTMLElement[] {
  const cells = Array.from(
    table.querySelectorAll(':scope > li'),
  ) as HTMLElement[]
  const result: HTMLElement[] = []
  for (let i = col; i < cells.length; i += colCount) {
    result.push(cells[i])
  }
  return result
}

/** Get the total number of rows */
export function getRowCount(table: HTMLElement): number {
  const cells = table.querySelectorAll(':scope > li')
  const colCount = getColumnCount(table)
  return Math.ceil(cells.length / colCount)
}

/**
 * Create a complete table element.
 * @param cols Number of columns
 * @param rows Total number of rows (including header rows)
 * @param headerRows Number of header rows (default 1)
 */
export function createTable(
  cols: number,
  rows = 2,
  headerRows = 1,
): HTMLElement {
  const ul = document.createElement('ul')
  ul.className = TABLE_CLASS
  ul.style.gridTemplateColumns = Array(cols).fill('1fr').join(' ')

  for (let r = 0; r < rows; r++) {
    const isHeader = r < headerRows
    for (let c = 0; c < cols; c++) {
      ul.appendChild(createCell(isHeader))
    }
  }

  return ul
}

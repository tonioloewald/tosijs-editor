import { test, expect, describe, beforeEach } from 'bun:test'
import {
  isTableCell,
  cellOf,
  tableOf,
  getColumnCount,
  getColumnWidths,
  setColumnWidths,
  cellIndex,
  rowOfCell,
  colOfCell,
  nextCell,
  prevCell,
  isHeaderCell,
  createCell,
  getCellsInRow,
  getCellsInCol,
  getRowCount,
  createTable,
} from './table-utils'

describe('table-utils', () => {
  let table: HTMLUListElement

  beforeEach(() => {
    table = createTable(3, 3, 1)
    document.body.appendChild(table)
  })

  describe('createTable', () => {
    test('creates a ul with editor-table class', () => {
      expect(table.tagName).toBe('UL')
      expect(table.classList.contains('editor-table')).toBe(true)
    })

    test('sets grid-template-columns', () => {
      expect(table.style.gridTemplateColumns).toBe('1fr 1fr 1fr')
    })

    test('creates correct number of cells', () => {
      expect(table.querySelectorAll('li').length).toBe(9)
    })

    test('marks header cells', () => {
      const headers = table.querySelectorAll('li.table-header')
      expect(headers.length).toBe(3)
    })

    test('non-header cells lack table-header class', () => {
      const cells = Array.from(table.querySelectorAll('li'))
      expect(cells[3].classList.contains('table-header')).toBe(false)
    })
  })

  describe('createCell', () => {
    test('creates an li element', () => {
      const cell = createCell()
      expect(cell.tagName).toBe('LI')
    })

    test('has nbsp content', () => {
      const cell = createCell()
      expect(cell.textContent).toBe('\u00A0')
    })

    test('header cell has class', () => {
      const cell = createCell(true)
      expect(cell.classList.contains('table-header')).toBe(true)
    })
  })

  describe('isTableCell / cellOf / tableOf', () => {
    test('li inside editor-table is a table cell', () => {
      const cell = table.querySelector('li')!
      expect(isTableCell(cell)).toBe(true)
    })

    test('text node inside cell is a table cell', () => {
      const cell = table.querySelector('li')!
      const text = cell.firstChild!
      expect(isTableCell(text)).toBe(true)
    })

    test('element outside table is not a table cell', () => {
      const div = document.createElement('div')
      document.body.appendChild(div)
      expect(isTableCell(div)).toBe(false)
      div.remove()
    })

    test('cellOf returns the li', () => {
      const cell = table.querySelector('li')!
      const text = cell.firstChild!
      expect(cellOf(text)).toBe(cell)
    })

    test('tableOf returns the ul', () => {
      const cell = table.querySelector('li')!
      expect(tableOf(cell)).toBe(table)
    })
  })

  describe('getColumnCount / getColumnWidths / setColumnWidths', () => {
    test('getColumnCount returns 3', () => {
      expect(getColumnCount(table)).toBe(3)
    })

    test('getColumnWidths returns array', () => {
      expect(getColumnWidths(table)).toEqual(['1fr', '1fr', '1fr'])
    })

    test('setColumnWidths updates the style', () => {
      setColumnWidths(table, ['2fr', '1fr', '3fr'])
      expect(table.style.gridTemplateColumns).toBe('2fr 1fr 3fr')
    })
  })

  describe('cellIndex / rowOfCell / colOfCell', () => {
    test('cellIndex returns correct indices', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(cellIndex(cells[0])).toBe(0)
      expect(cellIndex(cells[4])).toBe(4)
      expect(cellIndex(cells[8])).toBe(8)
    })

    test('rowOfCell returns correct row', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(rowOfCell(cells[0], 3)).toBe(0)
      expect(rowOfCell(cells[3], 3)).toBe(1)
      expect(rowOfCell(cells[8], 3)).toBe(2)
    })

    test('colOfCell returns correct column', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(colOfCell(cells[0], 3)).toBe(0)
      expect(colOfCell(cells[1], 3)).toBe(1)
      expect(colOfCell(cells[5], 3)).toBe(2)
    })
  })

  describe('nextCell / prevCell', () => {
    test('nextCell returns next sibling', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(nextCell(cells[0])).toBe(cells[1])
    })

    test('nextCell returns null at end', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(nextCell(cells[8])).toBeNull()
    })

    test('prevCell returns previous sibling', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(prevCell(cells[1])).toBe(cells[0])
    })

    test('prevCell returns null at start', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(prevCell(cells[0])).toBeNull()
    })
  })

  describe('isHeaderCell', () => {
    test('first row cells are headers', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(isHeaderCell(cells[0])).toBe(true)
      expect(isHeaderCell(cells[2])).toBe(true)
    })

    test('other row cells are not headers', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      expect(isHeaderCell(cells[3])).toBe(false)
    })
  })

  describe('getCellsInRow / getCellsInCol / getRowCount', () => {
    test('getCellsInRow returns correct cells', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      const row1 = getCellsInRow(table, 1, 3)
      expect(row1).toEqual([cells[3], cells[4], cells[5]])
    })

    test('getCellsInCol returns correct cells', () => {
      const cells = Array.from(table.querySelectorAll('li')) as HTMLLIElement[]
      const col1 = getCellsInCol(table, 1, 3)
      expect(col1).toEqual([cells[1], cells[4], cells[7]])
    })

    test('getRowCount returns 3', () => {
      expect(getRowCount(table)).toBe(3)
    })
  })
})

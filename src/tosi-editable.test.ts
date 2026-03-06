import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { TosiEditable, tosiEditable } from './tosi-editable'

describe('TosiEditable', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  test('class exists', () => {
    expect(TosiEditable).toBeDefined()
  })

  test('elementCreator exists', () => {
    expect(tosiEditable).toBeDefined()
    expect(typeof tosiEditable).toBe('function')
  })

  test('has static formAssociated', () => {
    expect(TosiEditable.formAssociated).toBe(true)
  })

  test('has initAttributes', () => {
    expect(TosiEditable.initAttributes).toBeDefined()
    expect(TosiEditable.initAttributes.widgets).toBe('none')
    expect(TosiEditable.initAttributes.name).toBe('')
    expect(TosiEditable.initAttributes.required).toBe(false)
  })

  test('creates element', () => {
    const el = tosiEditable()
    expect(el).toBeInstanceOf(HTMLElement)
    expect(el.tagName.toLowerCase()).toBe('tosi-styled-editor')
  })

  test('creates element with initial content', () => {
    const el = tosiEditable({}, '<p>Hello</p>') as TosiEditable
    container.appendChild(el)
    // Content gets moved to doc on connectedCallback
    expect(el.parts.doc).not.toBeNull()
    expect(el.parts.doc.innerHTML).toContain('Hello')
  })

  test('has commands object', () => {
    const el = tosiEditable() as TosiEditable
    container.appendChild(el)
    expect(el.commands).toBeDefined()
    expect(typeof el.commands.setText).toBe('function')
    expect(typeof el.commands.setBlockType).toBe('function')
    expect(typeof el.commands.setBlocks).toBe('function')
    expect(typeof el.commands.setDebug).toBe('function')
  })

  test('has selectable after connection', () => {
    const el = tosiEditable({}, '<p>Test</p>') as TosiEditable
    container.appendChild(el)
    expect(el.selectable).toBeDefined()
  })

  test('doCommand method exists', () => {
    const el = tosiEditable() as TosiEditable
    container.appendChild(el)
    expect(typeof el.doCommand).toBe('function')
  })

  test('active defaults to true', () => {
    const el = tosiEditable() as TosiEditable
    container.appendChild(el)
    expect(el.active).toBe(true)
  })

  test('pastemode defaults to merge', () => {
    const el = tosiEditable() as TosiEditable
    container.appendChild(el)
    expect(el.pastemode).toBe('merge')
  })

  describe('touch affordances', () => {
    test('creates touch affordance elements in doc', () => {
      const el = tosiEditable({}, '<p>Test</p>') as TosiEditable
      container.appendChild(el)
      const affordances = el.parts.doc.querySelector('.touch-affordances')
      expect(affordances).not.toBeNull()
    })

    test('touch affordances contain three children', () => {
      const el = tosiEditable({}, '<p>Test</p>') as TosiEditable
      container.appendChild(el)
      const affordances = el.parts.doc.querySelector('.touch-affordances')!
      expect(affordances.children.length).toBe(3)
    })

    test('touch affordances have correct classes', () => {
      const el = tosiEditable({}, '<p>Test</p>') as TosiEditable
      container.appendChild(el)
      const doc = el.parts.doc
      expect(doc.querySelector('.touch-handle-start')).not.toBeNull()
      expect(doc.querySelector('.touch-context-menu')).not.toBeNull()
      expect(doc.querySelector('.touch-handle-end')).not.toBeNull()
    })

    test('touch affordances not visible without touch interaction', () => {
      const el = tosiEditable({}, '<p>Test</p>') as TosiEditable
      container.appendChild(el)
      // Without touch interaction, affordances should not be displayed as 'block'
      const affordances = el.parts.doc.querySelector('.touch-affordances') as HTMLElement
      expect(affordances.style.display).not.toBe('block')
    })

    test('touch affordances have do-not-spanify class', () => {
      const el = tosiEditable({}, '<p>Test</p>') as TosiEditable
      container.appendChild(el)
      const affordances = el.parts.doc.querySelector('.touch-affordances')!
      expect(affordances.classList.contains('do-not-spanify')).toBe(true)
    })
  })

  describe('value property', () => {
    test('get returns doc innerHTML', () => {
      const el = tosiEditable({}, '<p>Hello</p>') as TosiEditable
      container.appendChild(el)
      expect(el.value).toContain('Hello')
    })

    test('set updates doc innerHTML', () => {
      const el = tosiEditable() as TosiEditable
      container.appendChild(el)
      el.value = '<p>New content</p>'
      expect(el.parts.doc.innerHTML).toContain('New content')
    })
  })

  describe('block detection', () => {
    test('finds top-level block for nested node', () => {
      const el = tosiEditable() as TosiEditable
      container.appendChild(el)
      // Manually set up doc content for reliable testing
      el.parts.doc.innerHTML = '<p><b>Bold text</b></p>'
      const b = el.parts.doc.querySelector('b')!
      const block = el.block(b)
      expect(block).not.toBeNull()
      expect(block!.tagName).toBe('P')
    })
  })

  describe('insertionPoint', () => {
    test('returns caret input when present', () => {
      const el = tosiEditable() as TosiEditable
      container.appendChild(el)
      // Manually place caret in the doc
      el.parts.doc.innerHTML = '<p>Test</p>'
      const p = el.parts.doc.querySelector('p')!
      const caret = document.createElement('input')
      caret.className = 'sel-end caret'
      p.appendChild(caret)
      const ip = el.insertionPoint()
      expect(ip).not.toBeNull()
      expect(ip!.classList.contains('caret')).toBe(true)
    })
  })

  describe('selectedBlocks', () => {
    test('returns empty array when nothing selected', () => {
      const el = tosiEditable({}, '<p>Test</p>') as TosiEditable
      container.appendChild(el)
      // Clear any selection marks
      for (const mark of el.parts.doc.querySelectorAll('.selected-block')) {
        mark.classList.remove('selected-block')
      }
      expect(el.selectedBlocks().length).toBe(0)
    })
  })

  describe('undo/redo', () => {
    test('updateUndo initializes on first call', () => {
      const el = tosiEditable({}, '<p>Test</p>') as TosiEditable
      container.appendChild(el)
      // Undo was initialized in connectedCallback
      // Should not throw when called again
      el.updateUndo('new')
    })

    test('undo restores previous state', () => {
      const el = tosiEditable({}, '<p>Original</p>') as TosiEditable
      container.appendChild(el)

      // Make a change
      el.parts.doc.innerHTML = '<p>Changed</p>'
      el.updateUndo('new')

      // Undo
      el.updateUndo('undo')
      expect(el.parts.doc.innerHTML).toContain('Original')
    })

    test('redo restores undone state', () => {
      const el = tosiEditable({}, '<p>Original</p>') as TosiEditable
      container.appendChild(el)

      el.parts.doc.innerHTML = '<p>Changed</p>'
      el.updateUndo('new')

      el.updateUndo('undo')
      expect(el.parts.doc.innerHTML).toContain('Original')

      el.updateUndo('redo')
      expect(el.parts.doc.innerHTML).toContain('Changed')
    })
  })
})

import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { TosijsStyledEditor, tosijsStyledEditor } from './tosijs-styled-editor'

describe('TosijsStyledEditor', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  test('class exists', () => {
    expect(TosijsStyledEditor).toBeDefined()
  })

  test('elementCreator exists', () => {
    expect(tosijsStyledEditor).toBeDefined()
    expect(typeof tosijsStyledEditor).toBe('function')
  })

  test('has static formAssociated', () => {
    expect(TosijsStyledEditor.formAssociated).toBe(true)
  })

  test('has initAttributes', () => {
    expect(TosijsStyledEditor.initAttributes).toBeDefined()
    expect(TosijsStyledEditor.initAttributes.widgets).toBe('none')
    expect(TosijsStyledEditor.initAttributes.name).toBe('')
    expect(TosijsStyledEditor.initAttributes.required).toBe(false)
  })

  test('creates element', () => {
    const el = tosijsStyledEditor()
    expect(el).toBeInstanceOf(HTMLElement)
    expect(el.tagName.toLowerCase()).toBe('tosijs-styled-editor')
  })

  test('creates element with initial content', () => {
    const el = tosijsStyledEditor({}, '<p>Hello</p>') as TosijsStyledEditor
    container.appendChild(el)
    // Content gets moved to doc on connectedCallback
    expect(el.parts.doc).not.toBeNull()
    expect(el.parts.doc.innerHTML).toContain('Hello')
  })

  test('has commands object', () => {
    const el = tosijsStyledEditor() as TosijsStyledEditor
    container.appendChild(el)
    expect(el.commands).toBeDefined()
    expect(typeof el.commands.setText).toBe('function')
    expect(typeof el.commands.setBlockType).toBe('function')
    expect(typeof el.commands.setBlocks).toBe('function')
    expect(typeof el.commands.setDebug).toBe('function')
  })

  test('doCommand dispatches to custom commands added to editor.commands', () => {
    const el = tosijsStyledEditor() as TosijsStyledEditor
    container.appendChild(el)
    const calls: string[][] = []
    el.commands.custom = (_ctx, ...args) => {
      calls.push(args)
    }
    el.doCommand('custom alpha beta')
    expect(calls).toEqual([['alpha', 'beta']])
  })

  test('deleteSelection keeps a caret to type into', () => {
    const el = tosijsStyledEditor() as TosijsStyledEditor
    container.appendChild(el)
    const doc = el.parts.doc
    // The shape a word gesture leaves behind: the caret sits INSIDE the last
    // selected character, because resetBounds() derives bounds from .selected.
    doc.innerHTML =
      '<p class="selected-block first-block last-block">' +
      '<span class="spanified selected">E</span>' +
      '<span class="spanified selected">d</span>' +
      '<span class="spanified selected">i<input class="sel-end caret"></span>' +
      '<span class="spanified">t</span></p>'

    expect(doc.querySelector('input.caret')).not.toBeNull()
    el.deleteSelection()

    // Without a caret there is no insertion point, so typing silently does nothing
    expect(doc.querySelector('input.caret')).not.toBeNull()
    expect(doc.textContent).not.toContain('Edi')
  })

  test('has selectable after connection', () => {
    const el = tosijsStyledEditor({}, '<p>Test</p>') as TosijsStyledEditor
    container.appendChild(el)
    expect(el.selectable).toBeDefined()
  })

  test('doCommand method exists', () => {
    const el = tosijsStyledEditor() as TosijsStyledEditor
    container.appendChild(el)
    expect(typeof el.doCommand).toBe('function')
  })

  test('active defaults to true', () => {
    const el = tosijsStyledEditor() as TosijsStyledEditor
    container.appendChild(el)
    expect(el.active).toBe(true)
  })

  test('pastemode defaults to merge', () => {
    const el = tosijsStyledEditor() as TosijsStyledEditor
    container.appendChild(el)
    expect(el.pastemode).toBe('merge')
  })

  describe('touch affordances', () => {
    test('creates touch affordance elements in doc', () => {
      const el = tosijsStyledEditor({}, '<p>Test</p>') as TosijsStyledEditor
      container.appendChild(el)
      const affordances = el.parts.doc.querySelector('.touch-affordances')
      expect(affordances).not.toBeNull()
    })

    test('touch affordances contain three children', () => {
      const el = tosijsStyledEditor({}, '<p>Test</p>') as TosijsStyledEditor
      container.appendChild(el)
      const affordances = el.parts.doc.querySelector('.touch-affordances')!
      expect(affordances.children.length).toBe(3)
    })

    test('touch affordances have correct classes', () => {
      const el = tosijsStyledEditor({}, '<p>Test</p>') as TosijsStyledEditor
      container.appendChild(el)
      const doc = el.parts.doc
      expect(doc.querySelector('.touch-handle-start')).not.toBeNull()
      expect(doc.querySelector('.touch-context-menu')).not.toBeNull()
      expect(doc.querySelector('.touch-handle-end')).not.toBeNull()
    })

    test('touch affordances not visible without touch interaction', () => {
      const el = tosijsStyledEditor({}, '<p>Test</p>') as TosijsStyledEditor
      container.appendChild(el)
      // Without touch interaction, affordances should not be displayed as 'block'
      const affordances = el.parts.doc.querySelector(
        '.touch-affordances'
      ) as HTMLElement
      expect(affordances.style.display).not.toBe('block')
    })

    test('touch affordances have do-not-spanify class', () => {
      const el = tosijsStyledEditor({}, '<p>Test</p>') as TosijsStyledEditor
      container.appendChild(el)
      const affordances = el.parts.doc.querySelector('.touch-affordances')!
      expect(affordances.classList.contains('do-not-spanify')).toBe(true)
    })
  })

  describe('value property', () => {
    test('get returns doc innerHTML', () => {
      const el = tosijsStyledEditor({}, '<p>Hello</p>') as TosijsStyledEditor
      container.appendChild(el)
      expect(el.value).toContain('Hello')
    })

    test('set updates doc innerHTML', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.value = '<p>New content</p>'
      expect(el.parts.doc.innerHTML).toContain('New content')
    })
  })

  describe('block detection', () => {
    test('finds top-level block for nested node', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
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
      const el = tosijsStyledEditor() as TosijsStyledEditor
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
      const el = tosijsStyledEditor({}, '<p>Test</p>') as TosijsStyledEditor
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
      const el = tosijsStyledEditor({}, '<p>Test</p>') as TosijsStyledEditor
      container.appendChild(el)
      // Undo was initialized in connectedCallback
      // Should not throw when called again
      el.updateUndo('new')
    })

    test('undo restores previous state', () => {
      const el = tosijsStyledEditor({}, '<p>Original</p>') as TosijsStyledEditor
      container.appendChild(el)

      // Make a change
      el.parts.doc.innerHTML = '<p>Changed</p>'
      el.updateUndo('new')

      // Undo
      el.updateUndo('undo')
      expect(el.parts.doc.innerHTML).toContain('Original')
    })

    test('redo restores undone state', () => {
      const el = tosijsStyledEditor({}, '<p>Original</p>') as TosijsStyledEditor
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

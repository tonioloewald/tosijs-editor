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

  describe('typing across a direction boundary', () => {
    function editorWith(html: string) {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = html
      return el
    }
    // contentKey is private; typing goes through the keypress handler
    function type(el: TosijsStyledEditor, key: string) {
      const caret = el.parts.doc.querySelector('input.caret')!
      caret.dispatchEvent(
        new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key })
      )
    }

    test('an LTR run typed into an RTL block gets its own isolate', () => {
      const el = editorWith('<p dir="rtl">x<input class="sel-end caret"></p>')
      type(el, 'a')
      const isolate = el.parts.doc.querySelector('span[dir="ltr"]')
      expect(isolate).not.toBeNull()
      // Both the text AND the caret must be inside it, or the caret still
      // resolves against the block and lands on the wrong side.
      expect(isolate!.textContent).toContain('a')
      expect(isolate!.querySelector('input.caret')).not.toBeNull()
    })

    test('consecutive characters extend one isolate, not one each', () => {
      const el = editorWith('<p dir="rtl">x<input class="sel-end caret"></p>')
      for (const key of ['a', 'b', 'c']) type(el, key)
      expect(el.parts.doc.querySelectorAll('span[dir="ltr"]').length).toBe(1)
      expect(
        el.parts.doc.querySelector('span[dir="ltr"]')!.textContent
      ).toContain('abc')
    })

    test('text agreeing with its block is left alone', () => {
      const el = editorWith('<p>x<input class="sel-end caret"></p>')
      type(el, 'a')
      expect(el.parts.doc.querySelector('span[dir]')).toBeNull()
    })

    test('RTL typed into an RTL block needs no isolate', () => {
      const el = editorWith('<p dir="rtl">x<input class="sel-end caret"></p>')
      type(el, '\u0627')
      expect(el.parts.doc.querySelector('span[dir]')).toBeNull()
    })

    test('neutral characters take the run they land in', () => {
      const el = editorWith('<p dir="rtl">x<input class="sel-end caret"></p>')
      type(el, '1')
      type(el, ' ')
      expect(el.parts.doc.querySelector('span[dir]')).toBeNull()
    })
  })

  describe('drag and drop editing', () => {
    function editorWith(html: string) {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = html
      return el
    }
    function transfer(data: Record<string, string> = {}) {
      const store: Record<string, string> = { ...data }
      return {
        files: [] as File[],
        effectAllowed: '',
        dropEffect: '',
        setData(type: string, value: string) {
          store[type] = value
        },
        getData: (type: string) => store[type] || '',
      }
    }
    function fire(el: TosijsStyledEditor, type: string, init: any = {}) {
      const evt: any = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(evt, init)
      ;(init.target || el.parts.doc).dispatchEvent(evt)
      return evt
    }

    test('the selection becomes a draggable object offering both types', () => {
      // plain text: markNode wraps it, which is what happens in real use.
      // (A bare <span class="selected"> would be UNWRAPPED by unmark(), since
      // removing the class leaves it with no attributes at all.)
      const el = editorWith('<p>hi</p>')
      const p = el.parts.doc.querySelector('p')!
      el.selectable.markRange(p, p)
      const dragged = el.parts.doc.querySelector('[draggable]')
      expect(dragged).not.toBeNull()
      expect(dragged!.getAttribute('data-drag')).toContain('text/html')
      expect(dragged!.getAttribute('data-drag')).toContain('text/plain')
    })

    test('dragstart offers styled AND plain representations', () => {
      const el = editorWith('<p><span class="selected"><b>bold</b></span></p>')
      const dt = transfer()
      fire(el, 'dragstart', { dataTransfer: dt })
      expect(dt.getData('text/html')).toContain('<b>')
      expect(dt.getData('text/plain')).toBe('bold')
      expect(dt.effectAllowed).toBe('copyMove')
    })

    test('an internal drop MOVES: the source is gone', () => {
      const el = editorWith(
        '<p><span class="selected">move me</span></p><p>here<input class="sel-end caret"></p>'
      )
      fire(el, 'dragstart', { dataTransfer: transfer() })
      fire(el, 'drop', {
        dataTransfer: transfer({ 'text/plain': 'move me' }),
        altKey: false,
      })
      // one copy only — the original was removed
      expect(el.parts.doc.textContent!.split('move me').length - 1).toBe(1)
    })

    test('alt makes an internal drop COPY: both remain', () => {
      const el = editorWith(
        '<p><span class="selected">copy me</span></p><p>here<input class="sel-end caret"></p>'
      )
      fire(el, 'dragstart', { dataTransfer: transfer() })
      fire(el, 'drop', {
        dataTransfer: transfer({ 'text/plain': 'copy me' }),
        altKey: true,
      })
      expect(el.parts.doc.textContent!.split('copy me').length - 1).toBe(2)
    })

    test('dragend never deletes — leaving the editor is a copy', () => {
      const el = editorWith('<p><span class="selected">keep me</span></p>')
      fire(el, 'dragstart', { dataTransfer: transfer() })
      // no drop here: the drag landed in another window
      fire(el, 'dragend', {})
      expect(el.parts.doc.textContent).toContain('keep me')
      expect(el.parts.doc.querySelector('[draggable]')).toBeNull()
    })

    test('dropping a selection onto itself does nothing', () => {
      const el = editorWith(
        '<p><span class="selected">self<input class="sel-end caret"></span></p>'
      )
      fire(el, 'dragstart', { dataTransfer: transfer() })
      fire(el, 'drop', { dataTransfer: transfer({ 'text/plain': 'self' }) })
      expect(el.parts.doc.textContent).toContain('self')
    })

    test('the doc declares what it accepts', () => {
      const el = editorWith('<p>x</p>')
      const accepts = el.parts.doc.getAttribute('data-drop') || ''
      for (const type of ['text/html', 'text/plain', 'Files']) {
        expect(accepts).toContain(type)
      }
    })
  })

  describe('the caret is painted, not inserted', () => {
    function editor() {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      return el
    }

    test('markers in the text are inert spans, never replaced elements', () => {
      const el = editor()
      el.parts.doc.innerHTML = '<p>hello</p>'
      const bounds = el.selectable.createBounds()
      const markers = [...bounds.childNodes] as Element[]
      // an <input> here is a REPLACED element: it breaks the shaping run and
      // tears cursive scripts apart around the caret
      for (const m of markers) expect(m.tagName).toBe('SPAN')
      expect(markers.some((m) => m.classList.contains('sel-start'))).toBe(true)
      expect(markers.some((m) => m.classList.contains('caret'))).toBe(true)
    })

    test('resetBounds also creates spans', () => {
      const el = editor()
      el.parts.doc.innerHTML = '<p><span class="selected">hi</span></p>'
      el.selectable.resetBounds()
      const markers = el.parts.doc.querySelectorAll('.sel-start, .sel-end')
      expect(markers.length).toBeGreaterThan(0)
      for (const m of markers) expect(m.tagName).toBe('SPAN')
    })

    test('the overlay is a sibling of the doc, not a child of it', () => {
      const el = editor()
      // a child of [part=doc] is styled as a document BLOCK and shows up in
      // selectedBlocks(), block() and arrow navigation
      expect(el.parts.caret.parentElement).not.toBe(el.parts.doc)
      expect(el.parts.doc.contains(el.parts.caret)).toBe(false)
      expect(el.parts.doc.contains(el.parts.edgeStart)).toBe(false)
    })

    test('the overlay never leaks into value', () => {
      const el = editor()
      el.parts.doc.innerHTML = '<p>content</p>'
      expect(el.value).toContain('content')
      expect(el.value).not.toContain('part="caret"')
      expect(el.value).not.toContain('selection-edge')
    })

    test('bounds changes notify the component so the caret can be repainted', () => {
      const el = editor()
      el.parts.doc.innerHTML = '<p>hello</p>'
      let repaints = 0
      const previous = el.selectable.onBoundsChanged
      el.selectable.onBoundsChanged = () => {
        repaints += 1
        previous?.()
      }
      el.selectable.removeBounds()
      // painted from the markers' positions, so it must repaint when they move
      expect(repaints).toBeGreaterThan(0)
    })
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

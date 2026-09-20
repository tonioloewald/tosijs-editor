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
    // This test used to build its own `<input class="sel-end caret">` and then
    // assert the selector found it. That passes whatever the editor actually
    // does — so when the markers stopped being `<input>` elements, the selector
    // `input.caret` silently matched nothing, insertionPoint() returned null
    // forever, and every command that inserts at the caret quietly did nothing.
    // The test stayed green throughout. Use the REAL bounds, not a fixture.
    test('finds the caret the selection system actually creates', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>Test</p>'
      const p = el.parts.doc.querySelector('p')!
      p.appendChild(el.selectable.createBounds())

      const ip = el.insertionPoint()
      expect(ip).not.toBeNull()
      expect(ip!.classList.contains('caret')).toBe(true)
      expect(el.parts.doc.contains(ip)).toBe(true)
    })

    test('commands that insert at the caret find one', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>Test</p>'
      const p = el.parts.doc.querySelector('p')!
      p.appendChild(el.selectable.createBounds())

      // insertTable bails out on a null insertion point, so reaching the DOM at
      // all is the assertion: this is what was silently broken.
      el.doCommand('insertTable')
      expect(el.parts.doc.querySelector('ul.editor-table')).not.toBeNull()
    })
  })

  describe('pasted and dropped content is sanitized', () => {
    // The component replaced contentEditable but not the sanitization the
    // browser was doing on its behalf. Pasted HTML reaches the live document,
    // `value`, `internals.setFormValue` and every undo snapshot — so an
    // unsanitized payload is stored, re-served, and re-fired on undo.
    const pasteInto = (el: TosijsStyledEditor, html: string): void => {
      el.parts.doc.innerHTML = '<p>Target</p>'
      const p = el.parts.doc.querySelector('p')!
      p.appendChild(el.selectable.createBounds())
      const data = {
        getData: (type: string) => (type === 'text/html' ? html : 'plain'),
        types: ['text/html', 'text/plain'],
      }
      const evt = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(evt, 'clipboardData', { value: data })
      el.parts.doc.dispatchEvent(evt)
    }

    test('strips handlers and javascript: URLs from pasted HTML', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      pasteInto(
        el,
        '<img src="x" onerror="boom()"><a href="javascript:boom()">x</a><script>boom()<\/script>'
      )
      const html = el.value
      expect(html).not.toMatch(/onerror/i)
      expect(html).not.toMatch(/javascript:/i)
      expect(el.parts.doc.querySelectorAll('script').length).toBe(0)
    })

    test('keeps ordinary formatting and unknown plugin elements', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      pasteInto(el, '<b>bold</b> <x-plugin data-k="1">plugin</x-plugin>')
      const html = el.value
      expect(html).toMatch(/<b>bold<\/b>/)
      expect(html).toMatch(/x-plugin/)
      expect(html).toMatch(/plugin/)
    })

    test('a handler cannot survive into an undo snapshot', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      pasteInto(el, '<img src="x" onerror="boom()" data-probe="1">')
      el.doCommand('updateUndo new')
      el.doCommand('updateUndo undo')
      expect(el.value).not.toMatch(/onerror/i)
    })
  })

  describe('the sanitizer is swappable', () => {
    test('a host can replace it, and replacing it takes effect', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      const seen: string[] = []
      el.sanitize = (root: Element) => {
        seen.push(root.innerHTML)
        root.querySelectorAll('b').forEach((b) => b.remove())
      }
      el.parts.doc.innerHTML = '<p>T</p>'
      const p = el.parts.doc.querySelector('p')!
      p.appendChild(el.selectable.createBounds())
      const data = {
        getData: (t: string) => (t === 'text/html' ? '<b>gone</b><i>kept</i>' : 'x'),
        types: ['text/html'],
      }
      const evt = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(evt, 'clipboardData', { value: data })
      el.parts.doc.dispatchEvent(evt)

      expect(seen.length).toBe(1)
      expect(seen[0]).toMatch(/<b>gone<\/b>/)
      expect(el.value).not.toMatch(/<b>/)
      expect(el.value).toMatch(/<i>kept<\/i>/)
    })
  })

  describe('footnotes maintain themselves', () => {
    // The bug this element exists to fix: renumberFootnotes was correct all
    // along, but only ever ran at INSERTION time. Deleting a reference left its
    // text orphaned in the list and the survivors mis-numbered. Lifecycle is
    // the missing caller.
    const editorWithTwoFootnotes = (): TosijsStyledEditor => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>one two three</p>'
      const p = el.parts.doc.querySelector('p')!
      const text = p.firstChild as Text
      // two markers, in document order
      const mid = document.createElement('span')
      mid.className = 'sel-end caret'
      text.parentNode!.appendChild(mid)
      el.doCommand('insertFootnote First')
      el.doCommand('insertFootnote Second')
      return el
    }

    const flush = async () => {
      await Promise.resolve()
      await Promise.resolve()
    }

    test('two footnotes number 1 and 2', async () => {
      const el = editorWithTwoFootnotes()
      await flush()
      const nums = [...el.parts.doc.querySelectorAll('tosi-footnote a')].map(
        (a) => a.textContent
      )
      expect(nums).toEqual(['1', '2'])
      expect(el.parts.doc.querySelectorAll('li.footnote').length).toBe(2)
    })

    test('deleting a reference removes its entry and renumbers — no command run', async () => {
      const el = editorWithTwoFootnotes()
      await flush()
      // remove the FIRST marker the way an edit would, and run nothing else
      el.parts.doc.querySelector('tosi-footnote')!.remove()
      await flush()

      expect(el.parts.doc.querySelectorAll('tosi-footnote').length).toBe(1)
      // the orphan is gone
      expect(el.parts.doc.querySelectorAll('li.footnote').length).toBe(1)
      // and the survivor renumbered from 2 to 1
      expect(el.parts.doc.querySelector('tosi-footnote a')!.textContent).toBe('1')
      expect(el.parts.doc.querySelector('li.footnote')!.textContent).toContain(
        'Second'
      )
    })

    test('undo restores both without the disconnect eating an entry', async () => {
      const el = editorWithTwoFootnotes()
      await flush()
      el.doCommand('updateUndo new')
      el.parts.doc.querySelector('tosi-footnote')!.remove()
      await flush()
      el.doCommand('updateUndo new')

      el.doCommand('updateUndo undo')
      await flush()
      // innerHTML replacement disconnects every marker and reconnects its
      // replacement; a synchronous reconcile would have deleted entries whose
      // markers were about to come back.
      expect(el.parts.doc.querySelectorAll('li.footnote').length).toBe(2)
    })
  })

  describe('spell checking', () => {
    // The point is not the squiggle — browsers draw that for free. It is that
    // the application can ASK, which no contentEditable editor can.
    const editorWith = (html: string, wrong: string[]): TosijsStyledEditor => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = html
      const bad = new Set(wrong)
      el.spellChecker = (words) => new Set(words.filter((w) => bad.has(w)))
      return el
    }

    test('marks what the checker rejects, and nothing else', async () => {
      const el = editorWith('<p>the quick borwn fox</p>', ['borwn'])
      const errors = await el.checkSpelling()
      expect(errors.length).toBe(1)
      expect(errors[0].word).toBe('borwn')
      expect(el.parts.doc.querySelectorAll('tosi-misspelling').length).toBe(1)
      expect(el.parts.doc.textContent).toBe('the quick borwn fox')
    })

    test('the query the browser refuses to answer', async () => {
      const el = editorWith('<p>teh quick borwn fox</p>', ['teh', 'borwn'])
      await el.checkSpelling()
      expect(el.spellingErrors.map((e) => e.word)).toEqual(['teh', 'borwn'])
    })

    test('ignoring a word drops its marks and clears the errors', async () => {
      // The FORM VALIDITY half of this cannot be asserted here: happy-dom does
      // not implement attachInternals(), so `this.internals` is undefined and
      // setValidity is never reached. It is verified in a real browser instead
      // — see the spelling fence in this file's doc comment.
      const el = editorWith('<p>borwn fox</p>', ['borwn'])
      await el.checkSpelling()
      expect(el.spellingErrors.length).toBe(1)

      el.ignoreWord('borwn')
      expect(el.spellingErrors.length).toBe(0)
      expect(el.parts.doc.textContent).toBe('borwn fox')

      // and it stays ignored on the next check
      await el.checkSpelling()
      expect(el.spellingErrors.length).toBe(0)
    })

    test('marks never reach value, the form value, or undo', async () => {
      const el = editorWith('<p>borwn fox</p>', ['borwn'])
      await el.checkSpelling()
      expect(el.parts.doc.querySelectorAll('tosi-misspelling').length).toBe(1)
      // the mark is visible in the document but absent from the serialization
      expect(el.value).not.toMatch(/tosi-misspelling/)
      expect(el.value).toContain('borwn fox')
      // and reading value did not disturb what the user sees
      expect(el.parts.doc.querySelectorAll('tosi-misspelling').length).toBe(1)
    })

    // Accepting is the OTHER half of the workflow, and in a jargon-heavy domain
    // it is the common half: the usual answer to an unknown word is "that is a
    // real word", not "I mistyped". The two scopes exist because they have
    // different lifetimes - a contract's defined terms belong to that document,
    // a firm's terms of art belong to the user.
    test('document scope accepts a word here only', async () => {
      const el = editorWith('<p>indemnitor pays</p>', ['indemnitor'])
      await el.checkSpelling()
      expect(el.spellingErrors.length).toBe(1)

      el.acceptWord('indemnitor', 'document')
      expect(el.spellingErrors.length).toBe(0)
      expect(el.documentWords.has('indemnitor')).toBe(true)
      expect(el.userDictionary.has('indemnitor')).toBe(false)

      await el.checkSpelling()
      expect(el.spellingErrors.length).toBe(0)
    })

    test('dictionary scope accepts it everywhere', async () => {
      const el = editorWith('<p>indemnitor pays</p>', ['indemnitor'])
      await el.checkSpelling()
      el.acceptWord('indemnitor', 'dictionary')

      expect(el.userDictionary.has('indemnitor')).toBe(true)
      expect(el.documentWords.has('indemnitor')).toBe(false)

      // a different document, same user dictionary
      const other = editorWith('<p>the indemnitor again</p>', ['indemnitor'])
      other.userDictionary = el.userDictionary
      await other.checkSpelling()
      expect(other.spellingErrors.length).toBe(0)
    })

    test('the host is told what to persist, and where', async () => {
      const el = editorWith('<p>indemnitor and lessor</p>', [
        'indemnitor',
        'lessor',
      ])
      const persisted: Array<[string, string]> = []
      el.onWordAccepted = (word, scope) => persisted.push([word, scope])
      await el.checkSpelling()

      el.acceptWord('indemnitor', 'document')
      el.acceptWord('lessor', 'dictionary')
      expect(persisted).toEqual([
        ['indemnitor', 'document'],
        ['lessor', 'dictionary'],
      ])
    })

    test('accepting one word leaves the others unresolved', async () => {
      const el = editorWith('<p>indemnitor borwn lessor</p>', [
        'indemnitor',
        'borwn',
        'lessor',
      ])
      await el.checkSpelling()
      expect(el.spellingErrors.length).toBe(3)

      el.acceptWord('indemnitor', 'document')
      el.acceptWord('lessor', 'dictionary')
      // the actual typo is still flagged - accepting jargon must not launder it
      expect(el.spellingErrors.map((e) => e.word)).toEqual(['borwn'])
    })

    test('re-checking converges rather than accumulating', async () => {
      const el = editorWith('<p>borwn borwn</p>', ['borwn'])
      await el.checkSpelling()
      await el.checkSpelling()
      await el.checkSpelling()
      expect(el.parts.doc.querySelectorAll('tosi-misspelling').length).toBe(2)
      expect(el.parts.doc.textContent).toBe('borwn borwn')
    })

    test('the checker is asked once per DISTINCT word', async () => {
      const el = editorWith('<p>a a a b b c</p>', [])
      const asked: string[][] = []
      el.spellChecker = (words) => {
        asked.push(words)
        return new Set<string>()
      }
      await el.checkSpelling()
      expect(asked.length).toBe(1)
      expect([...asked[0]].sort()).toEqual(['a', 'b', 'c'])
    })

    test('code is not spell checked', async () => {
      const el = editorWith('<p>fix <code>borwn</code> now</p>', ['borwn'])
      const errors = await el.checkSpelling()
      expect(errors.length).toBe(0)
    })

    // THE CONTAINER CASE — the thing EXTENSIBILITY.md flagged as untested.
    test('text inside a mark is still ordinary editable content', async () => {
      const el = editorWith('<p>the borwn fox</p>', ['borwn'])
      await el.checkSpelling()
      const mark = el.parts.doc.querySelector('tosi-misspelling')!

      // the editor's own traversal sees the word — it is not opaque
      const walker = document.createTreeWalker(el.parts.doc, NodeFilter.SHOW_TEXT)
      const texts: string[] = []
      let n: Node | null
      while ((n = walker.nextNode())) texts.push((n as Text).data)
      expect(texts.join('')).toBe('the borwn fox')

      // editing inside it works, and clearing leaves the correction intact
      const inner = mark.firstChild as Text
      inner.data = 'brown'
      el.clearSpelling()
      expect(el.parts.doc.textContent).toBe('the brown fox')
      expect(el.parts.doc.querySelectorAll('tosi-misspelling').length).toBe(0)
    })

    test('clearing a mark leaves no stray text nodes behind', async () => {
      const el = editorWith('<p>the borwn fox</p>', ['borwn'])
      await el.checkSpelling()
      el.clearSpelling()
      const p = el.parts.doc.querySelector('p')!
      expect(p.childNodes.length).toBe(1)
      expect(p.firstChild!.nodeType).toBe(3)
    })
  })

  describe('tracked changes', () => {
    const editorWith = (html: string): TosijsStyledEditor => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = html
      return el
    }
    const llm = { id: 'model', name: 'Proofreader' }

    test('a revision that changes nothing touches nothing', async () => {
      const el = editorWith('<p>the quick brown fox</p>')
      const before = el.value
      const n = await el.reviseWith((t) => t, llm)
      expect(n).toBe(0)
      expect(el.value).toBe(before)
      expect(el.changes.length).toBe(0)
    })

    test('a word swap becomes one deletion and one insertion', async () => {
      const el = editorWith('<p>the quick brown fox</p>')
      const n = await el.reviseWith((t) => t.replace('quick', 'nimble'), llm)
      expect(n).toBe(2)

      const kinds = el.changes.map((c) => c.kind).sort()
      expect(kinds).toEqual(['delete', 'insert'])
      expect(el.changes.every((c) => c.author === 'model')).toBe(true)
      expect(el.changes.every((c) => c.authorName === 'Proofreader')).toBe(true)
      // both readings are present in the document until someone decides
      expect(el.parts.doc.textContent).toContain('quick')
      expect(el.parts.doc.textContent).toContain('nimble')
    })

    test('accepting takes the revision, rejecting keeps the original', async () => {
      const revise = (t: string) => t.replace('quick', 'nimble')

      const accepted = editorWith('<p>the quick brown fox</p>')
      await accepted.reviseWith(revise, llm)
      accepted.acceptChanges()
      expect(accepted.parts.doc.querySelector('p')!.textContent).toBe(
        'the nimble brown fox'
      )
      expect(accepted.changes.length).toBe(0)

      const rejected = editorWith('<p>the quick brown fox</p>')
      await rejected.reviseWith(revise, llm)
      rejected.rejectChanges()
      expect(rejected.parts.doc.querySelector('p')!.textContent).toBe(
        'the quick brown fox'
      )
      expect(rejected.changes.length).toBe(0)
    })

    test('changes are resolved one at a time, by id', async () => {
      const el = editorWith('<p>teh quick borwn fox</p>')
      await el.reviseWith(
        (t) => t.replace('teh', 'the').replace('borwn', 'brown'),
        llm
      )
      expect(el.changes.length).toBe(4)

      // accept the first correction only
      const firstInsert = el.changes.find(
        (c) => c.kind === 'insert' && c.text.includes('the')
      )!
      el.acceptChanges(firstInsert.id)
      const firstDelete = el.changes.find(
        (c) => c.kind === 'delete' && c.text.includes('teh')
      )!
      el.acceptChanges(firstDelete.id)

      // the other correction is still pending
      expect(el.changes.length).toBe(2)
      expect(el.parts.doc.textContent).toContain('the quick')
      expect(el.parts.doc.textContent).toContain('borwn')
    })

    test('what a model returns is TEXT, never markup', async () => {
      const el = editorWith('<p>hello world</p>')
      await el.reviseWith(() => 'hello <img src=x onerror="boom()"> world', llm)
      // no element was created from the response
      expect(el.parts.doc.querySelector('img')).toBeNull()
      expect(el.value).not.toMatch(/<img/)
      // the characters survive as literal text, visible for review
      expect(el.parts.doc.textContent).toContain('<img')
    })

    test('text already under review is not revised again', async () => {
      const el = editorWith('<p>the quick brown fox</p>')
      await el.reviseWith((t) => t.replace('quick', 'nimble'), llm)
      const after = el.changes.length
      // a second pass must not mark up the marks
      await el.reviseWith((t) => t.replace('nimble', 'swift'), llm)
      expect(el.changes.length).toBe(after)
    })

    test('tracked text inside a mark is still editable content', async () => {
      const el = editorWith('<p>the quick brown fox</p>')
      await el.reviseWith((t) => t.replace('quick', 'nimble'), llm)
      const ins = el.parts.doc.querySelector('tosi-ins')!
      // a reviewer can adjust a proposal before accepting it
      ;(ins.firstChild as Text).data = ' agile'
      el.acceptChanges()
      expect(el.parts.doc.querySelector('p')!.textContent).toBe(
        'the agile brown fox'
      )
    })

    test('changes survive serialization — a tracked document is a document', async () => {
      const el = editorWith('<p>the quick brown fox</p>')
      await el.reviseWith((t) => t.replace('quick', 'nimble'), llm)
      const html = el.value
      expect(html).toMatch(/tosi-ins/)
      expect(html).toMatch(/data-author="model"/)

      const reopened = editorWith(html)
      expect(reopened.changes.length).toBe(2)
      expect(reopened.changes[0].author).toBe('model')
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

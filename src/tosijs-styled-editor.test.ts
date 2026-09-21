import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { TosijsStyledEditor, tosijsStyledEditor } from './tosijs-styled-editor'
import { changeId, diffWords, MAX_DIFF_TOKENS } from './changes'

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
        '<img src="x" onerror="boom()"><a href="javascript:boom()">x</a><script>boom()</script>'
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
        getData: (t: string) =>
          t === 'text/html' ? '<b>gone</b><i>kept</i>' : 'x',
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
      expect(el.parts.doc.querySelector('tosi-footnote a')!.textContent).toBe(
        '1'
      )
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

    test('accepting a word drops its marks and clears the errors', async () => {
      // The form-validity half is asserted separately, with a recording
      // `internals` stub — see 'an unresolved misspelling makes the field
      // invalid'. (This comment used to claim verification by a browser fence
      // that did not exist, which is worse than no coverage: it stops the next
      // reader looking.)
      const el = editorWith('<p>borwn fox</p>', ['borwn'])
      await el.checkSpelling()
      expect(el.spellingErrors.length).toBe(1)

      el.acceptWord('borwn')
      expect(el.spellingErrors.length).toBe(0)
      expect(el.parts.doc.textContent).toBe('borwn fox')

      // and it stays accepted on the next check
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

    // happy-dom ships no attachInternals(), so `this.internals` is undefined
    // and the ENTIRE payoff of formAssociated — an unresolved spelling error
    // blocking a real form submit — went unasserted, with a comment claiming
    // a browser check that does not exist. `internals` is a public optional
    // field on the tosijs base, so a recording stub makes it assertable here.
    interface ValidityCall {
      flags: ValidityStateFlags
      message?: string
    }
    const withInternals = (el: TosijsStyledEditor): ValidityCall[] => {
      const calls: ValidityCall[] = []
      el.internals = {
        setValidity: (flags: ValidityStateFlags, message?: string) => {
          calls.push({ flags, message })
        },
        setFormValue: () => {},
      } as unknown as ElementInternals
      return calls
    }

    test('an unresolved misspelling makes the field invalid', async () => {
      const el = editorWith('<p>borwn fox</p>', ['borwn'])
      const calls = withInternals(el)
      await el.checkSpelling()
      const last = calls[calls.length - 1]
      expect(last.flags.customError).toBe(true)
      expect(last.message).toContain('borwn')
    })

    test('accepting the word clears the invalidity', async () => {
      const el = editorWith('<p>indemnitor pays</p>', ['indemnitor'])
      const calls = withInternals(el)
      await el.checkSpelling()
      el.acceptWord('indemnitor', 'dictionary')
      expect(calls[calls.length - 1].flags.customError).toBeFalsy()
    })

    test('replacing the document does not leave a stale spelling error', async () => {
      // The message named a word that was no longer in the document and was
      // anchored to a detached node, with no way for the user to see why the
      // form would not submit. undo, redo, `value =` and form reset all go
      // through the same setter, so all four were affected.
      const el = editorWith('<p>borwn fox</p>', ['borwn'])
      const calls = withInternals(el)
      await el.checkSpelling()
      expect(calls[calls.length - 1].flags.customError).toBe(true)

      el.value = '<p>brown fox</p>'
      expect(calls[calls.length - 1].flags.customError).toBeFalsy()
      expect(el.spellingErrors.length).toBe(0)
    })

    test('a second check does not mark up a document that moved on', async () => {
      // The checker is awaited, so the document can change underneath it.
      // Nothing that crosses the await is a live node reference; the hits are
      // re-derived against the document as it is when the answer arrives.
      const el = editorWith('<p>alpha here</p>', [])
      let release: (v: Set<string>) => void = () => {}
      el.spellChecker = () =>
        new Promise<Set<string>>((resolve) => {
          release = resolve
        })
      const pending = el.checkSpelling()
      el.parts.doc.innerHTML = '<p>beta here</p>'
      release(new Set(['beta']))
      const errors = await pending

      // marked against the CURRENT document, not the one we walked before
      expect(errors.map((e) => e.word)).toEqual(['beta'])
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('beta here')
    })

    // A CARET INSIDE A WORD is the commonest thing a caret does, and the
    // markers are real elements, so they split the text node. There is no blur
    // handler anywhere: one click leaves a marker in the text indefinitely.
    const caretAfter = (el: TosijsStyledEditor, chars: number): void => {
      const p = el.parts.doc.querySelector('p')!
      const text = p.firstChild as Text
      const marker = document.createElement('span')
      marker.className = 'sel-end caret'
      const range = document.createRange()
      range.setStart(text, chars)
      range.collapse(true)
      range.insertNode(marker)
      // the precondition: the word really is split across two text nodes
      expect(p.childNodes.length).toBeGreaterThan(1)
    }

    test('a caret inside a word does not make that word misspelled', async () => {
      const el = editorWith('<p>the brown fox</p>', [])
      const asked: string[][] = []
      el.spellChecker = (words) => {
        asked.push([...words])
        // a checker that knows only real words: anything else is "wrong"
        const real = new Set(['the', 'brown', 'fox'])
        return new Set(words.filter((w) => !real.has(w)))
      }
      caretAfter(el, 6) // "the br|own fox"

      const errors = await el.checkSpelling()
      expect(asked[0].sort()).toEqual(['brown', 'fox', 'the'])
      expect(errors.map((e) => e.word)).toEqual([])
    })

    test('the caret survives the check it did not break', async () => {
      const el = editorWith('<p>the brown fox</p>', ['brown'])
      caretAfter(el, 6)
      await el.checkSpelling()
      // still exactly one caret, still inside the word, text intact
      expect(el.parts.doc.querySelectorAll('.sel-end').length).toBe(1)
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('the brown fox')
      expect(el.spellingErrors.map((e) => e.word)).toEqual(['brown'])
    })

    test('deleted text is not spell checked', async () => {
      // Flagging a typo inside a <tosi-del> makes it unfixable: the word is
      // on its way out, and the only way to clear the flag would be to accept
      // the typo into the dictionary.
      const el = editorWith('<p><tosi-del>teh</tosi-del>the fox</p>', ['teh'])
      const errors = await el.checkSpelling()
      expect(errors.map((e) => e.word)).toEqual([])
    })

    // ADJACENT marks are the routine case, not an exotic one. Range.insertNode
    // leaves an empty text node between two marks, and any normalize() — which
    // Selectable runs on nearly every edit path — collapses it, leaving the
    // marks as direct siblings. Reading `value` then has to put back a mark
    // whose saved anchor is ANOTHER mark that is itself still unwrapped.
    test('two ADJACENT marks survive a read of value', async () => {
      const el = editorWith('<p>teh borwn fox</p>', ['teh', 'borwn'])
      await el.checkSpelling()
      // delete the space between them, as one Backspace would
      const p = el.parts.doc.querySelector('p')!
      const marks0 = [...p.querySelectorAll('tosi-misspelling')]
      marks0[0].nextSibling!.remove()
      el.parts.doc.normalize()
      // the precondition this test is ABOUT: they are now direct siblings
      expect(marks0[0].nextSibling).toBe(marks0[1])
      expect(el.parts.doc.querySelectorAll('tosi-misspelling').length).toBe(2)

      const html = el.value
      expect(html).not.toMatch(/tosi-misspelling/)
      expect(html).toContain('tehborwn fox')
      // the marks are still there, still in the right order, still wrapping
      // the right words — reading a value must not edit the document
      const marks = [...el.parts.doc.querySelectorAll('tosi-misspelling')]
      expect(marks.map((m) => m.textContent)).toEqual(['teh', 'borwn'])
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('tehborwn fox')
    })

    test('a run of marks with no spaces between them survives', async () => {
      // CJK segments without spaces, so every mark abuts the next with no
      // separating text node at all.
      const el = editorWith('<p>東京都庁前駅</p>', ['東京', '都庁', '前駅'])
      await el.checkSpelling()
      // Segmenter splits this with no spaces, so Range.insertNode leaves only
      // EMPTY text nodes between the marks — and normalize() collapses those,
      // which is how marks become true siblings without anyone editing.
      el.parts.doc.normalize()
      const marks = [...el.parts.doc.querySelectorAll('tosi-misspelling')]
      expect(marks[0].nextSibling).toBe(marks[1])
      const before = marks.length
      expect(before).toBeGreaterThan(1)

      expect(() => el.value).not.toThrow()
      expect(el.parts.doc.querySelectorAll('tosi-misspelling').length).toBe(
        before
      )
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('東京都庁前駅')
    })

    test('typing in a document with adjacent marks still records undo', async () => {
      // updateUndo() reads docHTML as its first act, inside the keypress
      // listener — which swallows exceptions. A throw there loses the undo
      // snapshot and the form value silently, on an ordinary keystroke.
      const el = editorWith('<p>東京都庁前駅</p>', ['東京', '都庁'])
      await el.checkSpelling()
      el.parts.doc.normalize()

      const before = el.value
      expect(() => el.updateUndo('new')).not.toThrow()
      expect(el.value).toBe(before)
      expect(el.parts.doc.querySelectorAll('tosi-misspelling').length).toBe(2)
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
      el.handleWordAccepted = (word, scope) => persisted.push([word, scope])
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
      const walker = document.createTreeWalker(
        el.parts.doc,
        NodeFilter.SHOW_TEXT
      )
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

  describe('live change tracking', () => {
    // The whole mechanism is one predicate: is the caret already inside an
    // insertion that is mine, this session? These tests are about when that
    // predicate flips, because that is the only thing that decides whether a
    // keystroke extends a change or opens a new one.
    const typing = (): TosijsStyledEditor => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>hello world</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const p = el.parts.doc.querySelector('p')!
      p.appendChild(el.selectable.createBounds())
      return el
    }
    const type = (el: TosijsStyledEditor, text: string): void => {
      for (const ch of text) {
        el.parts.doc.dispatchEvent(
          new KeyboardEvent('keypress', {
            key: ch,
            bubbles: true,
            cancelable: true,
          })
        )
      }
    }

    test('a continuous run of typing is ONE insertion', () => {
      const el = typing()
      type(el, 'abc')
      const ins = el.parts.doc.querySelectorAll('tosi-ins')
      expect(ins.length).toBe(1)
      expect(ins[0].textContent).toBe('abc')
      expect(ins[0].getAttribute('data-author')).toBe('alex')
    })

    test('typing is not tracked when tracking is off', () => {
      const el = typing()
      el.trackChanges = false
      type(el, 'abc')
      expect(el.parts.doc.querySelectorAll('tosi-ins').length).toBe(0)
      expect(el.parts.doc.querySelector('p')!.textContent).toContain('abc')
    })

    test('moving the caret out opens a NEW insertion', () => {
      const el = typing()
      type(el, 'ab')
      // move the caret out of the insertion, the way a click or arrow would
      const p = el.parts.doc.querySelector('p')!
      const caret = el.insertionPoint()!
      p.appendChild(caret)
      type(el, 'cd')
      const ins = [...el.parts.doc.querySelectorAll('tosi-ins')]
      expect(ins.length).toBe(2)
      expect(ins.map((i) => i.textContent)).toEqual(['ab', 'cd'])
    })

    test("another author's insertion is not extended", () => {
      const el = typing()
      type(el, 'ab')
      // the same caret, but now someone else is typing
      el.changeAuthor = { id: 'sam', name: 'Sam' }
      type(el, 'cd')
      const ins = [...el.parts.doc.querySelectorAll('tosi-ins')]
      expect(ins.length).toBe(2)
      expect(ins[1].getAttribute('data-author')).toBe('sam')
    })

    test('an insertion is never nested inside another insertion', () => {
      // Nesting makes `changes` report two overlapping ids, and rejecting the
      // outer silently discards the inner. The case that hurts is pasting
      // inside SOMEONE ELSE'S insertion: rejecting their change would throw
      // away your text.
      const el = typing()
      type(el, 'ab')
      const mine = el.parts.doc.querySelector('tosi-ins')!
      // a different author's mark, with our caret inside it
      mine.setAttribute('data-author', 'sam')
      type(el, 'cd')

      const all = [...el.parts.doc.querySelectorAll('tosi-ins')]
      expect(all.length).toBe(2)
      for (const ins of all) {
        expect(ins.querySelector('tosi-ins')).toBeNull()
        expect(ins.parentElement!.closest('tosi-ins')).toBeNull()
      }
      // and rejecting theirs leaves ours alone
      el.rejectChanges(all[0].getAttribute('data-change')!)
      expect(el.parts.doc.querySelector('p')!.textContent).toContain('cd')
    })

    test('ids produced in the same millisecond are still distinct', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 1000; i++) ids.add(changeId())
      expect(ids.size).toBe(1000)
    })

    // THE GATE MUST NOT FAIL OPEN. `trackDeletion` had exactly one call site,
    // so every gesture below deleted raw: no <tosi-del>, no entry in
    // `changes`, and `rejectChanges()` could not bring the text back.
    const press = (el: TosijsStyledEditor, key: string): void => {
      el.parts.doc.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      )
    }

    test('a caret Backspace is tracked, not a raw delete', () => {
      const el = typing()
      press(el, 'Backspace')
      const del = el.parts.doc.querySelector('tosi-del')
      expect(del).not.toBeNull()
      expect(del!.textContent).toBe('d')
      expect(el.changes.length).toBe(1)
      // the text is still recoverable, which is the whole point
      el.rejectChanges()
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('hello world')
    })

    test('a caret Delete is tracked too', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>hello world</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const p = el.parts.doc.querySelector('p')!
      const text = p.firstChild as Text
      const range = document.createRange()
      range.setStart(text, 0)
      range.collapse(true)
      range.insertNode(el.selectable.createBounds())

      press(el, 'Delete')
      const del = el.parts.doc.querySelector('tosi-del')
      expect(del).not.toBeNull()
      expect(el.changes.length).toBe(1)
      el.rejectChanges()
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('hello world')
    })

    test('backspacing my OWN fresh typing really removes it', () => {
      // the documented carve-out: un-typing your own uncommitted proposal
      const el = typing()
      type(el, 'xy')
      press(el, 'Backspace')
      expect(el.parts.doc.querySelector('tosi-del')).toBeNull()
      expect(el.parts.doc.querySelector('tosi-ins')!.textContent).toBe('x')
    })

    test('a fully selected interior block is marked, not silently removed', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>one</p><p>two</p><p>three</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const middle = el.parts.doc.querySelectorAll('p')[1] as HTMLElement
      middle.classList.add('selected-block')

      el.deleteSelection()
      // the paragraph is still a paragraph — a <tosi-del> wrapped AROUND a <p>
      // would sit at document top level and make block() answer `tosi-del`
      expect(el.parts.doc.querySelectorAll('p').length).toBe(3)
      const del = middle.querySelector('tosi-del')
      expect(del).not.toBeNull()
      expect(del!.textContent).toBe('two')
      expect(el.parts.doc.querySelector('tosi-del > p')).toBeNull()
      expect(el.changes.length).toBe(1)
    })

    test('nothing leaves the document untracked on any delete gesture', () => {
      // The property, stated once: with tracking on, the text content of the
      // document never shrinks. It only gains strikethrough.
      const el = typing()
      const before = el.parts.doc.querySelector('p')!.textContent
      press(el, 'Backspace')
      press(el, 'Backspace')
      press(el, 'Delete')
      expect(el.parts.doc.querySelector('p')!.textContent).toBe(before)
    })

    test('a tracked block deletion resolves cleanly in both directions', () => {
      const mk = (): TosijsStyledEditor => {
        const el = tosijsStyledEditor() as TosijsStyledEditor
        container.appendChild(el)
        el.parts.doc.innerHTML = '<p>one</p><p>two</p><p>three</p>'
        el.changeAuthor = { id: 'alex', name: 'Alex' }
        el.trackChanges = true
        ;(el.parts.doc.querySelectorAll('p')[1] as HTMLElement).classList.add(
          'selected-block'
        )
        el.deleteSelection()
        return el
      }
      const rejected = mk()
      rejected.rejectChanges()
      expect(rejected.parts.doc.textContent).toContain('two')
      expect(rejected.value).not.toMatch(/tosi-del|data-change/)

      const accepted = mk()
      accepted.acceptChanges()
      expect(accepted.parts.doc.textContent).not.toContain('two')
      expect(accepted.value).not.toMatch(/tosi-del|data-change/)
      // and the block goes with it — accepting a paragraph deletion must not
      // leave an empty paragraph standing where it was
      expect(accepted.parts.doc.querySelectorAll('p').length).toBe(2)
    })

    test('pasted change marks are re-stamped, not taken at their word', () => {
      // <tosi-ins> is a safe element, so the sanitizer passes it and its
      // attributes through. Taken at face value, `editor.changes` would report
      // attacker-supplied attribution as fact — and a pasted data-change can
      // collide with a live id, so accepting one silently accepts the other.
      const el = typing()
      const evt = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(evt, 'clipboardData', {
        value: {
          getData: (t: string) =>
            t === 'text/html'
              ? '<tosi-ins data-change="chg-forged" data-author="ceo" data-author-name="The CEO" data-time="2001-01-01T00:00:00.000Z">approved</tosi-ins>'
              : 'approved',
          types: ['text/html', 'text/plain'],
        },
      })
      el.parts.doc.dispatchEvent(evt)

      const marks = [...el.parts.doc.querySelectorAll('tosi-ins')]
      expect(marks.length).toBeGreaterThan(0)
      for (const m of marks) {
        expect(m.getAttribute('data-author')).not.toBe('ceo')
        expect(m.getAttribute('data-author-name')).not.toBe('The CEO')
        expect(m.getAttribute('data-change')).not.toBe('chg-forged')
        expect(m.getAttribute('data-time')).not.toBe('2001-01-01T00:00:00.000Z')
      }
      expect(el.changes.every((c) => c.author === 'alex')).toBe(true)
    })

    test('an empty change id does not resolve every change', () => {
      // reachable from `row.dataset.changeId` on a row with no id
      const el = typing()
      type(el, 'abc')
      expect(el.changes.length).toBe(1)
      el.acceptChanges('')
      el.rejectChanges('')
      expect(el.changes.length).toBe(1)
    })

    test('merging the ends of a selection keeps the text in order', () => {
      // `while (first.firstChild) last.insertBefore(first.firstChild,
      // last.firstChild)` puts each node in FRONT of the previous one, so
      // `A <b>B</b> C<i>D</i>` + `tail` merged to `<i>D</i> C<b>B</b>A tail`.
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>A <b>B</b> C<i>D</i></p><p>tail</p>'
      const blocks = [...el.parts.doc.querySelectorAll('p')]
      blocks.forEach((p, i) => {
        p.classList.add(
          'selected-block',
          i === 0 ? 'first-block' : 'last-block'
        )
      })

      el.deleteSelection()
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('A B CDtail')
    })

    test('an annotation widget survives a delete that empties its block', () => {
      // End-to-end, not just the predicate: the destruction happened at the
      // CALL SITES. An annotation is exactly what the shipped `annotate`
      // command builds, and it carries the two classes EXTENSIBILITY.md tells
      // plugin authors to use.
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML =
        '<p>alpha</p><p>gamma<span class="annotation do-not-spanify not-selectable"><img src="note.svg"></span></p>'
      const blocks = [...el.parts.doc.querySelectorAll('p')]
      blocks.forEach((p, i) => {
        // `.first-block` / `.last-block` are what markBounds() sets on a real
        // selection. Without them EVERY block counts as interior and is
        // removed wholesale — a harness defect that looks exactly like the
        // product defect under test.
        p.classList.add('selected-block')
        p.classList.add(i === 0 ? 'first-block' : 'last-block')
        const span = document.createElement('span')
        span.className = 'selected'
        const text = p.firstChild as Text
        p.insertBefore(span, text)
        span.appendChild(text)
      })

      el.deleteSelection()
      expect(el.parts.doc.querySelector('img')).not.toBeNull()
      expect(el.parts.doc.querySelector('.annotation')).not.toBeNull()
    })

    test('splitting an insertion does not mint a PHANTOM change', () => {
      // The DOM extract algorithm clones a partially-contained child into the
      // fragment even when the extracted subrange is empty — so a caret at the
      // end of <b>quick</b> yields a tail of <tosi-ins c1><b></b></tosi-ins>.
      // Re-attached, that is a ghost row in `changes` sharing a LIVE id, which
      // accumulates and survives accept.
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML =
        '<p><tosi-ins data-change="c1" data-author="sam" data-session="other"><b>quick</b></tosi-ins></p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const b = el.parts.doc.querySelector('b')!
      const range = document.createRange()
      range.setStart(b.firstChild as Text, 5) // caret at the END of "quick"
      range.collapse(true)
      range.insertNode(el.selectable.createBounds())

      type(el, 'X')
      const ids = el.changes.map((c) => c.id)
      expect(ids.length).toBe(2)
      expect(new Set(ids).size).toBe(2)

      // and nothing empty is left behind once resolved
      el.acceptChanges()
      const emptyInlines = [...el.parts.doc.querySelectorAll('b')].filter(
        (b) => !b.firstChild
      )
      expect(emptyInlines.length).toBe(0)
      expect(el.value).not.toMatch(/tosi-ins|data-change/)
    })

    test('splitting an insertion does not drop a tail with no TEXT in it', () => {
      // extractContents() has already moved the tail out. Gating re-attachment
      // on textContent dropped an <img>/<br>/<hr> tail on the floor — no mark,
      // no entry in changes, no error. Reachable in one session: type,
      // insertImage, ArrowLeft, paste.
      // svg/video/canvas matter as much as img: the shared emptiness predicate
      // was a DENYLIST, so gating this line on it would have dropped exactly
      // these tails — the same content loss, one media kind over.
      for (const html of [
        '<img src="x.png">',
        '<br>',
        '<hr>',
        '<svg></svg>',
        '<video></video>',
        '<canvas></canvas>',
      ]) {
        const el = tosijsStyledEditor() as TosijsStyledEditor
        container.appendChild(el)
        el.parts.doc.innerHTML = `<p><tosi-ins data-change="c1" data-author="sam" data-session="other">keep${html}</tosi-ins></p>`
        el.changeAuthor = { id: 'alex', name: 'Alex' }
        el.trackChanges = true
        const mark = el.parts.doc.querySelector('tosi-ins')!
        const range = document.createRange()
        range.setStart(mark.firstChild as Text, 4) // between "keep" and the element
        range.collapse(true)
        range.insertNode(el.selectable.createBounds())

        type(el, 'X')
        const tag = html.match(/<(\w+)/)![1]
        expect(el.parts.doc.querySelector(tag)).not.toBeNull()
        expect(el.parts.doc.querySelector('p')!.textContent).toContain('keepX')
      }
    })

    test('one delete gesture is ONE change, however many nodes it spans', () => {
      // README warns that finer granularity turns a rewritten sentence into
      // confetti, and the paste path already upholds that. Delete must too:
      // three ids for one paragraph means acceptChanges(middleId) can leave
      // text neither party proposed, reachable through the documented API.
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>the <b>quick</b> brown</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const p = el.parts.doc.querySelector('p')!
      for (const node of [...p.childNodes]) {
        const span = document.createElement('span')
        span.className = 'selected'
        p.insertBefore(span, node)
        span.appendChild(node)
      }
      el.deleteSelection()

      const ids = el.changes.filter((c) => c.kind === 'delete').map((c) => c.id)
      expect(ids.length).toBeGreaterThan(1)
      expect(new Set(ids).size).toBe(1)
    })

    test('a refused structural edit is observable', () => {
      // preventDefault() has already run by the time the refusal happens, so
      // without a signal the key is simply dead and no host can explain why.
      const el = typing()
      const seen: string[] = []
      el.addEventListener('structural-edit-refused', (e) => {
        seen.push((e as CustomEvent).detail.reason)
      })
      const p = el.parts.doc.querySelector('p')!
      el.parts.doc.insertBefore(document.createElement('p'), p)
      el.parts.doc.firstElementChild!.textContent = 'before'
      const range = document.createRange()
      range.setStart(p.firstChild as Text, 0)
      range.collapse(true)
      el.selectable.removeBounds()
      range.insertNode(el.selectable.createBounds())

      press(el, 'Backspace')
      expect(seen).toContain('merge-blocks-backward')
      // and the blocks really were not merged
      expect(el.parts.doc.querySelectorAll('p').length).toBe(2)
    })

    // --- regressions introduced by the B3 remediation (a0e2c43) -------------
    // Every one of these shipped green. The original B3 test asserted only
    // that textContent was unchanged, which a DEAD KEY satisfies just as well
    // as a tracked deletion.

    test('repeated Backspace keeps deleting — the mark is not a wall', () => {
      const el = typing()
      press(el, 'Backspace')
      press(el, 'Backspace')
      press(el, 'Backspace')
      const deleted = [...el.parts.doc.querySelectorAll('tosi-del')]
        .map((d) => d.textContent)
        .join('')
      expect(deleted.length).toBe(3)
      expect(
        el.changes.filter((c) => c.kind === 'delete').length
      ).toBeGreaterThan(0)
      el.rejectChanges()
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('hello world')
    })

    test('a document opened with someone else s <tosi-del> is not dead at it', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML =
        '<p>keep<tosi-del data-change="c1" data-author="sam">gone</tosi-del></p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const p = el.parts.doc.querySelector('p')!
      p.appendChild(el.selectable.createBounds())

      press(el, 'Backspace')
      // it walked PAST the existing mark and took a real character
      expect(p.textContent).toBe('keepgone')
      const mine = [...p.querySelectorAll('tosi-del')].filter(
        (d) => d.getAttribute('data-author') === 'alex'
      )
      expect(mine.length).toBe(1)
      expect(mine[0].textContent).toBe('p')
    })

    test('accepting an inline delete of all a block s text keeps the block AND the caret', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>one</p><p>two</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const first = el.parts.doc.querySelector('p')!
      const text = first.firstChild as Text
      const span = document.createElement('span')
      span.className = 'selected'
      text.parentNode!.insertBefore(span, text)
      span.appendChild(text)
      first.appendChild(el.selectable.createBounds())

      el.deleteSelection()
      el.acceptChanges()

      // the paragraph was never deleted — only its text was
      expect(el.parts.doc.querySelectorAll('p').length).toBe(2)
      // and the editor still takes input, which is what actually broke
      expect(el.insertionPoint()).not.toBeNull()
    })

    test('typing mid-word inside another author s insertion lands mid-word', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML =
        '<p>A<tosi-ins data-change="c1" data-author="sam" data-session="other">QUICKBROWN</tosi-ins>Z</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const mark = el.parts.doc.querySelector('tosi-ins')!
      const range = document.createRange()
      range.setStart(mark.firstChild as Text, 5) // between QUICK and BROWN
      range.collapse(true)
      range.insertNode(el.selectable.createBounds())

      type(el, 'X')
      expect(el.parts.doc.querySelector('p')!.textContent).toBe('AQUICKXBROWNZ')
      // still not nested, which was the point of the original fix
      for (const ins of el.parts.doc.querySelectorAll('tosi-ins')) {
        expect(ins.querySelector('tosi-ins')).toBeNull()
      }
      // and the other author's text is still attributed to them, in both halves
      const theirs = [...el.parts.doc.querySelectorAll('tosi-ins')].filter(
        (i) => i.getAttribute('data-author') === 'sam'
      )
      expect(theirs.map((i) => i.textContent).join('')).toBe('QUICKBROWN')
    })

    test('table row and column deletion do not bypass tracking', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML =
        '<ul class="editor-table" style="grid-template-columns: 1fr 1fr"><li>a1</li><li>b1</li><li>SECRET</li><li>b2</li></ul>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const cells = [...el.parts.doc.querySelectorAll('li')]
      cells[2].appendChild(el.selectable.createBounds())

      const refused: string[] = []
      el.addEventListener('structural-edit-refused', (e) => {
        refused.push((e as CustomEvent).detail.reason)
      })

      el.doCommand('deleteTableRow')
      // Structural: a grid table derives row/col from cellIndex, so there is
      // nothing a <tosi-del> could wrap without corrupting it. Refusing is the
      // house rule — what must NOT happen is the text leaving with no record.
      expect(el.parts.doc.textContent).toContain('SECRET')
      el.doCommand('deleteTableCol')
      expect(el.parts.doc.textContent).toContain('SECRET')

      // ...and it must REFUSE, not merely do nothing. These are live items in
      // the default menubar, so a silent no-op is a dead menu click — and
      // README promises the event by name for exactly these two commands.
      expect(refused).toEqual(['delete-table-row', 'delete-table-col'])
    })

    test('overriding a block-merge refusal gives a clean UNTRACKED edit', () => {
      // Half-applying is the failure: the merge itself is a raw DOM move with
      // nothing in `changes`, while the character riding along on the same
      // keystroke gets MARKED — leaving the document mid-merge AND
      // mid-proposal, where neither accepting nor rejecting reproduces a
      // document either party proposed.
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>one</p><p>two</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const second = el.parts.doc.querySelectorAll('p')[1]
      const range = document.createRange()
      range.setStart(second.firstChild as Text, 0)
      range.collapse(true)
      el.selectable.removeBounds()
      range.insertNode(el.selectable.createBounds())
      el.addEventListener('structural-edit-refused', (e) => e.preventDefault())

      press(el, 'Backspace')

      // one paragraph, no marks anywhere, nothing pending review
      expect(el.parts.doc.querySelectorAll('p').length).toBe(1)
      expect(el.parts.doc.querySelector('tosi-del')).toBeNull()
      expect(el.changes.length).toBe(0)
      // and tracking is back on for the next edit
      expect(el.trackChanges).toBe(true)
    })

    test('pasted markup cannot assert that it deletes a whole block', () => {
      // A tracked whole-block delete copied out of ANOTHER editor carries
      // data-block-delete, and kilpi is an attribute blocklist so data-* is
      // passed through verbatim. Left in place, acceptChanges() would delete
      // the pasting document's paragraph.
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>one</p><p></p><p>three</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      const empty = el.parts.doc.querySelectorAll('p')[1]
      empty.appendChild(el.selectable.createBounds())

      const evt = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(evt, 'clipboardData', {
        value: {
          getData: (t: string) =>
            t === 'text/html'
              ? '<tosi-del data-change="x" data-author="sam" data-block-delete="">struck</tosi-del>'
              : 'struck',
          types: ['text/html', 'text/plain'],
        },
      })
      el.parts.doc.dispatchEvent(evt)
      expect(
        el.parts.doc
          .querySelector('tosi-del')
          ?.hasAttribute('data-block-delete')
      ).toBe(false)

      el.selectable.removeBounds()
      el.acceptChanges()
      expect(el.parts.doc.querySelectorAll('p').length).toBe(3)
    })

    test('overriding a selection-delete refusal is all-or-nothing', () => {
      // The refusal used to be resolved AFTER the tracked deletions had run,
      // so an override left the text wrapped in <tosi-del> and pending review
      // while the paragraph break had already gone raw — rejectChanges() then
      // put the words back into a document whose structure had changed.
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>hello world</p><p>second para</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      el.addEventListener('structural-edit-refused', (e) => e.preventDefault())
      const blocks = [...el.parts.doc.querySelectorAll('p')]
      blocks.forEach((p, i) => {
        p.classList.add('selected-block')
        p.classList.add(i === 0 ? 'first-block' : 'last-block')
        const span = document.createElement('span')
        span.className = 'selected'
        const text = p.firstChild as Text
        p.insertBefore(span, text)
        span.appendChild(text)
      })

      el.deleteSelection()

      // one mode, not two: the merge happened, so the deletion is untracked
      expect(el.parts.doc.querySelectorAll('p').length).toBe(1)
      expect(el.changes.length).toBe(0)
      expect(el.parts.doc.querySelector('tosi-del')).toBeNull()
      expect(el.trackChanges).toBe(true)
    })

    test('a cross-paragraph selection delete refuses audibly too', () => {
      // keydown routes Backspace and Delete through deleteSelection FIRST, so
      // a silent refusal here shadows the keystroke refusals for the gesture
      // a user actually performs most: select across paragraphs, Backspace.
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>xa</p><p>by</p>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const seen: string[] = []
      el.addEventListener('structural-edit-refused', (e) => {
        seen.push((e as CustomEvent).detail.reason)
      })
      for (const p of el.parts.doc.querySelectorAll('p')) {
        p.classList.add('selected-block')
        const span = document.createElement('span')
        span.className = 'selected'
        const text = p.firstChild as Text
        p.insertBefore(span, text)
        span.appendChild(text)
      }

      el.deleteSelection()
      expect(seen).toContain('merge-blocks-selection')
      expect(el.parts.doc.querySelectorAll('p').length).toBe(2)
    })

    test('a host can override a refusal with preventDefault', () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML =
        '<ul class="editor-table" style="grid-template-columns: 1fr 1fr"><li>a1</li><li>b1</li><li>SECRET</li><li>b2</li></ul>'
      el.changeAuthor = { id: 'alex', name: 'Alex' }
      el.trackChanges = true
      const cells = [...el.parts.doc.querySelectorAll('li')]
      cells[2].appendChild(el.selectable.createBounds())
      el.addEventListener('structural-edit-refused', (e) => e.preventDefault())

      el.doCommand('deleteTableRow')
      // the override actually performs the edit, rather than half-applying it
      expect(el.parts.doc.textContent).not.toContain('SECRET')
      expect(el.parts.doc.querySelectorAll('li').length).toBe(2)
    })

    test('checkSpelling does not kill a caret in a textless block', async () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>one</p><p></p>'
      el.spellChecker = () => new Set<string>()
      const empty = el.parts.doc.querySelectorAll('p')[1]
      empty.appendChild(el.selectable.createBounds())
      expect(el.insertionPoint()).not.toBeNull()

      await el.checkSpelling()

      // The host calls this on blur or before submit. Losing the caret here
      // reads as "the editor stopped accepting input", inside their app.
      expect(el.insertionPoint()).not.toBeNull()
      expect(el.parts.doc.querySelectorAll('.sel-end').length).toBe(1)
    })

    test('a deletion and its replacement get DIFFERENT ids', () => {
      // Typing over a selection deletes and inserts inside ONE synchronous
      // handler, so `Date.now()` alone collides. A collision means
      // acceptChanges(deletionId) also accepts the replacement, and a
      // reviewer cannot accept a deletion and reject what replaced it.
      const el = typing()
      const p = el.parts.doc.querySelector('p')!
      const text = p.firstChild as Text
      const span = document.createElement('span')
      span.className = 'selected'
      text.parentNode!.insertBefore(span, text)
      span.appendChild(text)
      el.deleteSelection()
      type(el, 'z')

      const ids = el.changes.map((c) => c.id)
      expect(ids.length).toBeGreaterThan(1)
      expect(new Set(ids).size).toBe(ids.length)
    })

    test('a later SESSION does not extend an earlier insertion', () => {
      const first = typing()
      type(first, 'ab')
      const html = first.value

      // reopen the same document as the same author, new session
      const second = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(second)
      second.parts.doc.innerHTML = html
      second.changeAuthor = { id: 'alex', name: 'Alex' }
      second.trackChanges = true
      // caret inside the EXISTING insertion from last time. Clear first: the
      // serialization still carries the previous editor's caret (see TODO —
      // `value` leaks selection chrome), and two carets would make this test
      // about that instead of about sessions.
      second.selectable.removeBounds()
      const existing = second.parts.doc.querySelector('tosi-ins')!
      existing.appendChild(second.selectable.createBounds())
      type(second, 'cd')

      const ins = [...second.parts.doc.querySelectorAll('tosi-ins')]
      expect(ins.length).toBe(2)
      expect(ins[0].getAttribute('data-session')).not.toBe(second.sessionId)
      expect(ins[1].getAttribute('data-session')).toBe(second.sessionId)
    })

    test('deleting a selection wraps it instead of removing it', () => {
      const el = typing()
      const p = el.parts.doc.querySelector('p')!
      const text = p.firstChild as Text
      const span = document.createElement('span')
      span.className = 'selected'
      text.parentNode!.insertBefore(span, text)
      span.appendChild(text)

      el.deleteSelection()
      const del = el.parts.doc.querySelector('tosi-del')
      expect(del).not.toBeNull()
      expect(del!.textContent).toContain('hello world')
      expect(del!.getAttribute('data-author')).toBe('alex')
    })

    test('deleting my own uncommitted typing really removes it', () => {
      const el = typing()
      type(el, 'abc')
      const ins = el.parts.doc.querySelector('tosi-ins')!
      const inner = ins.firstChild as Text
      const span = document.createElement('span')
      span.className = 'selected'
      inner.parentNode!.insertBefore(span, inner)
      span.appendChild(inner)

      el.deleteSelection()
      // no deletion mark: un-typing your own proposal is not a proposal
      expect(el.parts.doc.querySelector('tosi-del')).toBeNull()
      expect(el.parts.doc.textContent).not.toContain('abc')
    })

    const pasteInto = (el: TosijsStyledEditor, html: string): void => {
      const data = {
        getData: (t: string) => (t === 'text/html' ? html : 'plain'),
        types: ['text/html', 'text/plain'],
      }
      const evt = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(evt, 'clipboardData', { value: data })
      el.parts.doc.dispatchEvent(evt)
    }

    test('a paste is ONE change, not one per word', () => {
      const el = typing()
      pasteInto(el, 'several pasted words here')
      const ins = [...el.parts.doc.querySelectorAll('tosi-ins')]
      expect(ins.length).toBe(1)
      expect(ins[0].textContent).toBe('several pasted words here')
      expect(ins[0].getAttribute('data-author')).toBe('alex')
    })

    test('a paste is its own change even mid-typing-run', () => {
      const el = typing()
      type(el, 'ab')
      pasteInto(el, 'PASTED')
      const ins = [...el.parts.doc.querySelectorAll('tosi-ins')]
      // the typing run and the paste are separately reviewable
      expect(ins.length).toBe(2)
      expect(ins.map((i) => i.textContent)).toContain('PASTED')
    })

    test('pasted markup is still sanitized before it is marked', () => {
      const el = typing()
      pasteInto(el, '<img src=x onerror="boom()">ok')
      expect(el.value).not.toMatch(/onerror/i)
      expect(el.parts.doc.querySelector('tosi-ins')).not.toBeNull()
    })

    test('rejecting a paste removes it entirely', () => {
      const el = typing()
      pasteInto(el, 'unwanted')
      el.rejectChanges()
      expect(el.parts.doc.querySelector('p')!.textContent).not.toContain(
        'unwanted'
      )
      expect(el.changes.length).toBe(0)
    })

    test('cut wraps rather than removes, and leaves no residue once resolved', () => {
      const el = typing()
      const p = el.parts.doc.querySelector('p')!
      const text = p.firstChild as Text
      const span = document.createElement('span')
      span.className = 'selected'
      text.parentNode!.insertBefore(span, text)
      span.appendChild(text)

      el.parts.doc.dispatchEvent(
        new Event('cut', { bubbles: true, cancelable: true })
      )
      const del = el.parts.doc.querySelector('tosi-del')
      expect(del).not.toBeNull()
      expect(del!.textContent).toContain('hello world')

      // accepting a cut really removes it, and leaves nothing behind
      el.acceptChanges()
      expect(el.value).not.toMatch(/tosi-del/)
      expect(el.value).not.toMatch(/data-change/)
    })

    test('resolved changes leave NO history in the document', async () => {
      const el = typing()
      type(el, 'abc')
      pasteInto(el, 'def')
      expect(el.changes.length).toBe(2)

      el.acceptChanges()
      const html = el.value
      expect(html).not.toMatch(
        /tosi-ins|tosi-del|data-change|data-author|data-session/
      )
      // and the text is fully normalized, not left fragmented
      const p = el.parts.doc.querySelector('p')!
      expect(p.querySelectorAll('*').length).toBe(
        p.querySelectorAll('.sel-start, .sel-end').length
      )
    })

    test('a failing proofreader does not leave the document outside undo', async () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>one bad</p><p>two bad</p>'
      const formValues: string[] = []
      el.internals = {
        setValidity: () => {},
        setFormValue: (v: string) => {
          formValues.push(v)
        },
      } as unknown as ElementInternals

      let calls = 0
      await expect(
        el.reviseWith((text) => {
          calls++
          if (calls > 1) throw new Error('proofreader died')
          return text.replace('bad', 'good')
        })
      ).rejects.toThrow('proofreader died')

      // what WAS applied before the failure is real, so it has to be
      // recorded: the form value must reflect the half-revised document, not
      // the pre-revise HTML.
      expect(formValues.length).toBeGreaterThan(0)
      expect(formValues[formValues.length - 1]).toContain('good')
    })

    test('a huge proofreader response does not build a huge LCS table', () => {
      // One side of this diff is a REMOTE RESPONSE. 16k tokens measured at
      // 1.7s / +1.2GB synchronously on the main thread. Past the cap the diff
      // degrades to one delete + one insert, which is coarser but correct.
      const shared = 'the quick brown fox jumps over the lazy dog'
      // under the cap the shared prefix survives as a `same` run
      expect(diffWords(shared, shared + ' extra').map((o) => o.op)).toContain(
        'same'
      )
      // over it, no `same` at all — proof the table was never built
      const huge = shared + ' ' + 'x '.repeat(MAX_DIFF_TOKENS + 10)
      const ops = diffWords(shared, huge)
      expect(ops.map((o) => o.op)).toEqual(['delete', 'insert'])
    })

    test('a caret inside a word does not fragment what the proofreader sees', async () => {
      const el = tosijsStyledEditor() as TosijsStyledEditor
      container.appendChild(el)
      el.parts.doc.innerHTML = '<p>The quick brown fox jumps.</p>'
      const p = el.parts.doc.querySelector('p')!
      const marker = document.createElement('span')
      marker.className = 'sel-end caret'
      const range = document.createRange()
      range.setStart(p.firstChild as Text, 12) // "The quick br|own fox jumps."
      range.collapse(true)
      range.insertNode(marker)
      expect(p.childNodes.length).toBeGreaterThan(1)

      const sent: string[] = []
      await el.reviseWith((text) => {
        sent.push(text)
        return text
      })
      // ONE whole sentence, not two fragments split mid-word
      expect(sent).toEqual(['The quick brown fox jumps.'])
    })

    test('tracked edits are ordinary changes — reviewable and resolvable', () => {
      const el = typing()
      type(el, 'xyz')
      expect(el.changes.length).toBe(1)
      expect(el.changes[0].kind).toBe('insert')
      expect(el.changes[0].authorName).toBe('Alex')
      el.rejectChanges()
      expect(el.parts.doc.querySelector('p')!.textContent).not.toContain('xyz')
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

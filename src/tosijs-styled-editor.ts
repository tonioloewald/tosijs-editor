/*#
# `<tosijs-styled-editor>`

`<tosijs-styled-editor>` is a rich text editor web component that **does not use**
`contentEditable`, `execCommand`, or browser selection/range APIs.

Instead, it manages selection and editing entirely through DOM manipulation,
giving full control over editing behavior.

## Usage

```html
<tosijs-styled-editor widgets="default" localized>
  <p>Edit this text! Use the 🌐 menu to switch the interface to Suomi.</p>
  <p>It supports <b>bold</b>, <i>italic</i>, and more.</p>
</tosijs-styled-editor>
```
```css
tosijs-styled-editor {
  --editor-ink: #27488c;
}
```
```test
// Runs in a real browser against the example above. That matters here: click
// position is resolved by measuring character spans with getBoundingClientRect,
// and happy-dom has no layout — every rect is zero — so a unit test can only
// assert against stubbed geometry. Both bugs below shipped past a green suite.
const editor = await waitFor('tosijs-styled-editor')
const doc = editor.parts.doc
const paragraph = doc.querySelector('p')

function clickAt(x, y, detail = 1) {
  for (const type of ['mousemove', 'mousedown', 'mouseup']) {
    paragraph.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, detail })
    )
  }
}

test('click position is resolved from real layout', async () => {
  // One test: both steps drive the same editor, and test() bodies run concurrently.
  const box = paragraph.getBoundingClientRect()

  // Clicking the dead space right of a line puts the caret at the END of it.
  clickAt(box.right + 200, box.top + box.height / 2)
  const caret = doc.querySelector('.sel-end')
  expect(caret).not.toBe(null)
  const rest = document.createRange()
  rest.setStartAfter(caret)
  rest.setEnd(paragraph, paragraph.childNodes.length)
  expect(rest.toString().replace(/\s+/g, '')).toBe('')

  // Double-click selects a word and leaves the caret at the end of it.
  // Assert the BEHAVIOUR (what text is selected), not the element count: word
  // selection used to spanify, so a word was many `.selected` char spans and
  // `length > 1` held incidentally. It is now one wrapper span, and that
  // assertion went red while the feature was perfectly correct.
  clickAt(box.left + 12, box.top + box.height / 2)
  clickAt(box.left + 12, box.top + box.height / 2, 2)
  const selected = [...doc.querySelectorAll('.selected')]
  const selectedText = selected.map((el) => el.textContent).join('')
  expect(selectedText.length).toBeGreaterThan(0)
  // a word, not a fragment of one and not the whole line
  expect(/^\S+$/.test(selectedText.trim())).toBe(true)
  expect(paragraph.textContent.includes(selectedText.trim())).toBe(true)
  // and nothing is spanified any more — measurement must not rewrite the doc
  expect(doc.querySelectorAll('.spanified, .spanified-word').length).toBe(0)
  const held = doc.querySelector('.sel-end')
  const stranded = selected.filter(
    (el) => held.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
  )
  expect(stranded.length).toBe(0)
})
```

## How It Works

The editor uses three layers:

1. **DOM utilities** — leaf-node traversal (every operation works with text nodes)
2. **Selection** — custom selection, hit-tested by MEASURING with Ranges rather
   than by rewriting the document
3. **Commands** — extensible command system for formatting

The caret and selection edges are painted in the shadow root, positioned from a
collapsed Range beside the bound markers. The markers themselves are spans
styled `display: contents`, so they generate no box and cannot disturb the line
they sit in. The mobile keyboard is raised by the caret OVERLAY, which is an
`<input part="caret">` in the shadow root and is the selection's focus target —
it sits outside the text flow, so it raises a keyboard without breaking shaping.

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
  type TosiStyleSheet,
} from 'tosijs'
import { icons } from 'tosijs-ui/icons'
import { Selectable, spanify } from './selection'
import {
  commands,
  executeCommand,
  runCommand,
  type Command,
  type EditableContext,
} from './commands'
import {
  nextLeafNode,
  previousLeafNode,
  leafNodes,
  topSingleParentAncestor,
  characterAtPoint,
  caretGeometryAt,
  sanitizeInPlace,
  isSafeNavigationUrl,
} from './dom-utils'
import { defineFootnote } from './footnote'
import {
  acceptChange,
  applyRevision,
  changesIn,
  defineChanges,
  rejectChange,
  DEL_TAG,
  INS_TAG,
  type ChangeAuthor,
  type TrackedChange,
} from './changes'
import {
  checkSpelling as runSpellCheck,
  clearMisspellings,
  defineMisspelling,
  MISSPELLING_TAG,
  type SpellChecker,
  type SpellingError,
} from './spelling'
import {
  defaultToolbar,
  minimalToolbar,
  defaultMenubar,
  localePickerWidget,
} from './toolbar'
import {
  cellOf,
  tableOf,
  nextCell,
  prevCell,
  cellBelow,
  cellAbove,
  getColumnCount,
  setColumnWidths,
  getCellsInRow,
  rowOfCell,
  colOfCell,
  createCell,
} from './table-utils'

const { slot, div } = elements

/** Characters with strong RTL directionality (Hebrew, Arabic, Syriac, Thaana, NKo…) */
const RTL_STRONG = /[\u0591-\u07FF\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
/** Characters with strong LTR directionality (Latin, Greek, Cyrillic…) */
const LTR_STRONG = /[A-Za-z\u00C0-\u024F\u0370-\u04FF]/

/** The bidi direction a character forces, or null when it is neutral */
function strongDirection(text: string): 'ltr' | 'rtl' | null {
  if (RTL_STRONG.test(text)) return 'rtl'
  if (LTR_STRONG.test(text)) return 'ltr'
  return null
}

function deletableFilter(node: Node): boolean {
  if (node instanceof Element) {
    return (
      !node.classList.contains('sel-start') &&
      !node.classList.contains('sel-end')
    )
  }
  return node.nodeType !== 3 || node.textContent !== ''
}

interface EditableParts extends PartsMap {
  menubar: HTMLElement
  toolbar: HTMLElement
  doc: HTMLElement
  caret: HTMLElement
  edgeStart: HTMLElement
  edgeEnd: HTMLElement
}

export class TosijsStyledEditor extends WebComponent<EditableParts> {
  static formAssociated = true

  static preferredTagName = 'tosijs-styled-editor'

  static initAttributes = {
    widgets: 'none' as 'none' | 'minimal' | 'default',
    localized: false,
    name: '',
    required: false,
  }

  static shadowStyleSpec: TosiStyleSheet = {
    ':host': {
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      // Pen-ink blue. Everything else is mixed from it, so a consumer can
      // re-theme the whole chrome by setting this one property.
      '--editor-ink': '#27488c',
      '--editor-surface': 'Canvas',
      // Paired with the surface. A consumer that themes one MUST theme both:
      // mapping only the surface to a dark page left black text on near-black.
      '--editor-text': 'CanvasText',
      // Two chrome tints so the menubar, the toolbar and the page read as
      // three distinct surfaces rather than one slab.
      '--editor-menubar-bg':
        'color-mix(in oklab, var(--editor-ink) 14%, var(--editor-surface))',
      '--editor-toolbar-bg':
        'color-mix(in oklab, var(--editor-ink) 6%, var(--editor-surface))',
      '--editor-edge':
        'color-mix(in oklab, var(--editor-ink) 25%, transparent)',
      '--editor-chrome-text':
        'color-mix(in oklab, var(--editor-ink) 30%, var(--editor-text))',
      background: 'var(--editor-surface)',
      color: 'var(--editor-text)',
      // So Canvas/CanvasText track the system scheme when nobody themes us
      colorScheme: 'light dark',
    },
    ':host ::slotted(*)': {
      flex: '0 0 auto',
    },
    ':host [part="menubar"]': {
      flexShrink: '0',
      padding: '0 2px',
      display: 'flex',
      gap: '0',
      flex: '0 0 auto',
      flexWrap: 'wrap',
      alignItems: 'center',
      background: 'var(--editor-menubar-bg)',
      borderBottom: '1px solid var(--editor-edge)',
    },
    ':host(:not([has-menubar])) [part="menubar"]': {
      display: 'none',
    },
    ':host [part="toolbar"]': {
      flexShrink: '0',
      padding: '1px 3px',
      display: 'flex',
      gap: '1px',
      flex: '0 0 auto',
      flexWrap: 'wrap',
      alignItems: 'center',
      background: 'var(--editor-toolbar-bg)',
      borderBottom: '1px solid var(--editor-edge)',
    },
    ':host(:not([has-toolbar])) [part="toolbar"]': {
      display: 'none',
    },
    ':host [part="doc"]': {
      flex: '1 1 auto',
      // A flex child defaults to min-height:auto, which refuses to shrink below
      // its content — so in a constrained host the document pushed the menubar
      // and toolbar out of view instead of scrolling. min-height:0 lets it
      // shrink, and overflow-y below then does the scrolling.
      minHeight: '0',
      background: 'var(--editor-surface)',
      padding: '8px',
      cursor: 'text',
      overflowY: 'auto',
      position: 'relative',
      // DOUBLE-TAP SELECTS A WORD here, but to a touch browser a double tap is
      // zoom — so the gesture that selects also zoomed the page. `manipulation`
      // turns off double-tap zoom (and its 300ms click delay) while KEEPING
      // panning and pinch-zoom, so scrolling the document and zooming
      // deliberately both still work. `none` would break both.
      touchAction: 'manipulation',
      transition: 'padding-top 0.15s ease-out, padding-bottom 0.15s ease-out',
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
    // Images are leaf nodes, so selection and deletion already treat one as a
    // single thing; it just must not blow out of the column.
    ':host [part="doc"] img': {
      maxWidth: '100%',
      height: 'auto',
      verticalAlign: 'bottom',
    },
    ':host [part="doc"] a': {
      color: 'color-mix(in oklab, var(--editor-ink) 65%, var(--editor-text))',
      textDecoration: 'underline',
    },
    ':host [part="doc"] .footnote-ref': {
      fontSize: '0.75em',
      lineHeight: '0',
      verticalAlign: 'super',
    },
    ':host [part="doc"] .footnote-ref a': {
      textDecoration: 'none',
      padding: '0 1px',
    },
    ':host [part="doc"] ol.footnotes': {
      marginTop: '16px',
      paddingTop: '8px',
      borderTop: '1px solid var(--editor-edge)',
      fontSize: '0.85em',
    },
    // An LTR run inside an RTL paragraph inherits the paragraph's base
    // direction, so leading/trailing neutrals — a URL's slashes, a trailing
    // period, a leading bracket — resolve to the WRONG side even though the
    // letters themselves render left-to-right. Code, keys and sample output are
    // left-to-right by nature, so give them their own isolate. `:not([dir])`
    // leaves an explicit direction on the element alone.
    ':host [part="doc"] code:not([dir]), :host [part="doc"] kbd:not([dir]), :host [part="doc"] samp:not([dir])':
      {
        direction: 'ltr',
        unicodeBidi: 'isolate',
      },
    // Markers in the text are INERT: no size, no paint, no replaced element.
    // A 2px <input> here is a replaced element and breaks the shaping run —
    // that is what split Arabic words around the caret in both engines.
    // NO BOX. These were `display: inline; font-size: 0`, but an empty inline
    // box still contributes a strut to its line: in WebKit that grew the
    // paragraph containing the selection by ~5px and shifted everything after
    // it, which is the "metric difference" between a selected paragraph and an
    // unselected one. `display: contents` generates no box at all, so the
    // markers cannot affect layout. Nothing measures them directly any more —
    // see markerRect().
    ':host .sel-start, :host .sel-end': {
      display: 'contents',
    },
    // …and the visible caret is painted over the document from their positions.
    ':host [part="caret"]': {
      position: 'absolute',
      display: 'none',
      width: '2px',
      padding: '0',
      margin: '0',
      border: '0',
      outline: 'none',
      // iOS Safari ZOOMS THE PAGE when focus lands on a form control whose
      // computed font-size is under 16px, and this input is the focus target
      // that raises the mobile keyboard — measured at 11px (the UA default for
      // form controls), so every touch selection zoomed the document. The fix
      // has to be the font size: suppressing it with user-scalable=no or
      // maximum-scale on the viewport would disable pinch-zoom for everyone,
      // which fails WCAG 1.4.4. Nothing here is visible — the text is
      // transparent and width/height are set explicitly — so the size is free.
      fontSize: '16px',
      lineHeight: '1',
      background: 'var(--editor-text)',
      color: 'transparent',
      caretColor: 'transparent',
      pointerEvents: 'none',
      zIndex: '3',
    },
    ':host [part="caret"].-collapsed': {
      animation: 'blink 1s steps(2, start) infinite',
    },
    ':host .selection-edge': {
      position: 'absolute',
      display: 'none',
      width: '2px',
      pointerEvents: 'none',
      zIndex: '3',
    },
    ':host .selection-edge.-start': {
      background: 'color-mix(in oklab, green 70%, var(--editor-text))',
    },
    ':host .selection-edge.-end': {
      background: 'color-mix(in oklab, red 70%, var(--editor-text))',
    },
// The squiggle. skip-ink off, because a spelling underline that dodges
    // descenders reads as a rendering artefact rather than a mark.
    // Change marks are styled in CORE even though the behaviour is a plugin. A
    // `<tosi-del>` without its strikethrough renders deleted text as ordinary
    // prose — the opposite of what the document says — so this is correctness,
    // not decoration.
    ':host tosi-ins': {
      textDecoration: 'underline',
      textDecorationColor: 'color-mix(in oklab, green 60%, var(--editor-text))',
      background: 'color-mix(in oklab, green 12%, transparent)',
    },
    ':host tosi-del': {
      textDecoration: 'line-through',
      textDecorationColor: 'color-mix(in oklab, red 60%, var(--editor-text))',
      background: 'color-mix(in oklab, red 12%, transparent)',
      opacity: '0.75',
    },
    ':host tosi-misspelling': {
      textDecoration: 'underline wavy',
      textDecorationColor: 'color-mix(in oklab, red 70%, var(--editor-text))',
      textDecorationSkipInk: 'none',
      textUnderlineOffset: '2px',
    },
    ':host .selected': {
      background:
        'color-mix(in oklab, var(--editor-ink) 42%, color-mix(in oklab, white 38%, var(--editor-surface)))',
    },
    // Selected blocks
    ':host .selected-block': {
      background:
        'color-mix(in oklab, var(--editor-ink) 12%, color-mix(in oklab, white 21%, var(--editor-surface)))',
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
    // Grid-based tables
    ':host .editor-table': {
      display: 'grid',
      listStyle: 'none',
      padding: '0',
      margin: '8px 0',
      border: '1px solid #ccc',
      borderRadius: '2px',
    },
    ':host .editor-table > li': {
      padding: '4px 8px',
      borderRight: '1px solid #ddd',
      borderBottom: '1px solid #ddd',
      minHeight: '1.5em',
      outline: 'none',
    },
    ':host .editor-table > li.table-header': {
      fontWeight: 'bold',
      background: '#f0f0f0',
    },
    // Touch selection affordances
    ':host .touch-affordances': {
      display: 'none',
      position: 'absolute',
      pointerEvents: 'none',
      zIndex: '1000',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      transition: 'opacity 0.1s ease-out',
    },
    ':host .touch-affordance': {
      position: 'absolute',
      width: '44px',
      height: '44px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      touchAction: 'none',
      background: 'transparent',
      transition: 'left 0.1s ease-out, top 0.1s ease-out',
    },
    ':host .touch-affordances.dragging .touch-affordance': {
      transition: 'none',
    },
    ':host .touch-icon': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '24px',
      background: '#0078ff',
      color: 'white',
      fontSize: '13px',
      fontWeight: 'bold',
      border: '2px solid white',
      boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
    },
    ':host .touch-icon svg': {
      width: '16px',
      height: '16px',
      stroke: 'white',
      fill: 'none',
    },
    ':host .touch-handle-start .touch-icon': {
      borderRadius: '4px 4px 0 4px',
    },
    ':host .touch-handle-end .touch-icon': {
      borderRadius: '0 4px 4px 4px',
    },
    ':host .touch-context-menu .touch-icon': {
      borderRadius: '4px',
    },
    ':host .touch-menu': {
      position: 'absolute',
      display: 'flex',
      gap: '0',
      background: 'rgba(0,0,0,0.85)',
      borderRadius: '8px',
      padding: '0',
      zIndex: '1001',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      pointerEvents: 'auto',
      overflow: 'hidden',
    },
    ':host .touch-menu-item': {
      background: 'transparent',
      color: 'white',
      border: 'none',
      padding: '12px 16px',
      fontSize: '15px',
      borderRadius: '0',
      whiteSpace: 'nowrap',
      margin: '0',
    },
  }

  /**
   * Toolbar buttons and menus are LIGHT DOM (slotted), and `::slotted()` rules
   * lose the cascade to the host page's own `button` styles — which is how the
   * buttons ended up as white chips on the tinted bars. A light stylesheet is
   * scoped by tag name at document level, so it competes on equal terms.
   */
  static lightStyleSpec: TosiStyleSheet = {
    // Scoped to OUR popups via the marker in toolbar.ts — these are tosijs-ui's
    // global menu variables, and setting them at :root would recompact every
    // menu on the page, including the doc system's own.
    '.tosijs-styled-editor-menu': {
      // 48px is a phone touch target; these are dense text command lists
      '--menu-item-height': '30px',
      // …but the text wants real horizontal breathing room
      '--menu-item-padding': '0 16px',
      '--menu-separator-margin': '4px 0',
      '--menu-inset': '4px',
    },
    'tosijs-styled-editor button[slot="toolbar"]': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      padding: '0',
      border: '0',
      borderRadius: '4px',
      background: 'transparent',
      boxShadow: 'none',
      color: 'var(--editor-chrome-text) !important',
      cursor: 'pointer',
    },
    'tosijs-styled-editor button[slot="toolbar"]:hover:not([disabled])': {
      background: 'color-mix(in oklab, currentColor 16%, transparent)',
    },
    'tosijs-styled-editor button[slot="toolbar"]:active:not([disabled])': {
      background: 'color-mix(in oklab, currentColor 28%, transparent)',
    },
    'tosijs-styled-editor button[slot="toolbar"][disabled]': {
      opacity: '0.35',
      cursor: 'default',
      background: 'transparent',
    },
    'tosijs-styled-editor button[slot="toolbar"] svg': {
      width: '18px',
      height: '18px',
    },
    'tosijs-styled-editor [slot="menubar"] button': {
      background: 'transparent',
      border: '0',
      boxShadow: 'none',
      borderRadius: '4px',
      padding: '4px 10px',
      color: 'var(--editor-chrome-text) !important',
      cursor: 'pointer',
    },
    'tosijs-styled-editor [slot="menubar"] button:hover': {
      background: 'color-mix(in oklab, currentColor 16%, transparent)',
    },
    'tosijs-styled-editor [slot="menubar"] button svg': {
      width: '16px',
      height: '16px',
    },
  }

  selectable!: Selectable
  /** Set from `initAttributes` at runtime; `declare` so no field is emitted over it */
  declare widgets: 'none' | 'minimal' | 'default'
  /** Show a language picker — the built-in widgets are always translatable */
  declare localized: boolean
  active = true
  pastemode: 'merge' | 'remove' | 'preserve' | 'paragraphs' = 'merge'

  private undo: string[] = []
  private undoDepth = 0
  private reasonForLastUndo?: string
  private lastKey = 0
  private lastCursorX = 0
  private isInitialized = false

  // Touch affordance state
  private touchAffordances: HTMLElement | null = null
  private touchHandleStart: HTMLElement | null = null
  private touchContextMenu: HTMLElement | null = null
  private touchHandleEnd: HTMLElement | null = null
  private touchMenuEl: HTMLElement | null = null
  private isTouchInteraction = false
  // Per-pointer drag state for multitouch support
  private touchDrags = new Map<
    number,
    { target: 'start' | 'end'; offsetX: number; offsetY: number }
  >()

  // Column resize state
  private resizeTable: HTMLElement | null = null
  private resizeCol = -1
  private resizeStartX = 0
  private resizeStartWidths: number[] = []

  private _value = ''

  /** Get doc innerHTML excluding UI affordances */
  private get docHTML(): string {
    this.touchAffordances?.remove()
    // Spelling marks are VIEW state, not content. Leaving them in would put
    // `<tosi-misspelling>` into the form value, into every undo snapshot, and
    // into whatever the host persists — so a document would carry a record of
    // which words were once flagged, by a dictionary it no longer has.
    const restore = (
      Array.from(this.parts.doc.querySelectorAll(MISSPELLING_TAG)) as HTMLElement[]
    ).map((el) => ({
      el,
      parent: el.parentNode!,
      next: el.nextSibling,
      children: Array.from(el.childNodes),
    }))
    for (const { el, parent } of restore) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      el.remove()
    }

    const html = this.parts.doc.innerHTML

    // Put them back exactly where they were, so reading `value` never changes
    // what the user is looking at.
    for (const { el, parent, next, children } of restore) {
      parent.insertBefore(el, next)
      for (const child of children) el.appendChild(child)
    }
    if (this.touchAffordances) {
      this.parts.doc.appendChild(this.touchAffordances)
    }
    return html
  }

  /** Set doc innerHTML and re-attach UI affordances */
  private set docHTML(html: string) {
    this.touchAffordances?.remove()
    this.parts.doc.innerHTML = html
    if (this.touchAffordances) {
      this.parts.doc.appendChild(this.touchAffordances)
    }
  }

  get value(): string {
    return this.isInitialized ? this.docHTML : this._value
  }

  set value(html: string) {
    const oldValue = this._value
    this._value = html
    if (this.isInitialized && this.docHTML !== html) {
      this.docHTML = html
    }
    if (oldValue !== html && this.internals) {
      this.internals.setFormValue(html)
    }
  }

  /** The editable commands — extend this object to add custom commands */
  commands: Record<string, Command> = { ...commands }

  /**
   * Who authored edits produced by `reviseWith` — a person, or a model.
   */
  changeAuthor: ChangeAuthor = { id: 'user', name: 'You' }

  /**
   * Send prose out for revision and bring the result back as tracked changes.
   *
   * This is the LLM-proofreader path, and it is deliberately the SIMPLE half of
   * change tracking: we have the before text and the after text, so a word-level
   * diff produces the marks in one pass. Recording live keystrokes as changes is
   * the expensive half and is not this.
   *
   * ```js
   * await editor.reviseWith(async (text) => {
   *   const res = await fetch('/api/proofread', { method: 'POST', body: text })
   *   return (await res.json()).text
   * }, { id: 'gpt', name: 'Proofreader' })
   * ```
   *
   * WHAT GOES OUT is plain text, one block at a time. Formatting is deliberately
   * not sent: a model asked to preserve markup will sometimes not, and a
   * reviewer should be reviewing prose rather than diffing HTML. Marks inside a
   * block (a link, a bold run) are preserved because each text node is revised
   * in place — what the model never sees, it cannot damage.
   *
   * WHAT COMES BACK is untrusted. Only its TEXT is used — it is inserted as text
   * nodes inside change marks, never parsed as HTML — so a model that returns
   * `<script>` produces the literal characters, not an element. That is a
   * stronger guarantee than sanitizing would be, and it is why this does not go
   * through `sanitize`.
   *
   * Returns the number of changes introduced.
   */
  async reviseWith(
    revise: (text: string) => string | Promise<string>,
    author: ChangeAuthor = this.changeAuthor
  ): Promise<number> {
    defineChanges()
    // Snapshot the nodes first: revising replaces them, which would invalidate
    // a live walk halfway through.
    const nodes: Text[] = []
    const walker = document.createTreeWalker(this.parts.doc, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = node as Text
      if (!text.data.trim()) continue
      const parent = text.parentElement
      if (!parent) continue
      // Never revise our own chrome, or text already under review.
      if (
        parent.closest(
          `.not-selectable, .do-not-spanify, code, kbd, samp, pre, ${INS_TAG}, ${DEL_TAG}`
        )
      ) {
        continue
      }
      nodes.push(text)
    }

    let total = 0
    for (const text of nodes) {
      if (!text.isConnected) continue
      const revised = await revise(text.data)
      if (typeof revised !== 'string') continue
      total += applyRevision(text, revised, author)
    }
    if (total > 0) {
      this.normalize()
      this.updateUndo('new', 'revise')
    }
    return total
  }

  /**
   * Record live edits as tracked changes.
   *
   * The whole mechanism is one predicate, re-evaluated only when the insertion
   * point might have moved: **is the caret already inside an insertion that is
   * mine, from this session?** If yes, typing just appends to it. If no, a new
   * one is opened. Deleting wraps rather than removes.
   *
   * That is why this is far cheaper than it looks. There is no per-operation
   * bookkeeping and no boundary cases to enumerate — a continuous run of typing
   * stays in one `<tosi-ins>` because the predicate keeps being true, and it
   * stops being true exactly when it should: a click elsewhere, an arrow key, a
   * new line, a new session.
   */
  trackChanges = false

  /**
   * Identifies this editing session.
   *
   * Session, not just author, because reopening a document and typing at the
   * edge of your own earlier tracked insertion should open a NEW change — that
   * edit happened at a different time and a reviewer may want to treat it
   * separately. Without this, the two would silently merge into one change
   * bearing the older timestamp.
   */
  readonly sessionId = `s-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`

  /** The insertion the caret is in, if it is mine and from this session. */
  private currentInsertion(): HTMLElement | null {
    const ip = this.insertionPoint()
    const ins = ip?.closest(INS_TAG) as HTMLElement | null
    if (!ins) return null
    if (ins.getAttribute('data-author') !== this.changeAuthor.id) return null
    if (ins.getAttribute('data-session') !== this.sessionId) return null
    return ins
  }

  /**
   * Put the caret inside a current insertion, opening one if needed.
   *
   * Called before every typed character. When the predicate already holds this
   * is a no-op, which is the common case and why typing stays cheap.
   */
  private enterInsertion(): void {
    if (!this.trackChanges) return
    if (this.currentInsertion()) return
    const ip = this.insertionPoint()
    if (!ip || ip.closest(DEL_TAG)) return
    const ins = this.openInsertion()
    // Move the caret INTO the insertion, so the next character lands inside it.
    if (ins) ins.appendChild(ip)
  }

  /**
   * Create an empty insertion mark at the caret and return it.
   *
   * Shared by typing and by paste/drop, which differ only in what goes inside
   * and whether the caret follows.
   */
  private openInsertion(): HTMLElement | null {
    const ip = this.insertionPoint()
    if (!ip || ip.closest(DEL_TAG)) return null
    defineChanges()
    const ins = document.createElement(INS_TAG)
    ins.setAttribute('data-change', `chg-${Date.now().toString(36)}`)
    ins.setAttribute('data-author', this.changeAuthor.id)
    if (this.changeAuthor.name) {
      ins.setAttribute('data-author-name', this.changeAuthor.name)
    }
    ins.setAttribute('data-session', this.sessionId)
    ins.setAttribute('data-time', new Date().toISOString())
    ip.before(ins)
    return ins
  }

  /**
   * Mark nodes deleted instead of removing them.
   *
   * Two exceptions make this feel right rather than pedantic:
   *  - text inside MY current insertion is really removed. You are un-typing
   *    something you just typed; proposing a deletion of your own uncommitted
   *    proposal would be noise.
   *  - text already inside a `<tosi-del>` is left alone. It is deleted already.
   *
   * Returns true when it handled the nodes, so the caller skips its own removal.
   */
  private trackDeletion(nodes: Node[]): boolean {
    if (!this.trackChanges) return false
    defineChanges()
    const id = `chg-${Date.now().toString(36)}`
    for (const node of nodes) {
      const el =
        node.nodeType === 3 ? (node as Text).parentElement : (node as Element)
      if (el?.closest(DEL_TAG)) continue
      const mine = el?.closest(INS_TAG) as HTMLElement | null
      if (
        mine &&
        mine.getAttribute('data-author') === this.changeAuthor.id &&
        mine.getAttribute('data-session') === this.sessionId
      ) {
        // un-typing my own uncommitted text
        node.parentNode?.removeChild(node)
        continue
      }
      const del = document.createElement(DEL_TAG)
      del.setAttribute('data-change', id)
      del.setAttribute('data-author', this.changeAuthor.id)
      if (this.changeAuthor.name) {
        del.setAttribute('data-author-name', this.changeAuthor.name)
      }
      del.setAttribute('data-session', this.sessionId)
      del.setAttribute('data-time', new Date().toISOString())
      node.parentNode?.insertBefore(del, node)
      del.appendChild(node)
    }
    return true
  }

  /** Every tracked change, in document order. */
  get changes(): TrackedChange[] {
    return changesIn(this.parts.doc)
  }

  /** Accept one change by id, or every change when given none. */
  acceptChanges(id?: string): void {
    const targets = this.changes.filter((c) => !id || c.id === id)
    for (const change of targets) acceptChange(change.element)
    if (targets.length) {
      this.normalize()
      this.updateUndo('new', 'accept-changes')
    }
  }

  /** Reject one change by id, or every change when given none. */
  rejectChanges(id?: string): void {
    const targets = this.changes.filter((c) => !id || c.id === id)
    for (const change of targets) rejectChange(change.element)
    if (targets.length) {
      this.normalize()
      this.updateUndo('new', 'reject-changes')
    }
  }

  /**
   * Supply a spell checker and the editor can answer what the browser will not.
   *
   * Browsers spell-check for free and expose nothing — no count, no list, no
   * way to block a submit on unresolved errors. `spellChecker` is the missing
   * half: you provide "which of these words are wrong", the editor does
   * tokenization, marking, navigation and validity.
   *
   * ```js
   * editor.spellChecker = (words) => new Set(words.filter(w => !myDictionary.has(w)))
   * await editor.checkSpelling()
   * editor.spellingErrors.length     // 3
   * ```
   *
   * No dictionary ships with this component. Which words are real is a
   * localization question with a different answer per document, and a hunspell
   * dictionary is ~40x the size of the entire editor.
   */
  spellChecker: SpellChecker | null = null

  /**
   * Words accepted for THIS DOCUMENT only.
   *
   * Two scopes exist because they have different lifetimes, and collapsing them
   * into one set is the mistake that makes a spell checker unusable in a
   * jargon-heavy domain. A contract full of defined terms needs *this* document
   * to accept them; it does not need every later document to inherit them.
   *
   * Persist this with the document — it is part of the document's meaning, the
   * same way a footnote is.
   */
  documentWords = new Set<string>()

  /**
   * Words in the user's or organisation's dictionary, across all documents.
   *
   * Persist this with the USER, not the document. A firm's terms of art belong
   * here; one contract's party names do not.
   */
  userDictionary = new Set<string>()

  /**
   * Called when a word is accepted, so the host can persist it to whichever
   * store the scope implies.
   *
   * `handle`-prefixed, not `on`-prefixed: tosijs's element factory treats
   * `on<Event>` members as event-handler sugar, so an `onWordAccepted` that is
   * null at construction becomes a `wordaccepted` listener slot rather than the
   * callback property this is meant to be (tosijs#22). The editor deliberately does no persistence of its
   * own — it does not know where either scope lives.
   */
  handleWordAccepted:
    | ((word: string, scope: 'document' | 'dictionary') => void)
    | null = null

  /** Everything currently accepted, from either scope. */
  private get acceptedWords(): Set<string> {
    return new Set([...this.documentWords, ...this.userDictionary])
  }

  /**
   * Re-check the document and mark what the checker rejects.
   *
   * Marks are transient view state, not content: they are cleared on every
   * check and stripped from `value`, so they never reach the form value or an
   * undo snapshot.
   */
  async checkSpelling(): Promise<SpellingError[]> {
    if (!this.spellChecker) return []
    defineMisspelling()
    const errors = await runSpellCheck(
      this.parts.doc,
      this.spellChecker,
      this.acceptedWords
    )
    this.applySpellingValidity(errors)
    return errors
  }

  /** The current errors, in document order. The query browsers refuse. */
  get spellingErrors(): SpellingError[] {
    return Array.from(
      this.parts.doc.querySelectorAll(MISSPELLING_TAG)
    ).map((el) => ({ word: el.textContent || '', element: el as HTMLElement }))
  }

  /**
   * Accept a word and drop its marks.
   *
   * `scope: 'document'` accepts it here only; `'dictionary'` accepts it
   * everywhere. This is the resolution half of the workflow — in a jargon-heavy
   * domain the normal outcome for an unknown word is "this is a real word",
   * not "I mistyped", so accepting has to be as cheap as correcting.
   *
   * Until every flagged word is corrected or accepted, the field stays invalid.
   * That is the forcing function: unresolved spelling blocks a real form
   * submit, rather than relying on anyone to remember to look.
   */
  acceptWord(word: string, scope: 'document' | 'dictionary' = 'document'): void {
    if (scope === 'dictionary') this.userDictionary.add(word)
    else this.documentWords.add(word)
    this.handleWordAccepted?.(word, scope)
    this.dropMarksFor(word)
  }

  /** @deprecated use `acceptWord(word)` — kept so existing callers still work. */
  ignoreWord(word: string): void {
    this.acceptWord(word, 'document')
  }

  private dropMarksFor(word: string): void {
    for (const el of this.spellingErrors) {
      if (el.word !== word) continue
      const parent = el.element.parentNode
      if (!parent) continue
      while (el.element.firstChild) {
        parent.insertBefore(el.element.firstChild, el.element)
      }
      el.element.remove()
    }
    this.parts.doc.normalize()
    this.applySpellingValidity(this.spellingErrors)
  }

  /** Remove every mark without changing the text. */
  clearSpelling(): void {
    clearMisspellings(this.parts.doc)
    this.applySpellingValidity([])
  }

  /**
   * Unresolved spelling makes the field invalid.
   *
   * This is the payoff, and it is the thing `contentEditable` cannot do: the
   * component is `formAssociated`, so an unresolved error can block a real form
   * submit instead of relying on the author to remember to check.
   */
  private applySpellingValidity(errors: SpellingError[]): void {
    if (!this.internals) return
    if (errors.length === 0) {
      this.internals.setValidity({})
      return
    }
    const first = errors[0]
    this.internals.setValidity(
      { customError: true },
      errors.length === 1
        ? `"${first.word}" may be misspelled`
        : `${errors.length} words may be misspelled, starting with "${first.word}"`,
      first.element
    )
  }

  /**
   * Sanitizer applied to pasted and dropped content, before it enters the
   * document. Replace it to use a different one:
   *
   * ```js
   * editor.sanitize = (root) => {
   *   DOMPurify.sanitize(root, {
   *     IN_PLACE: true,
   *     FORBID_TAGS: ['style'],
   *     CUSTOM_ELEMENT_HANDLING: {
   *       tagNameCheck: /^[a-z][a-z0-9]*-[a-z0-9-]*$/,
   *       attributeNameCheck: /^data-|^slot$|^dir$/,
   *     },
   *   })
   * }
   * ```
   *
   * It takes a detached ELEMENT and mutates it, rather than taking and
   * returning an HTML string, deliberately: a string signature would force a
   * serialize-and-reparse round trip, and that round trip is where mutation
   * XSS lives — markup that is inert when parsed once can become executable
   * when re-parsed from its own serialization. DOMPurify's `IN_PLACE: true`
   * has the same shape for the same reason.
   *
   * The default is `sanitizeInPlace`. Setting this to a no-op disables
   * sanitization; see the security section of the README for what is and is
   * not covered.
   */
  sanitize: (root: Element) => void = sanitizeInPlace

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
    // Painted over the document, never inside it. A child of [part="doc"] would
    // be styled as a document BLOCK and would show up in selectedBlocks(),
    // block() and arrow navigation.
    elements.input({ part: 'caret', class: 'caret-paint' }),
    div({ part: 'edgeStart', class: 'selection-edge -start' }),
    div({ part: 'edgeEnd', class: 'selection-edge -end' }),
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
          (n) => !(n instanceof Element && n.hasAttribute('slot'))
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

    // Keyboard events — capture phase so we get Tab before the browser moves focus
    doc.addEventListener('keydown', this.handleKeydown, true)
    doc.addEventListener('keypress', this.handleKeypress)

    // Clipboard events
    doc.addEventListener('copy', this.handleCopy)
    doc.addEventListener('cut', this.handleCut)
    doc.addEventListener('paste', this.handlePaste)

    // Column resize events
    doc.addEventListener('pointerdown', this.handleResizePointerDown)
    doc.addEventListener('pointermove', this.handleResizePointerMove)
    doc.addEventListener('pointerup', this.handleResizePointerUp)

    // Touch affordances
    this.touchAffordances = document.createElement('div')
    this.touchAffordances.className =
      'touch-affordances not-selectable do-not-spanify'

    this.touchHandleStart = document.createElement('div')
    this.touchHandleStart.className =
      'touch-affordance touch-handle-start not-selectable do-not-spanify'
    const startIcon = document.createElement('span')
    startIcon.className = 'touch-icon'
    startIcon.appendChild(icons.chevronLeft())
    this.touchHandleStart.appendChild(startIcon)

    this.touchContextMenu = document.createElement('div')
    this.touchContextMenu.className =
      'touch-affordance touch-context-menu not-selectable do-not-spanify'
    const menuIcon = document.createElement('span')
    menuIcon.className = 'touch-icon'
    menuIcon.innerHTML = '\u22EE'
    this.touchContextMenu.appendChild(menuIcon)

    this.touchHandleEnd = document.createElement('div')
    this.touchHandleEnd.className =
      'touch-affordance touch-handle-end not-selectable do-not-spanify'
    const endIcon = document.createElement('span')
    endIcon.className = 'touch-icon'
    endIcon.appendChild(icons.chevronRight())
    this.touchHandleEnd.appendChild(endIcon)

    this.touchAffordances.append(
      this.touchHandleStart,
      this.touchContextMenu,
      this.touchHandleEnd
    )
    doc.appendChild(this.touchAffordances)

    // Drag handlers for touch affordance handles
    for (const handle of [this.touchHandleStart, this.touchHandleEnd]) {
      handle.addEventListener('pointerdown', this.handleAffordanceDragStart)
      handle.addEventListener('pointermove', this.handleAffordanceDragMove)
      handle.addEventListener('pointerup', this.handleAffordanceDragEnd)
    }
    this.touchContextMenu.addEventListener(
      'pointerdown',
      this.handleTouchContextMenu
    )

    // Selection change updates undo and touch affordances
    doc.addEventListener('selectionchanged', () => {
      this.isTouchInteraction = this.selectable.touchMode
      if (!this.touchMenuEl) {
        // Don't push undo while touch menu is open
        this.updateUndo('new', 'selectionchanged')
      }
      this.updateTouchAffordances()
    })

    // Toolbar button events — listen on host since buttons are slotted light DOM
    doc.addEventListener('click', this.handleDocClick)
    doc.addEventListener('dragstart', this.handleDragStart)
    doc.addEventListener('dragover', this.handleDragOver)
    doc.addEventListener('drop', this.handleDrop)
    doc.addEventListener('dragend', this.handleDragEnd)
    doc.setAttribute('data-drop', 'text/html;text/plain;Files;image/*')
    this.addEventListener('click', this.handleToolbarClick)
    this.addEventListener('change', this.handleToolbarChange)

    this.selectable.focusTarget = this.parts.caret
    this.selectable.onBoundsChanged = () => this.syncCaret()
    this.syncCaret()

    // The overlay is positioned in VIEWPORT coordinates, so anything that moves
    // the text without changing the bounds strands it — scrolling the document
    // left the caret painted where the text used to be. Neither of these fires
    // onBoundsChanged, so they have to repaint it themselves.
    // The overlay and the touch affordances are DERIVED VIEWS: they hold no
    // state, they measure the document and repaint. So they must be driven by
    // every signal that moves text, not recomputed after the actions we happen
    // to think of — that is what stranded the caret on scroll, and froze it at
    // a stale position before that. ResizeObserver catches the rest: container
    // resizes, a late font load, and the padding transition under the touch
    // affordances (measured: 5 callbacks across that 0.15s transition, so the
    // affordances track it continuously instead of waiting a guessed 160ms —
    // that count was measured in a HEIGHT-CONSTRAINED host; see the two
    // observations below for why the box being watched matters).
    // Capture phase: `scroll` does not bubble, so a bubble-phase listener on
    // the doc would miss any scrollable element INSIDE it (a wide table, a
    // code block). Nothing scrolls in there today; this keeps it true later.
    this.parts.doc.addEventListener('scroll', this.handleGeometryChange, {
      capture: true,
      passive: true,
    })
    window.addEventListener('resize', this.handleGeometryChange, {
      passive: true,
    })
    this.geometryObserver = new ResizeObserver(this.handleGeometryChange)
    // TWO observations, because which box changes depends on the host's layout
    // and the documented default is the one the content-box alone misses:
    //   height-constrained host -> padding shrinks the doc's CONTENT box
    //   auto-height host        -> padding grows the BORDER box and the host
    //                              with it, leaving the content box unchanged
    // Observing only the content box worked in the project's own examples
    // solely because the site config forces `height: 100%`; in the README's
    // markup the observer never fired and the touch affordances stranded.
    // Re-observing the SAME element would replace the first observation, so
    // these must be two different elements.
    this.geometryObserver.observe(this.parts.doc, { box: 'content-box' })
    this.geometryObserver.observe(this, { box: 'border-box' })

    this.applyWidgets()

    // A <slot> is always :empty in CSS terms, so whether a bar has content has
    // to be reflected onto the host from assignedNodes().
    this.trackBar(this.parts.menubar as HTMLSlotElement, 'has-menubar')
    this.trackBar(this.parts.toolbar as HTMLSlotElement, 'has-toolbar')

    // Initialize undo
    this.updateUndo('init')
    this.focus()
  }

  /** Reflect whether a slot has assigned content onto the host, and keep it current */
  private trackBar(slot: HTMLSlotElement, attribute: string): void {
    const sync = () =>
      this.toggleAttribute(
        attribute,
        slot.assignedNodes({ flatten: true }).length > 0
      )
    slot.addEventListener('slotchange', sync)
    sync()
  }

  /**
   * Populate the built-in toolbar/menubar named by the `widgets` attribute.
   * Anything the author slotted themselves wins — this only fills an empty bar.
   */
  private applyWidgets(): void {
    const preset = this.widgets
    if (preset !== 'default' && preset !== 'minimal') return
    if (this.querySelector('[slot="toolbar"], [slot="menubar"]')) return

    if (preset === 'default') {
      for (const menu of defaultMenubar(this)) {
        this.appendChild(menu)
      }
      if (this.localized) {
        this.appendChild(localePickerWidget())
      }
    }
    for (const widget of preset === 'minimal'
      ? minimalToolbar()
      : defaultToolbar()) {
      widget.setAttribute('slot', 'toolbar')
      this.appendChild(widget)
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.selectable?.destroy()
    this.parts?.doc?.removeEventListener('scroll', this.handleGeometryChange, {
      capture: true,
    })
    window.removeEventListener('resize', this.handleGeometryChange)
    this.geometryObserver?.disconnect()
  }

  private geometryObserver: ResizeObserver | null = null

  /**
   * Repaint everything positioned over the document.
   *
   * Deliberately NOT coalesced with requestAnimationFrame. Measured: one
   * repaint costs 0.015ms — 0.09% of a frame — and the browser already
   * delivers scroll at most once per frame (60 events across 60 frames). So
   * rAF bought no work reduction and cost a frame of latency, which shows up
   * as the caret trailing the text while scrolling.
   */
  private handleGeometryChange = (): void => {
    this.syncCaret()
    if (this.touchAffordances?.style.display === 'block') {
      this.positionAffordances()
    }
  }

  /**
   * Position the caret (and, for an expanded selection, its two edges) over the
   * document from the inert markers' rects. Nothing here is in the text, so
   * nothing here can change how the text is shaped.
   */
  /**
   * Where a bound marker is on screen.
   *
   * The markers are styled `display: contents` so they generate NO BOX — an
   * inline box between two characters changed the line it sat in (in WebKit an
   * empty marker with `font-size: 0` grew the paragraph by ~5px and shifted
   * every block after it). With no box their own getBoundingClientRect() is
   * meaningless, so position comes from the caret geometry beside them.
   */
  private markerRect(marker: Element): {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  } {
    const geometry = caretGeometryAt(marker, this.parts.doc)
    if (geometry) {
      return {
        left: geometry.left,
        top: geometry.top,
        right: geometry.left,
        bottom: geometry.top + geometry.height,
        width: 0,
        height: geometry.height,
      }
    }
    return marker.getBoundingClientRect()
  }

  private syncCaret(): void {
    const caret = this.parts.caret as HTMLElement
    const startEdge = this.parts.edgeStart as HTMLElement
    const endEdge = this.parts.edgeEnd as HTMLElement
    const doc = this.parts.doc
    const start = doc.querySelector('.sel-start')
    const end = doc.querySelector('.sel-end')
    const anchor = end || start
    const collapsed = doc.querySelector('.selected') === null

    const host = this.getBoundingClientRect()
    const view = doc.getBoundingClientRect()
    // An absolutely positioned child resolves against the containing block's
    // PADDING box, but getBoundingClientRect() gives the BORDER box — so the
    // host's border has to come out or every overlay sits one border-width
    // down and to the right of the caret it is meant to mark.
    const hostStyle = getComputedStyle(this)
    const insetTop = host.top + parseFloat(hostStyle.borderTopWidth || '0')
    const insetLeft = host.left + parseFloat(hostStyle.borderLeftWidth || '0')
    const place = (el: HTMLElement, marker: Element | null): void => {
      if (!marker) {
        el.style.display = 'none'
        return
      }
      // The marker is an empty element: its own rect is 0x0, and the previous
      // fallback to the PARENT's rect gave the height of the whole block, so
      // the caret painted several lines tall and offset from its line.
      const geometry = caretGeometryAt(marker, doc)
      if (!geometry) {
        el.style.display = 'none'
        return
      }
      // A marker scrolled out of the document must not paint over the chrome
      if (
        geometry.top + geometry.height < view.top ||
        geometry.top > view.bottom
      ) {
        el.style.display = 'none'
        return
      }
      el.style.display = 'block'
      el.style.left = `${geometry.left - insetLeft}px`
      el.style.top = `${geometry.top - insetTop}px`
      el.style.height = `${geometry.height}px`
    }

    place(caret, anchor)
    caret.classList.toggle('-collapsed', collapsed)
    // Expanded selections keep their edges distinguishable; a collapsed one is
    // just a caret, and should look like one.
    place(startEdge, collapsed ? null : start)
    place(endEdge, collapsed ? null : end)
  }

  /** Get the editing context for commands */
  private getContext(): EditableContext {
    return {
      root: this.parts.doc,
      selectable: this.selectable,
      commands: this.commands,
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

  /**
   * Run one command with pre-separated arguments.
   *
   * Use this whenever an argument is a runtime value (a URL, a filename): the
   * string form splits on `;` and whitespace, so those values can inject a
   * second command — and a data URI contains `;` by spec.
   */
  doCommandWith(name: string, ...args: string[]): void {
    runCommand(this.getContext(), name, ...args)
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

  /**
   * The caret marker, if the doc has one.
   *
   * This selected `input.caret` until the markers stopped being `<input>`
   * elements, after which it matched nothing and returned null forever —
   * silently disabling every command that inserts at the caret
   * (insertFootnote, insertTable, insertImage, setLink and the rest), because
   * they all bail on a null insertion point.
   */
  insertionPoint(): HTMLElement | null {
    return this.parts.doc.querySelector('.sel-end')
  }

  /** Get the top-level block containing a node */
  block(node: Node): Element | null {
    let current: Node | null = node
    while (current && current.parentNode !== this.parts.doc) {
      current = current.parentNode
    }
    return current instanceof Element ? current : null
  }

  /** Find the table cell containing the caret, if any */
  private caretCell(): HTMLElement | null {
    const ip = this.insertionPoint()
    return ip ? cellOf(ip) : null
  }

  /** Find the list item (<li> in a non-table <ul>/<ol>) containing a node, or null */
  private listItemOf(node: Node): HTMLElement | null {
    let current: Node | null = node
    while (current && current !== this.parts.doc) {
      if (
        current instanceof Element &&
        current.tagName === 'LI' &&
        current.parentElement &&
        (current.parentElement.tagName === 'UL' ||
          current.parentElement.tagName === 'OL') &&
        !current.parentElement.classList.contains('editor-table')
      ) {
        return current as HTMLElement
      }
      current = current.parentNode
    }
    return null
  }

  /** Move the caret (bounds) into a cell, selecting all content */
  private moveCaretToCell(cell: HTMLElement): void {
    this.selectable.unmark()
    this.selectable.removeBounds()
    // Use the real factory, not a hand-rolled pair. These were `<input>`
    // elements, the last ones left after the markers became spans, so
    // Tab/arrow navigation through a table wrote two empty form controls into
    // the document — and from there into `value`, the form value and every
    // undo snapshot. `display: contents` computes to `none` on a replaced
    // element, so nothing rendered and nothing caught it.
    const bounds = this.selectable.createBounds()
    const end = bounds.lastChild as HTMLElement
    const start = bounds.firstChild as HTMLElement
    cell.insertBefore(start, cell.firstChild)
    cell.appendChild(end)
    this.selectable.normalize()
    this.selectable.markBounds()
    this.selectable.selectionChanged()
  }

  /** Insert a new row above the current cell and move caret into it */
  private tableMoveUp(cell: HTMLElement): void {
    const table = tableOf(cell)
    if (!table) return
    const colCount = getColumnCount(table)
    const row = rowOfCell(cell, colCount)
    const rowCells = getCellsInRow(table, row, colCount)
    const firstRowCell = rowCells[0]
    for (let c = 0; c < colCount; c++) {
      firstRowCell.before(createCell())
    }
    const newAbove = cellAbove(cell)
    if (newAbove) this.moveCaretToCell(newAbove)
    this.updateUndo('new')
  }

  /** Insert a new row below the current cell and move caret into it */
  private tableMoveDown(cell: HTMLElement): void {
    const table = tableOf(cell)
    if (!table) return
    const colCount = getColumnCount(table)
    const row = rowOfCell(cell, colCount)
    const rowCells = getCellsInRow(table, row, colCount)
    const lastRowCell = rowCells[rowCells.length - 1]
    for (let c = 0; c < colCount; c++) {
      lastRowCell.after(createCell())
    }
    const newBelow = cellBelow(cell)
    if (newBelow) this.moveCaretToCell(newBelow)
    this.updateUndo('new')
  }

  /** Exit the table, placing the caret in the block before or after it */
  private exitTable(cell: HTMLElement, direction: 'before' | 'after'): void {
    const table = tableOf(cell)
    if (!table) return
    const tableBlock = this.block(table)
    if (!tableBlock) return

    const sibling =
      direction === 'before'
        ? tableBlock.previousElementSibling
        : tableBlock.nextElementSibling

    if (sibling) {
      this.selectable.unmark()
      this.selectable.removeBounds()
      if (direction === 'before') {
        sibling.appendChild(this.selectable.createBounds())
      } else {
        sibling.insertBefore(this.selectable.createBounds(), sibling.firstChild)
      }
      this.selectable.normalize()
      this.selectable.markBounds()
      this.selectable.selectionChanged()
    } else {
      // No sibling — create a new paragraph
      const p = document.createElement('p')
      p.textContent = '\u00A0'
      if (direction === 'before') {
        tableBlock.before(p)
      } else {
        tableBlock.after(p)
      }
      this.selectable.unmark()
      this.selectable.removeBounds()
      p.appendChild(this.selectable.createBounds())
      this.selectable.normalize()
      this.selectable.markBounds()
      this.selectable.selectionChanged()
      this.updateUndo('new')
    }
  }

  /** Split a list item at the caret, creating a new <li> after it.
   *  If the item is empty, exit the list instead (convert to <p>). */
  private splitListItem(li: HTMLElement): void {
    const ip = this.insertionPoint()
    if (!ip) return

    const list = li.parentElement
    if (!list) return

    // If the <li> is empty (just whitespace/nbsp), exit the list
    const textContent = li.textContent?.replace(/\u00A0/g, '').trim()
    if (!textContent) {
      // Convert this <li> to a <p> after the list
      const p = document.createElement('p')
      p.textContent = '\u00A0'
      // Move bounds into the new paragraph
      this.selectable.removeBounds()
      p.appendChild(this.selectable.createBounds())

      // If this is the only <li>, remove the entire list
      if (list.children.length <= 1) {
        list.after(p)
        list.remove()
      } else if (!li.previousElementSibling) {
        // First item — put <p> before the list
        list.before(p)
        li.remove()
      } else if (!li.nextElementSibling) {
        // Last item — put <p> after the list
        list.after(p)
        li.remove()
      } else {
        // Middle item — split the list in two
        const newList = document.createElement(list.tagName)
        let sibling: Element | null = li.nextElementSibling
        while (sibling) {
          const next: Element | null = sibling.nextElementSibling
          newList.appendChild(sibling)
          sibling = next
        }
        list.after(p)
        p.after(newList)
        li.remove()
      }

      this.selectable.normalize()
      this.selectable.markBounds()
      this.updateUndo('new')
      return
    }

    // Split the <li>: create a new <li> and move content after the caret into it
    const newLi = document.createElement('li')
    let node: Node | null = ip.nextSibling
    while (node) {
      const next: Node | null = node.nextSibling
      newLi.appendChild(node)
      node = next
    }

    // Move the caret markers into the new <li>
    const selStart = li.querySelector('.sel-start')
    const selEnd = li.querySelector('.sel-end')
    if (selEnd) newLi.insertBefore(selEnd, newLi.firstChild)
    if (selStart) newLi.insertBefore(selStart, newLi.firstChild)

    // Ensure neither <li> is empty
    if (!newLi.textContent?.trim()) {
      const placeholder = document.createTextNode('\u00A0')
      if (selStart) selStart.before(placeholder)
      else newLi.appendChild(placeholder)
    }
    if (!li.textContent?.trim()) {
      li.appendChild(document.createTextNode('\u00A0'))
    }

    li.after(newLi)
    this.selectable.markBounds()
    this.updateUndo('new')
  }

  /** Check if a list item is effectively empty (only whitespace/nbsp/bounds) */
  private isListItemEmpty(li: HTMLElement): boolean {
    return !li.textContent?.replace(/\u00A0/g, '').trim()
  }

  /** Remove a list item, merging with previous <li> or exiting the list */
  private removeListItem(li: HTMLElement): void {
    const list = li.parentElement
    if (!list) return

    const prevLi = li.previousElementSibling
    if (prevLi && prevLi.tagName === 'LI') {
      // Merge this <li>'s content into the previous <li>
      while (li.firstChild) {
        prevLi.appendChild(li.firstChild)
      }
      li.remove()
    } else {
      // First <li> — convert to <p> before the list
      const p = document.createElement('p')
      while (li.firstChild) {
        p.appendChild(li.firstChild)
      }
      list.before(p)
      li.remove()
      if (list.children.length === 0) {
        list.remove()
      }
    }
    this.normalize()
    this.selectable.markBounds()
    this.updateUndo('new')
  }

  /** Backspace inside a list item: delete within the <li>, or merge with previous <li> */
  private listBackspace(li: HTMLElement): void {
    if (!this.deleteSelection()) {
      const ip = this.insertionPoint()
      if (!ip) return

      // If item is empty, remove it immediately
      if (this.isListItemEmpty(li)) {
        this.removeListItem(li)
        return
      }

      const prev = previousLeafNode(ip, li, deletableFilter)
      if (prev) {
        // There's content before the caret in this <li> — delete it normally
        if (prev.nodeType === 3 && (prev.textContent || '').length > 1) {
          prev.textContent = prev.textContent!.slice(0, -1)
        } else {
          const top = topSingleParentAncestor(prev)
          if (li.contains(top)) {
            top.parentNode?.removeChild(top)
          }
        }
        this.normalize()
        this.updateUndo()
      } else {
        // At start of <li> — merge with previous <li> or exit list
        this.removeListItem(li)
      }
    }
  }

  /** Forward delete inside a list item: delete within the <li>, or merge with next <li> */
  private listForwardDelete(li: HTMLElement): void {
    if (!this.deleteSelection()) {
      const ip = this.insertionPoint()
      if (!ip) return

      const next = nextLeafNode(ip, li, deletableFilter)
      if (next) {
        // There's content after the caret in this <li> — delete it normally
        if (next.nodeType === 3 && (next.textContent || '').length > 1) {
          next.textContent = next.textContent!.slice(1)
        } else {
          const top = topSingleParentAncestor(next)
          if (li.contains(top)) {
            top.parentNode?.removeChild(top)
          }
        }
        this.normalize()
        this.updateUndo()
      } else {
        // At end of <li> — merge next <li> into this one
        const nextLi = li.nextElementSibling
        if (nextLi && nextLi.tagName === 'LI') {
          while (nextLi.firstChild) {
            li.appendChild(nextLi.firstChild)
          }
          nextLi.remove()
          this.normalize()
          this.selectable.markBounds()
          this.updateUndo('new')
        }
        // If last <li>, do nothing (don't escape the list)
      }
    }
  }

  /** Group spanified characters by visual line (rounded top value) */
  private groupByLine(spans: Element[]): Element[][] {
    const lineMap = new Map<number, Element[]>()
    for (const span of spans) {
      const rect = span.getBoundingClientRect()
      const top = Math.round(rect.top)
      let line = lineMap.get(top)
      if (!line) {
        line = []
        lineMap.set(top, line)
      }
      line.push(span)
    }
    // Sort by top position, return as array of lines
    const sortedKeys = Array.from(lineMap.keys()).sort((a, b) => a - b)
    return sortedKeys.map((k) => lineMap.get(k)!)
  }

  /** Find the spanified char on a line closest to targetX */
  private closestCharOnLine(line: Element[], targetX: number): Element {
    let best = line[0]
    let bestDist = Infinity
    for (const span of line) {
      const rect = span.getBoundingClientRect()
      const mid = rect.left + rect.width / 2
      const dist = Math.abs(mid - targetX)
      if (dist < bestDist) {
        bestDist = dist
        best = span
      }
    }
    return best
  }

  /** Position bounds at a spanified character, then despanify the block */
  private positionAtSpanChar(
    span: Element,
    targetX: number,
    extendSelection: boolean,
    blockToDespanify: Element
  ): void {
    // Place bounds while spans still exist in the DOM
    const rect = span.getBoundingClientRect()
    const start = this.selectable.find('.sel-start')
    const end = this.selectable.find('.sel-end')
    if (!start || !end) return

    if (targetX < rect.left + rect.width / 2) {
      span.before(end)
    } else {
      span.after(end)
    }
    if (!extendSelection) {
      end.parentNode?.insertBefore(start, end)
    }
    // Despanify, then mark selection
    spanify(blockToDespanify, false)
    this.selectable.markBounds()
    this.focus()
  }

  /** Move caret up or down by visual line */
  private moveVertical(
    direction: 'up' | 'down',
    extendSelection: boolean
  ): void {
    const ip = this.insertionPoint()
    if (!ip) return

    const currentBlock = this.block(ip)
    if (!currentBlock) return

    // Determine sticky X: capture on first vertical move, reuse on subsequent ones
    const isConsecutiveVertical = this.lastKey === 38 || this.lastKey === 40
    if (!isConsecutiveVertical) {
      const caretRect = this.markerRect(ip)
      this.lastCursorX = caretRect.left
    }
    const targetX = this.lastCursorX

    // When inside a list item, use the <li> as the container for spanification
    // instead of the whole <ul>/<ol> block
    const li = this.listItemOf(ip)
    const container = li || currentBlock

    // Spanify current container to get character positions
    spanify(container, true)
    const spans = Array.from(container.querySelectorAll('.spanified'))

    if (spans.length > 0) {
      const lines = this.groupByLine(spans)
      const caretRect = this.markerRect(ip)
      const caretTop = Math.round(caretRect.top)

      // Find which line the caret is on (nearest by top)
      let currentLineIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < lines.length; i++) {
        const lineTop = Math.round(lines[i][0].getBoundingClientRect().top)
        const dist = Math.abs(lineTop - caretTop)
        if (dist < bestDist) {
          bestDist = dist
          currentLineIdx = i
        }
      }

      const targetLineIdx =
        direction === 'up' ? currentLineIdx - 1 : currentLineIdx + 1

      if (targetLineIdx >= 0 && targetLineIdx < lines.length) {
        // Target line is within this container
        const targetChar = this.closestCharOnLine(lines[targetLineIdx], targetX)
        this.positionAtSpanChar(targetChar, targetX, extendSelection, container)
        return
      }
    }

    // Target line is outside this container
    spanify(container, false)

    if (li) {
      // Inside a list: move to adjacent <li> sibling, or exit the list
      const siblingLi =
        direction === 'up' ? li.previousElementSibling : li.nextElementSibling

      if (siblingLi && siblingLi.tagName === 'LI') {
        // Move to adjacent list item
        spanify(siblingLi, true)
        const siblingSpans = Array.from(
          siblingLi.querySelectorAll('.spanified')
        )

        if (siblingSpans.length === 0) {
          spanify(siblingLi, false)
          this.moveCaretToEmptyContainer(siblingLi, direction, extendSelection)
          return
        }

        const siblingLines = this.groupByLine(siblingSpans)
        const targetLine =
          direction === 'up'
            ? siblingLines[siblingLines.length - 1]
            : siblingLines[0]
        const targetChar = this.closestCharOnLine(targetLine, targetX)
        this.positionAtSpanChar(targetChar, targetX, extendSelection, siblingLi)
        return
      }

      // No sibling <li> — exit the list to adjacent block
      const sibling =
        direction === 'up'
          ? currentBlock.previousElementSibling
          : currentBlock.nextElementSibling

      if (!sibling) return
      this.moveVerticalToBlock(sibling, direction, targetX, extendSelection)
      return
    }

    // Not in a list: move to adjacent block
    const sibling =
      direction === 'up'
        ? currentBlock.previousElementSibling
        : currentBlock.nextElementSibling

    if (!sibling) return
    this.moveVerticalToBlock(sibling, direction, targetX, extendSelection)
  }

  /** Move caret into an empty container (no spanifiable content) */
  private moveCaretToEmptyContainer(
    container: Element,
    direction: 'up' | 'down',
    extendSelection: boolean
  ): void {
    const start = this.selectable.find('.sel-start')
    const end = this.selectable.find('.sel-end')
    if (!start || !end) return

    if (direction === 'up') {
      container.appendChild(end)
    } else {
      container.insertBefore(end, container.firstChild)
    }
    if (!extendSelection) {
      end.parentNode?.insertBefore(start, end)
    }
    this.selectable.markBounds()
    this.focus()
  }

  /** Move caret vertically into a sibling block, handling lists and regular blocks */
  private moveVerticalToBlock(
    sibling: Element,
    direction: 'up' | 'down',
    targetX: number,
    extendSelection: boolean
  ): void {
    // If sibling is a list, enter its first/last <li>
    const isList =
      (sibling.tagName === 'UL' || sibling.tagName === 'OL') &&
      !sibling.classList.contains('editor-table')
    const targetContainer = isList
      ? (direction === 'up'
          ? sibling.querySelector(':scope > li:last-child')
          : sibling.querySelector(':scope > li:first-child')) || sibling
      : sibling

    spanify(targetContainer, true)
    const siblingSpans = Array.from(
      targetContainer.querySelectorAll('.spanified')
    )

    if (siblingSpans.length === 0) {
      spanify(targetContainer, false)
      this.moveCaretToEmptyContainer(
        targetContainer,
        direction,
        extendSelection
      )
      return
    }

    const siblingLines = this.groupByLine(siblingSpans)
    const targetLine =
      direction === 'up'
        ? siblingLines[siblingLines.length - 1]
        : siblingLines[0]

    const targetChar = this.closestCharOnLine(targetLine, targetX)
    this.positionAtSpanChar(
      targetChar,
      targetX,
      extendSelection,
      targetContainer
    )
  }

  /** Insert a character at the caret */
  private contentKey(key: string): void {
    if (!this.insertionPoint()) return
    // Open or stay inside a tracked insertion BEFORE the isolate logic, so the
    // caret the isolate moves is already the one inside the change.
    this.enterInsertion()
    this.isolateForTyping(key)
    // The caret may have moved into a fresh isolate, so re-read it
    const ip = this.insertionPoint()
    if (ip) {
      ip.before(document.createTextNode(key))
      this.normalize()
      this.updateUndo()
    }
  }

  /**
   * Typing left-to-right into a right-to-left block (or the reverse) put the
   * caret on the wrong side of the line. The caret is an element, and bidi
   * treats an empty inline as a NEUTRAL — so it resolves to the BLOCK's base
   * direction rather than to the run being typed, and lands at the far end.
   *
   * We own the caret, so we do not have to guess: when the typed character
   * disagrees with the block, put the run AND the caret inside a directional
   * isolate. The caret is then a neutral among characters of its own run and
   * resolves with them, and the run itself renders correctly too — the same
   * bug class as an un-isolated URL inside an RTL paragraph.
   *
   * Returns the isolate in force, or null when none is needed.
   */
  private isolateForTyping(key: string): HTMLElement | null {
    const ip = this.insertionPoint()
    const keyDirection = strongDirection(key)
    // Neutral characters (space, punctuation, digits) take the run they land in
    if (!ip || !keyDirection) return null

    const block = this.block(ip)
    if (!block) return null
    const blockDirection =
      block.getAttribute('dir') ?? (getComputedStyle(block).direction || 'ltr')
    if (keyDirection === blockDirection) return null

    // Extend the isolate we are already in rather than making one per keystroke
    const parent = ip.parentElement
    if (parent?.dataset.bidiRun === keyDirection) return parent

    const isolate = document.createElement('span')
    isolate.dataset.bidiRun = keyDirection
    isolate.setAttribute('dir', keyDirection)
    ip.parentNode?.insertBefore(isolate, ip)
    isolate.appendChild(ip)
    return isolate
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

    // The caret can sit INSIDE the selection: after a word or block gesture
    // resetBounds() derives the bounds from `.selected`, which lands the caret
    // within the last selected character. Deleting the selected chains would
    // take the caret with them, and an editor with no insertion point silently
    // swallows everything you type.
    const keptCaret = this.insertionPoint()
    const nodes = this.selectedLeafNodes().filter((node) => node !== keptCaret)
    if (nodes.length) {
      const firstTop = topSingleParentAncestor(nodes[0])
      if (keptCaret && firstTop.parentNode) {
        firstTop.parentNode.insertBefore(keptCaret, firstTop)
      }
      if (this.trackChanges) {
        // Wrap rather than remove: the reader needs to see what was proposed
        // for deletion, and by whom, until someone resolves it.
        this.trackDeletion(nodes.map((node) => topSingleParentAncestor(node)))
      } else {
        for (const node of nodes) {
          const top = topSingleParentAncestor(node)
          top.parentNode?.removeChild(top)
        }
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

    // Remove blocks that are now empty (no text content) after leaf node deletion
    // but keep the block containing the caret
    const caret = this.parts.doc.querySelector('.caret')
    for (const block of blocks) {
      if (
        this.parts.doc.contains(block) &&
        (!caret || !block.contains(caret)) &&
        !block.textContent?.trim()
      ) {
        block.remove()
      }
    }

    if (blocks.length > 1) {
      // Merge first and last blocks (if both still exist and aren't tables)
      const firstBlock = blocks[0]
      const lastBlock = blocks[blocks.length - 1]
      if (
        this.parts.doc.contains(firstBlock) &&
        this.parts.doc.contains(lastBlock) &&
        !firstBlock.classList.contains('editor-table') &&
        !lastBlock.classList.contains('editor-table')
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

    if (evt.altKey) {
      // Word movement: skip backwards to the start of the previous word
      this.moveWordLeft(evt.shiftKey)
    } else {
      const previous = previousLeafNode(start, this.parts.doc, deletableFilter)
      if (previous) {
        this.moveBoundsBefore(previous, evt.shiftKey)
      }
    }
  }

  /** Move caret right */
  private arrowRight(evt: KeyboardEvent): void {
    const end = this.selectable.find('.sel-end')
    if (!end) return

    if (evt.altKey) {
      // Word movement: skip forwards to the end of the next word
      this.moveWordRight(evt.shiftKey)
    } else {
      const next = nextLeafNode(end, this.parts.doc, deletableFilter)
      if (next) {
        this.moveBoundsAfter(next, evt.shiftKey)
      }
    }
  }

  /** Move caret left by one word */
  private moveWordLeft(extendSelection: boolean): void {
    const marker = this.selectable.find('.sel-start')
    if (!marker) return

    const block = this.block(marker)
    if (!block) return

    // Spanify to get character-level granularity
    spanify(block, true)

    let node: Node | null = previousLeafNode(marker, block, deletableFilter)
    if (!node) {
      spanify(block, false)
      return
    }

    // Skip whitespace characters
    while (node && node.nodeType === 3 && /^\s$/.test(node.textContent || '')) {
      node = previousLeafNode(node, block, deletableFilter)
    }
    // Skip word characters (non-whitespace)
    let last = node
    while (node && node.nodeType === 3 && /^\S$/.test(node.textContent || '')) {
      last = node
      const prev = previousLeafNode(node, block, deletableFilter)
      if (prev && prev.nodeType === 3 && /^\S$/.test(prev.textContent || '')) {
        node = prev
      } else {
        break
      }
    }
    if (last) {
      const start = this.selectable.find('.sel-start')
      const end = this.selectable.find('.sel-end')
      if (start && end) {
        last.parentNode?.insertBefore(start, last)
        if (!extendSelection) {
          start.after(end)
        }
      }
    }
    spanify(block, false)
    this.selectable.markBounds()
    this.focus()
  }

  /** Move caret right by one word */
  private moveWordRight(extendSelection: boolean): void {
    const marker = this.selectable.find('.sel-end')
    if (!marker) return

    const block = this.block(marker)
    if (!block) return

    // Spanify to get character-level granularity
    spanify(block, true)

    let node: Node | null = nextLeafNode(marker, block, deletableFilter)
    if (!node) {
      spanify(block, false)
      return
    }

    // Skip whitespace characters
    while (node && node.nodeType === 3 && /^\s$/.test(node.textContent || '')) {
      node = nextLeafNode(node, block, deletableFilter)
    }
    // Skip word characters (non-whitespace)
    let last = node
    while (node && node.nodeType === 3 && /^\S$/.test(node.textContent || '')) {
      last = node
      const next = nextLeafNode(node, block, deletableFilter)
      if (next && next.nodeType === 3 && /^\S$/.test(next.textContent || '')) {
        node = next
      } else {
        break
      }
    }
    if (last) {
      const start = this.selectable.find('.sel-start')
      const end = this.selectable.find('.sel-end')
      if (start && end) {
        last.parentNode?.insertBefore(end, last.nextSibling)
        if (!extendSelection) {
          end.parentNode?.insertBefore(start, end)
        }
      }
    }
    spanify(block, false)
    this.selectable.markBounds()
    this.focus()
  }

  /** Move bounds to before a target node */
  private moveBoundsBefore(target: Node, extendSelection: boolean): void {
    const start = this.selectable.find('.sel-start')
    const end = this.selectable.find('.sel-end')
    if (!start || !end) return

    if (target.nodeType === 3 && (target.textContent || '').length > 1) {
      // splitText returns the second half — insert before it (the last char)
      const lastChar = (target as Text).splitText(
        (target.textContent || '').length - 1
      )
      lastChar.parentNode?.insertBefore(start, lastChar)
    } else {
      target.parentNode?.insertBefore(start, target)
    }
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
  /**
   * The document's CONTENT, with every trace of the selection removed.
   *
   * Undo snapshots are full HTML and the selection lives in the DOM — bound
   * markers are elements, `.selected` is a class and sometimes a wrapper span.
   * So moving the caret changes the snapshot string even though nothing was
   * edited, and every caret move pushed an undo step that undid nothing.
   * Comparing signatures instead means only real edits create steps, while the
   * snapshots themselves keep their markers so undo still restores a selection.
   */
  private signatureOf(html: string): string {
    const scratch = document.createElement('div')
    scratch.innerHTML = html
    for (const marker of Array.from(
      scratch.querySelectorAll('.sel-start, .sel-end')
    )) {
      marker.remove()
    }
    for (const el of Array.from(
      scratch.querySelectorAll('[class], [draggable], [data-drag]')
    )) {
      el.classList.remove(
        'selected',
        'selected-block',
        'first-block',
        'last-block'
      )
      if (el.classList.length === 0) el.removeAttribute('class')
      el.removeAttribute('draggable')
      el.removeAttribute('data-drag')
    }
    // A span that carried nothing but the selection is not content
    for (const span of Array.from(scratch.querySelectorAll('span'))) {
      if (span.attributes.length === 0) {
        span.replaceWith(...Array.from(span.childNodes))
      }
    }
    scratch.normalize()
    return scratch.innerHTML
  }

  updateUndo(command?: string, reason?: string): void {
    if (this.undo.length === 0) {
      command = 'init'
    }
    if (reason && this.reasonForLastUndo === reason) {
      command = undefined
    }
    this.reasonForLastUndo = reason

    const html = this.docHTML

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
        // Selection-only change: refresh the current snapshot so it carries the
        // live selection, but do not create an undo step that undoes nothing.
        if (
          this.undo.length &&
          this.signatureOf(this.undo[0]) === this.signatureOf(html)
        ) {
          this.undo[0] = html
          break
        }
        this.undo.unshift(html)
        break
      case 'undo':
        if (this.undoDepth < this.undo.length - 1) {
          this.undoDepth++
          this.docHTML = this.undo[this.undoDepth]
          this.focus()
        }
        break
      case 'redo':
        if (this.undoDepth > 0) {
          this.undoDepth--
          this.docHTML = this.undo[this.undoDepth]
          this.focus()
        }
        break
      default:
        if (this.undoDepth || this.undo.length === 1) {
          // Same signature check as 'new': with a single snapshot in hand this
          // branch used to unshift unconditionally, so the FIRST selection
          // change after loading always created an empty undo step.
          if (
            this.undo.length &&
            this.signatureOf(this.undo[0]) === this.signatureOf(html)
          ) {
            this.undo[0] = html
            break
          }
          this.undo = this.undo.slice(this.undoDepth)
          this.undoDepth = 0
          this.undo.unshift(html)
        } else {
          this.undo[0] = html
        }
    }

    // The caret is painted from the markers' positions, so every edit moves it
    this.selectable?.onBoundsChanged?.()

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
      '[value="updateUndo undo"]'
    ) as HTMLButtonElement | null
    const redoBtn = toolbar.querySelector(
      '[value="updateUndo redo"]'
    ) as HTMLButtonElement | null
    if (undoBtn) undoBtn.disabled = this.undoDepth >= this.undo.length - 1
    if (redoBtn) redoBtn.disabled = this.undoDepth === 0
  }

  /**
   * A link inside the document is text you are editing, not navigation — a
   * click there is placing the caret. Ctrl/Cmd-click still follows it, which is
   * the convention every other editor uses.
   */
  private handleDocClick = (evt: MouseEvent): void => {
    if (!this.active) return
    const link = (evt.target as Element)?.closest?.('a')
    if (!link || !this.parts.doc.contains(link)) return
    if (evt.metaKey || evt.ctrlKey) {
      // Scheme allowlist: `javascript:` executes in the embedding page's origin
      // and `noopener` does not prevent it. `_self`/`_top`/`_parent` are
      // resolved BEFORE noopener is consulted, so a document-supplied target
      // would run it same-origin — always open a new context instead.
      const href = link.getAttribute('href') || ''
      if (isSafeNavigationUrl(href)) {
        window.open(href, '_blank', 'noopener')
      }
    }
    evt.preventDefault()
  }

  /** Handle shortcuts (ctrl/cmd+key) */
  private handleShortcut(evt: KeyboardEvent): void {
    // Find matching toolbar button
    const key = evt.key.toLowerCase()
    const shortcutStr = `${evt.ctrlKey || evt.metaKey ? 'ctrl+' : ''}${key}`

    // evt.key can be a quote or a backslash, which would close or escape the
    // attribute selector and throw SyntaxError out of the keydown listener.
    const escaped =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(shortcutStr)
        : shortcutStr.replace(/["\\]/g, '\\$&')
    const btn = this.parts.toolbar.querySelector(
      `[data-shortcut="${escaped}"]`
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

    const cell = this.caretCell()
    const ip = this.insertionPoint()
    const li = ip ? this.listItemOf(ip) : null

    switch (evt.key) {
      case 'Tab':
        evt.preventDefault()
        if (cell) {
          if (evt.shiftKey) {
            // Move to previous cell
            const prev = prevCell(cell)
            if (prev) this.moveCaretToCell(prev)
          } else {
            // Move to next cell, or create a new row if at the end
            const next = nextCell(cell)
            if (next) {
              this.moveCaretToCell(next)
            } else {
              // At last cell — create a new row
              const table = tableOf(cell)
              if (table) {
                const colCount = getColumnCount(table)
                for (let c = 0; c < colCount; c++) {
                  table.appendChild(createCell())
                }
                const newFirst = nextCell(cell)
                if (newFirst) this.moveCaretToCell(newFirst)
                this.updateUndo('new')
              }
            }
          }
        }
        break
      case 'Backspace':
        evt.preventDefault()
        if (this.deleteSelection()) {
          this.updateUndo('new')
        } else if (cell) {
          // In a table cell: don't let backspace escape the cell
          if (ip) {
            const prev = previousLeafNode(ip, cell, deletableFilter)
            if (prev) {
              if (prev.nodeType === 3 && (prev.textContent || '').length > 1) {
                prev.textContent = prev.textContent!.slice(0, -1)
              } else {
                const top = topSingleParentAncestor(prev)
                if (cell.contains(top)) {
                  top.parentNode?.removeChild(top)
                }
              }
              this.normalize()
              this.updateUndo()
            }
          }
        } else if (li) {
          this.listBackspace(li)
        } else {
          this.backspace()
        }
        break
      case 'Delete':
        evt.preventDefault()
        if (this.deleteSelection()) {
          this.updateUndo('new')
        } else if (cell) {
          // In a table cell: don't let delete escape the cell
          if (ip) {
            const next = nextLeafNode(ip, cell, deletableFilter)
            if (next) {
              if (next.nodeType === 3 && (next.textContent || '').length > 1) {
                next.textContent = next.textContent!.slice(1)
              } else {
                const top = topSingleParentAncestor(next)
                if (cell.contains(top)) {
                  top.parentNode?.removeChild(top)
                }
              }
              this.normalize()
              this.updateUndo()
            }
          }
        } else if (li) {
          this.listForwardDelete(li)
        } else {
          this.forwardDelete()
        }
        break
      case 'Enter':
        evt.preventDefault()
        if (cell) {
          if (evt.shiftKey) {
            // Shift+Enter: move to cell below, or create a new row
            this.tableMoveDown(cell)
          } else {
            // Enter: insert <br> within the cell
            if (ip) {
              ip.before(document.createElement('br'))
              this.normalize()
              this.updateUndo()
            }
          }
        } else if (li) {
          this.deleteSelection()
          this.splitListItem(li)
        } else {
          this.deleteSelection()
          this.splitAtCaret()
        }
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
        if (cell) {
          if (evt.shiftKey) {
            // Shift+ArrowUp: move up or create new row above
            this.tableMoveUp(cell)
          } else {
            const above = cellAbove(cell)
            if (above) {
              this.moveCaretToCell(above)
            } else {
              // At first row — exit table upward
              this.exitTable(cell, 'before')
            }
          }
        } else {
          this.moveVertical('up', evt.shiftKey)
        }
        break
      case 'ArrowDown':
        evt.preventDefault()
        if (cell) {
          if (evt.shiftKey) {
            // Shift+ArrowDown: move down or create new row
            this.tableMoveDown(cell)
          } else {
            const below = cellBelow(cell)
            if (below) {
              this.moveCaretToCell(below)
            } else {
              // At last row — exit table downward
              this.exitTable(cell, 'after')
            }
          }
        } else {
          this.moveVertical('down', evt.shiftKey)
        }
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

  /**
   * Insert transferred content at the caret, honouring `pastemode`.
   *
   * Shared by paste and drop deliberately: dropping and pasting the same
   * content must produce the same document, and that only stays true if there
   * is one implementation.
   */
  private insertTransfer(html?: string | null, text?: string | null): boolean {
    const ip = this.insertionPoint()
    if (!ip) return false

    // Pasted and dropped content is an insertion like any other. Unlike typing
    // it is a SINGLE change rather than a run — you did not build it a keystroke
    // at a time, and a reviewer wants to accept or reject the paste, not its
    // individual words. So it gets its own mark regardless of what the caret
    // was already inside.
    const target = this.trackChanges ? this.openInsertion() : null
    const before = (node: Node): void => {
      if (target) target.appendChild(node)
      else ip.before(node)
    }

    if (this.pastemode === 'remove' || !html) {
      if (!text) {
        target?.remove()
        return false
      }
      before(document.createTextNode(text))
    } else {
      const temp = document.createElement('div')
      temp.innerHTML = html
      // Sanitize while the nodes are still detached. This is the single shared
      // choke point for paste AND drop, which is why it is the right place:
      // anything that reaches the document from outside passes through here.
      this.sanitize(temp)
      while (temp.firstChild) {
        before(temp.firstChild)
      }
    }
    if (target && !target.firstChild) target.remove()
    return true
  }

  private handlePaste = (evt: ClipboardEvent): void => {
    if (!this.active) return

    const html = evt.clipboardData?.getData('text/html')
    const text = evt.clipboardData?.getData('text/plain')

    this.deleteSelection()
    this.insertTransfer(html, text)

    this.normalize()
    this.updateUndo('new')
    evt.preventDefault()
  }

  /** True while a drag that STARTED in this editor is in flight */
  private draggingSelection = false

  /**
   * Offer the selection as a draggable object in both representations, so the
   * receiver picks: styled markup for a rich target, clean text for a plain one.
   */
  private handleDragStart = (evt: DragEvent): void => {
    if (!this.active || !evt.dataTransfer) return
    const selected = this.selectable.findAll('.selected')
    if (selected.length === 0) return

    const container = document.createElement('div')
    for (const el of selected) container.appendChild(el.cloneNode(true))
    evt.dataTransfer.setData('text/html', container.innerHTML)
    evt.dataTransfer.setData('text/plain', container.textContent || '')
    evt.dataTransfer.effectAllowed = 'copyMove'
    this.draggingSelection = true
  }

  /**
   * The drop indicator IS the caret — we own it, so there is no separate
   * insertion bar to keep in sync with where the text will actually land.
   */
  private handleDragOver = (evt: DragEvent): void => {
    if (!this.active) return
    evt.preventDefault()
    if (evt.dataTransfer) {
      evt.dataTransfer.dropEffect = evt.altKey ? 'copy' : 'move'
    }
    const target = evt.target as Element
    if (target instanceof Element) {
      this.selectable.placeCaretAt(evt.clientX, evt.clientY)
    }
  }

  private handleDrop = (evt: DragEvent): void => {
    if (!this.active || !evt.dataTransfer) return
    evt.preventDefault()

    const internal = this.draggingSelection
    this.draggingSelection = false

    // Dropping a selection onto itself is a no-op, not a self-destruct
    const caret = this.insertionPoint()
    if (internal && caret?.closest('.selected')) {
      this.clearDraggable()
      return
    }

    const files = Array.from(evt.dataTransfer.files || [])
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length) {
      void this.insertDroppedImages(images)
      this.clearDraggable()
      return
    }

    const html = evt.dataTransfer.getData('text/html')
    const text = evt.dataTransfer.getData('text/plain')

    // Move WITHIN the editor; Alt copies. A drop outside this editor never
    // reaches here, so leaving the editor is always a copy — the source
    // document is never edited by something we cannot see the result of.
    if (internal && !evt.altKey) {
      this.deleteSelection()
    } else {
      this.selectable.unmark()
    }
    this.clearDraggable()
    this.insertTransfer(html, text)
    this.normalize()
    this.updateUndo('new')
    this.focus()
  }

  private handleDragEnd = (): void => {
    // Never delete here: a drop outside this editor is a copy by design
    this.draggingSelection = false
    this.clearDraggable()
  }

  private clearDraggable(): void {
    for (const el of Array.from(
      this.parts.doc.querySelectorAll('[draggable]')
    )) {
      el.removeAttribute('draggable')
      el.removeAttribute('data-drag')
    }
  }

  /** Read dropped image files in as data URIs */
  private async insertDroppedImages(images: File[]): Promise<void> {
    for (const file of images) {
      const url: string = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.readAsDataURL(file)
      })
      if (url) this.doCommandWith('insertImage', url, file.name)
    }
  }

  /** Find the cell edge near a pointer position, returns [table, colIndex] or null */
  private cellEdgeAt(evt: PointerEvent): [HTMLElement, number] | null {
    const target = evt.target as Element
    const cell = target.closest('.editor-table > li') as HTMLElement | null
    if (!cell) return null
    const table = cell.parentElement
    if (!table || !table.classList.contains('editor-table')) return null

    const rect = cell.getBoundingClientRect()
    const colCount = getColumnCount(table)
    const col = colOfCell(cell, colCount)
    const edgeThreshold = 4

    // Check right edge (resize column to the right)
    if (
      Math.abs(evt.clientX - rect.right) < edgeThreshold &&
      col < colCount - 1
    ) {
      return [table, col]
    }
    // Check left edge (resize column to the left)
    if (Math.abs(evt.clientX - rect.left) < edgeThreshold && col > 0) {
      return [table, col - 1]
    }
    return null
  }

  // ---- Touch affordance methods ----

  /** Update position of touch affordance handles based on selection bounds */
  private updateTouchAffordances(): void {
    if (!this.touchAffordances) return

    // Clearing the padding moves every line back, so the caret has to be
    // repainted on the way OUT as well as on the way in. The ResizeObserver
    // should also catch this, but the caret is cheap (0.015ms) and correctness
    // here should not depend on which box the host's layout happens to change.
    if (!this.isTouchInteraction && !this.touchMenuEl) {
      this.touchAffordances.style.display = 'none'
      this.parts.doc.style.paddingTop = ''
      this.parts.doc.style.paddingBottom = ''
      this.syncCaret()
      return
    }

    const selStart = this.parts.doc.querySelector('.sel-start')
    const selEnd = this.parts.doc.querySelector('.sel-end')
    if (!selStart || !selEnd) {
      this.touchAffordances.style.display = 'none'
      this.parts.doc.style.paddingTop = ''
      this.parts.doc.style.paddingBottom = ''
      this.syncCaret()
      return
    }

    const docRect = this.parts.doc.getBoundingClientRect()
    const startRect = this.markerRect(selStart)
    const endRect = this.markerRect(selEnd)

    // Check if padding is needed (skip during drag)
    if (this.touchDrags.size === 0) {
      // Subtract existing padding to check where selection would be without it
      const existingTopPad = parseFloat(this.parts.doc.style.paddingTop) || 0
      const existingBottomPad =
        parseFloat(this.parts.doc.style.paddingBottom) || 0
      const selTop = Math.min(startRect.top, endRect.top) - 48 - existingTopPad
      const selBottom =
        Math.max(startRect.bottom, endRect.bottom) + 48 + existingBottomPad
      const wantTop = selTop < docRect.top ? '52px' : ''
      const wantBottom = selBottom > docRect.bottom ? '52px' : ''
      const hadTop = this.parts.doc.style.paddingTop
      const hadBottom = this.parts.doc.style.paddingBottom
      if (wantTop !== hadTop || wantBottom !== hadBottom) {
        this.parts.doc.style.paddingTop = wantTop
        this.parts.doc.style.paddingBottom = wantBottom
      }
    }

    // Show them straight away, wherever the text is NOW. If the padding just
    // changed, the ResizeObserver repositions them as the transition animates,
    // so they follow the text instead of being hidden for a guessed 160ms and
    // reappearing. That guess also had a failure mode this does not: if the
    // transition never ran, the affordances stayed invisible.
    this.positionAffordances()
    this.touchAffordances.style.display = 'block'
    this.touchAffordances.style.opacity = '1'
  }

  private positionAffordances(): void {
    const selStart = this.parts.doc.querySelector('.sel-start')
    const selEnd = this.parts.doc.querySelector('.sel-end')
    if (!selStart || !selEnd) return

    const docRect = this.parts.doc.getBoundingClientRect()
    const startRect = this.markerRect(selStart)
    const endRect = this.markerRect(selEnd)

    const startX = startRect.left - docRect.left + this.parts.doc.scrollLeft
    const startY = startRect.top - docRect.top + this.parts.doc.scrollTop
    const endX = endRect.right - docRect.left + this.parts.doc.scrollLeft
    const endY = endRect.bottom - docRect.top + this.parts.doc.scrollTop

    const isCollapsed = selStart.nextElementSibling === selEnd

    if (isCollapsed) {
      this.touchHandleStart!.style.left = `${startX - 44}px`
      this.touchHandleStart!.style.top = `${startY - 44}px`
      this.touchContextMenu!.style.left = `${startX}px`
      this.touchContextMenu!.style.top = `${startY - 44}px`
      this.touchHandleEnd!.style.left = `${endX}px`
      this.touchHandleEnd!.style.top = `${endY}px`
    } else {
      this.touchHandleStart!.style.left = `${startX - 44}px`
      this.touchHandleStart!.style.top = `${startY - 44}px`
      this.touchHandleEnd!.style.left = `${endX}px`
      this.touchHandleEnd!.style.top = `${endY}px`
      const midX = (startX + endX) / 2 - 22
      const topY = Math.min(startY, endY) - 44
      this.touchContextMenu!.style.left = `${midX}px`
      this.touchContextMenu!.style.top = `${topY}px`
    }
  }

  private handleAffordanceDragStart = (evt: PointerEvent): void => {
    const handle = evt.currentTarget as HTMLElement
    const which = handle === this.touchHandleStart ? 'start' : 'end'
    handle.setPointerCapture(evt.pointerId)

    // The cursor position is at the handle's anchor corner offset by
    // half a line-height. A's anchor is its bottom-right, C's is top-left.
    const handleRect = handle.getBoundingClientRect()
    const markerSelector = which === 'start' ? '.sel-start' : '.sel-end'
    const marker = this.parts.doc.querySelector(markerSelector)
    const rawLineHeight = marker
      ? parseFloat(getComputedStyle(marker).lineHeight)
      : NaN
    const halfLine = isNaN(rawLineHeight) ? 10 : rawLineHeight / 2

    let offsetX: number
    let offsetY: number
    if (which === 'start') {
      offsetX = handleRect.right - evt.clientX
      offsetY = handleRect.bottom + halfLine - evt.clientY
    } else {
      offsetX = handleRect.left - evt.clientX
      offsetY = handleRect.top - halfLine - evt.clientY
    }

    this.touchDrags.set(evt.pointerId, {
      target: which,
      offsetX,
      offsetY,
    })

    // Dismiss context menu when starting a drag
    this.hideTouchMenu()

    // Disable transitions during drag
    this.touchAffordances!.classList.add('dragging')

    evt.preventDefault()
    evt.stopPropagation()
  }

  private handleAffordanceDragMove = (evt: PointerEvent): void => {
    const drag = this.touchDrags.get(evt.pointerId)
    if (!drag) return

    // Apply offset so the cursor position is below/above the finger
    const cursorX = evt.clientX + drag.offsetX
    const cursorY = evt.clientY + drag.offsetY

    // Temporarily hide affordances to find element at the offset position
    const affordanceEl = evt.currentTarget as HTMLElement
    affordanceEl.style.pointerEvents = 'none'
    this.touchAffordances!.style.pointerEvents = 'none'
    const elementAtPoint = this.shadowRoot!.elementFromPoint(cursorX, cursorY)
    affordanceEl.style.pointerEvents = 'auto'
    this.touchAffordances!.style.pointerEvents = ''

    if (
      !elementAtPoint ||
      elementAtPoint.closest('.not-selectable') ||
      elementAtPoint.classList.contains('not-selectable')
    ) {
      return
    }

    // Measured, not spanified. Dragging a selection handle used to wrap the
    // whole target block in per-character spans on every pointer move.
    const hit = characterAtPoint(this.parts.doc, cursorX, cursorY)
    if (!hit) return

    const markerSelector = drag.target === 'start' ? '.sel-start' : '.sel-end'
    const marker = this.parts.doc.querySelector(markerSelector)

    if (marker) {
      const range = document.createRange()
      range.setStart(hit.node, hit.after ? hit.offset + 1 : hit.offset)
      range.collapse(true)
      range.insertNode(marker)
      this.parts.doc.normalize()
      this.selectable.markBounds()

      // Just move the dragged handle to follow the pointer
      const docRect = this.parts.doc.getBoundingClientRect()
      const handle = evt.currentTarget as HTMLElement
      const handleX = evt.clientX - docRect.left + this.parts.doc.scrollLeft
      const handleY = evt.clientY - docRect.top + this.parts.doc.scrollTop
      handle.style.left = `${handleX - 22}px`
      handle.style.top = `${handleY - 22}px`
    }

    evt.preventDefault()
    evt.stopPropagation()
  }

  private handleAffordanceDragEnd = (evt: PointerEvent): void => {
    if (!this.touchDrags.has(evt.pointerId)) return

    const handle = evt.currentTarget as HTMLElement
    handle.releasePointerCapture(evt.pointerId)
    this.touchDrags.delete(evt.pointerId)

    // Only despanify when all drags are done
    if (this.touchDrags.size === 0) {
      this.selectable.despanify()
      this.selectable.selectionChanged()
      // Remove dragging class after reposition so handles settle with transition
      requestAnimationFrame(() => {
        this.touchAffordances!.classList.remove('dragging')
      })
    }

    evt.preventDefault()
    evt.stopPropagation()
  }

  private handleTouchContextMenu = (evt: Event): void => {
    evt.preventDefault()
    evt.stopPropagation()

    if (this.touchMenuEl) {
      this.hideTouchMenu()
      return
    }
    this.showTouchMenu(evt)
  }

  private showTouchMenu(openedBy: Event): void {
    this.hideTouchMenu()

    const menu = document.createElement('div')
    menu.className = 'touch-menu not-selectable do-not-spanify'

    const selectedText = () =>
      this.selectable
        .findAll('.selected')
        .map((el) => el.textContent)
        .join('')

    const actions: Array<{ label: string; action: () => void }> = [
      {
        label: 'Cut',
        action: () => {
          const text = selectedText()
          if (!text) return
          navigator.clipboard.writeText(text)
          this.deleteSelection()
          this.updateUndo('new')
        },
      },
      {
        label: 'Copy',
        action: () => {
          navigator.clipboard.writeText(selectedText())
        },
      },
      {
        label: 'Paste',
        action: () => {
          navigator.clipboard.readText().then((text) => {
            if (text) {
              this.deleteSelection()
              const ip = this.insertionPoint()
              if (ip) {
                ip.before(document.createTextNode(text))
                this.normalize()
                this.updateUndo('new')
              }
            }
          })
        },
      },
      {
        label: 'Delete',
        action: () => {
          this.deleteSelection()
          this.updateUndo('new')
        },
      },
      {
        label: 'Bold',
        action: () => this.doCommand('setText font-weight bold'),
      },
      {
        label: 'Italic',
        action: () => this.doCommand('setText font-style italic'),
      },
      {
        label: 'Plain',
        action: () =>
          this.doCommand(
            'setText font-weight normal; setText font-style normal; setText text-decoration none'
          ),
      },
    ]

    for (const { label, action } of actions) {
      const btn = document.createElement('button')
      btn.className = 'touch-menu-item not-selectable'
      btn.textContent = label
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        e.preventDefault()
        action()
        this.hideTouchMenu()
      })
      menu.appendChild(btn)
    }

    // Add close button
    const closeBtn = document.createElement('button')
    closeBtn.className = 'touch-menu-item touch-menu-close not-selectable'
    closeBtn.textContent = '\u00D7'
    closeBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      e.preventDefault()
      this.hideTouchMenu()
    })
    menu.appendChild(closeBtn)

    // Position above the context menu button, clamped to doc boundaries
    const bRect = this.touchContextMenu!.getBoundingClientRect()
    const docRect = this.parts.doc.getBoundingClientRect()
    const menuWidth = (actions.length + 1) * 70
    let menuLeft =
      bRect.left - docRect.left + this.parts.doc.scrollLeft + 22 - menuWidth / 2
    // Clamp horizontally
    if (menuLeft < 0) menuLeft = 4
    if (menuLeft + menuWidth > docRect.width)
      menuLeft = docRect.width - menuWidth - 4
    menu.style.left = `${menuLeft}px`
    let menuTop = bRect.top - docRect.top + this.parts.doc.scrollTop - 44
    // If menu would clip above doc, position below the context menu button instead
    if (menuTop < 0) {
      menuTop = bRect.bottom - docRect.top + this.parts.doc.scrollTop + 4
    }
    menu.style.top = `${menuTop}px`

    this.touchMenuEl = menu
    this.touchAffordances!.appendChild(menu)

    // Dismiss when tapping outside the menu. The listener goes on immediately
    // rather than being deferred by a timeout, which guessed at ordering and
    // left a window in which an outside tap did not dismiss.
    //
    // The `openedBy` check is DEFENCE IN DEPTH, not the load-bearing guard:
    // handleTouchContextMenu calls stopPropagation() before this runs, so the
    // opening event does not reach the doc listener today. It is kept, and the
    // argument is required, so that removing that stopPropagation() later
    // cannot silently make the menu close the instant it opens.
    this.touchMenuDismiss = (e: Event) => {
      if (e === openedBy) return
      if (this.touchMenuEl && !this.touchMenuEl.contains(e.target as Node)) {
        this.hideTouchMenu()
      }
    }
    this.parts.doc.addEventListener('pointerdown', this.touchMenuDismiss)
  }

  private touchMenuDismiss: ((e: Event) => void) | null = null

  private hideTouchMenu(): void {
    if (this.touchMenuDismiss) {
      this.parts.doc.removeEventListener('pointerdown', this.touchMenuDismiss)
      this.touchMenuDismiss = null
    }
    if (this.touchMenuEl) {
      this.touchMenuEl.remove()
      this.touchMenuEl = null
    }
  }

  private handleResizePointerDown = (evt: PointerEvent): void => {
    const edge = this.cellEdgeAt(evt)
    if (!edge) return

    const [table, col] = edge
    this.resizeTable = table
    this.resizeCol = col
    this.resizeStartX = evt.clientX

    // Get current pixel widths from the table's actual rendered columns
    const firstRowCells = getCellsInRow(table, 0, getColumnCount(table))
    this.resizeStartWidths = firstRowCells.map(
      (c) => c.getBoundingClientRect().width
    )

    evt.preventDefault()
    evt.stopPropagation()
    this.parts.doc.setPointerCapture(evt.pointerId)
  }

  private handleResizePointerMove = (evt: PointerEvent): void => {
    // Update cursor when hovering near cell edges
    if (!this.resizeTable) {
      const edge = this.cellEdgeAt(evt)
      this.parts.doc.style.cursor = edge ? 'col-resize' : ''
      return
    }

    // Active resize drag
    const dx = evt.clientX - this.resizeStartX
    const newWidths = [...this.resizeStartWidths]
    newWidths[this.resizeCol] = Math.max(30, newWidths[this.resizeCol] + dx)
    newWidths[this.resizeCol + 1] = Math.max(
      30,
      newWidths[this.resizeCol + 1] - dx
    )

    setColumnWidths(
      this.resizeTable,
      newWidths.map((w) => `${w}px`)
    )
  }

  private handleResizePointerUp = (evt: PointerEvent): void => {
    if (this.resizeTable) {
      this.updateUndo('new')
      this.resizeTable = null
      this.resizeCol = -1
      this.parts.doc.style.cursor = ''
      this.parts.doc.releasePointerCapture(evt.pointerId)
    }
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
    if (!value) return

    // A select in the bars is not necessarily a command source. The locale
    // picker is a <select> whose value is a locale code, so every locale change
    // ran `doCommand('en')` and logged "unrecognized command en" — and a locale
    // code that happened to match a command name would have RUN it. Only act
    // when the value actually names a command; anything else belongs to a
    // widget that is not ours.
    const name = value.trim().split(/[\s;]/)[0]
    if (!name || !(name in this.commands)) return

    this.doCommand(value)
  }
}

// Register the footnote element alongside the editor: a document LOADED with
// existing footnote markup must upgrade its markers, not only documents where
// someone runs insertFootnote.
defineFootnote()

export const tosijsStyledEditor =
  TosijsStyledEditor.elementCreator() as ElementCreator<TosijsStyledEditor>

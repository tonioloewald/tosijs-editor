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

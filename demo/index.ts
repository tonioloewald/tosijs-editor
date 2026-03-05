import { tosiEditable, type TosiEditable } from '../src/tosi-editable'
import { defaultToolbar, defaultMenubar } from '../src/toolbar'

const container = document.getElementById('editor-container')!

const editor = tosiEditable() as TosiEditable

// Set initial content before appending (will be picked up by connectedCallback)
editor.value = `
  <h2>Welcome to tosi-editable</h2>
  <p>This is an experimental rich text editor that <b>does not use</b> <code>contentEditable</code>,
  <code>execCommand</code>, or the browser's native selection APIs.</p>
  <p>Instead, it manages everything through direct DOM manipulation, giving you
  full control over editing behavior.</p>
  <h3>Features</h3>
  <p>Try out the menus and toolbar above to format text. You can:</p>
  <ul>
    <li>Change paragraph styles (headings, body, code blocks)</li>
    <li>Apply <b>bold</b>, <i>italic</i>, and <u>underline</u> formatting</li>
    <li>Align text left, center, right, or justified</li>
    <li>Change font family and size</li>
    <li>Undo and redo changes</li>
  </ul>
  <p>Click anywhere to place the cursor and start typing!</p>
`

// Add to DOM first so connectedCallback runs and editor is initialized
container.appendChild(editor)

// Add menubar items (tosi-menu elements, slot="menubar")
for (const menu of defaultMenubar(editor)) {
  editor.appendChild(menu)
}

// Add toolbar buttons (slot="toolbar")
for (const widget of defaultToolbar()) {
  widget.setAttribute('slot', 'toolbar')
  editor.appendChild(widget)
}

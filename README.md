# tosijs-styled-editor

Rich text editor web component — **no `contentEditable`**, **no browser selection APIs**, **no `execCommand`**.

All selection and editing is handled through direct DOM manipulation, giving full control
over editing behavior with none of the compatibility and accessibility nightmares of
`contentEditable`.

[Live demo](https://tonioloewald.github.io/editor2/)

## Installation

```bash
npm install tosijs-styled-editor
```

Peer dependencies: `tosijs`, `tosijs-ui`

## Usage

```html
<tosi-styled-editor>
  <p>Edit this text!</p>
  <p>It supports <b>bold</b>, <i>italic</i>, and more.</p>
</tosi-styled-editor>
```

```css
tosi-styled-editor {
  background: white;
  border: 1px solid #ccc;
  min-height: 200px;
}
tosi-styled-editor [part="toolbar"] {
  background: #f8f8f8;
  border-bottom: 1px solid #ccc;
}
```

### Setting up toolbars and menus

```typescript
import { tosiEditable, type TosiEditable } from 'tosijs-styled-editor'
import { defaultToolbar, defaultMenubar } from 'tosijs-styled-editor'

const editor = tosiEditable() as TosiEditable
editor.value = '<p>Hello world</p>'
document.body.appendChild(editor)

// Add menus (slot="menubar")
for (const menu of defaultMenubar(editor)) {
  editor.appendChild(menu)
}

// Add toolbar buttons (slot="toolbar")
for (const widget of defaultToolbar()) {
  widget.setAttribute('slot', 'toolbar')
  editor.appendChild(widget)
}
```

## How It Works

The editor uses three layers:

1. **DOM utilities** (`dom-utils.ts`) — leaf-node traversal; nearly all operations work with leaf nodes
2. **Selection** (`selection.ts`) — custom selection via "spanification" (wrapping characters in `<span>` elements to determine exact positions without browser APIs)
3. **Commands** (`commands.ts`) — extensible command system for formatting and editing

The caret is an `<input>` element, so mobile browsers show their keyboard automatically.

## Keyboard Behavior

### General editing

| Key | Action |
|---|---|
| **Typing** | Inserts character at caret; replaces selection if any |
| **Backspace** | Deletes character before caret, or deletes selection |
| **Delete** | Deletes character after caret, or deletes selection |
| **Enter** | Splits the current block at the caret |
| **ArrowLeft / ArrowRight** | Moves caret one character |
| **ArrowUp / ArrowDown** | Moves caret one visual line, maintaining horizontal position |
| **Alt+ArrowLeft / Alt+ArrowRight** | Moves caret one word |
| **Shift+Arrow** | Extends selection |

### Mouse selection

| Action | Selects |
|---|---|
| **Click** | Places caret at character position |
| **Shift+Click** | Extends selection to click position |
| **Double-click** | Selects word |
| **Triple-click** | Selects block |
| **Click-drag** | Selects character range |

### Inside a table cell

| Key | Action |
|---|---|
| **Tab** | Move to next cell; at last cell, creates a new row |
| **Shift+Tab** | Move to previous cell |
| **ArrowDown** | Move to cell below; at last row, exit table downward |
| **ArrowUp** | Move to cell above; at first row, exit table upward |
| **Shift+Enter** | Move to cell below (same column); at last row, creates a new row |
| **Shift+ArrowDown** | Same as Shift+Enter |
| **Enter** | Insert line break (`<br>`) within the cell |
| **Backspace / Delete** | Delete within cell only (won't escape the cell) |

### Inside a list item (`<ul>/<ol>`)

| Key | Action |
|---|---|
| **Enter** | Split into a new list item; if item is empty, exit the list as a `<p>` |
| **Backspace** | Delete within item; at start, merge with previous item or exit list |
| **Delete** | Delete within item; at end, merge with next item |

### Keyboard shortcuts

Shortcuts are defined by toolbar buttons via `data-shortcut` attributes. The default toolbar provides:

| Shortcut | Action |
|---|---|
| **Ctrl/Cmd+B** | Bold |
| **Ctrl/Cmd+I** | Italic |
| **Ctrl/Cmd+U** | Underline |
| **Ctrl/Cmd+Z** | Undo |
| **Ctrl/Cmd+Y** | Redo |

## Commands

Commands are invoked via `editor.doCommand(commandString)`. Multiple commands
can be chained with semicolons.

### Character styling — `setText`

Applies CSS to selected characters:

```
setText font-weight bold
setText font-style italic
setText text-decoration underline
setText background-color rgba(255,255,64,0.5)
setText font-family Helvetica
setText font-size 18px
```

Use `+` for spaces in values: `setText font-family Times+New+Roman`

### Block type — `setBlockType`

Changes the element type of selected blocks:

```
setBlockType h1
setBlockType p
setBlockType pre
setBlockType blockquote
```

### Block styling — `setBlocks`

Applies CSS to selected blocks:

```
setBlocks text-align center
setBlocks margin-left 40px
setBlocks line-height 2.5
```

### Table commands

```
insertTable 3              # 3 columns, 2 rows (1 header)
insertTable 4 5 1          # 4 columns, 5 rows, 1 header row
insertTableRow after       # Insert row after current
insertTableRow before      # Insert row before current
insertTableCol after       # Insert column after current
insertTableCol before      # Insert column before current
deleteTableRow             # Delete current row
deleteTableCol             # Delete current column
toggleHeaderRow            # Toggle header styling on current row
```

Column widths can be resized by dragging cell borders.

### Other commands

```
updateUndo undo
updateUndo redo
setDebug                   # Toggle debug visualization
annotate note              # Insert annotation at caret
```

## Tables

Tables use CSS Grid layout instead of `<table>` elements:

```html
<ul class="editor-table" style="grid-template-columns: 1fr 1fr 1fr">
  <li class="table-header">Name</li>
  <li class="table-header">Role</li>
  <li class="table-header">Location</li>
  <li>Alice</li>
  <li>Engineer</li>
  <li>New York</li>
</ul>
```

## Extending the editor

Add custom commands by extending `editor.commands`:

```typescript
editor.commands.myCommand = (ctx, ...args) => {
  // ctx provides: root, selectable, commands, find(), findAll(),
  //   selectedLeafNodes(), selectedBlocks(), insertionPoint(),
  //   block(), normalize(), focus(), updateUndo()
  const nodes = ctx.selectedLeafNodes()
  // ... manipulate nodes ...
  ctx.updateUndo('new')
}

editor.doCommand('myCommand arg1 arg2')
```

## Component API

| Property | Type | Description |
|---|---|---|
| `value` | `string` | Get/set the editor content as HTML |
| `active` | `boolean` | Enable/disable editing |
| `pastemode` | `'merge' \| 'remove' \| 'preserve' \| 'paragraphs'` | How pasted HTML is handled |
| `commands` | `object` | Command registry (extend to add custom commands) |
| `widgets` | `'none' \| 'minimal' \| 'default'` | Attribute — built-in toolbar preset |

| Method | Description |
|---|---|
| `doCommand(str)` | Execute a command string |
| `focus()` | Focus the caret |

## License

Apache-2.0

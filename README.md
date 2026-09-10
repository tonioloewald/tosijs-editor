<!--{ "pin": "top" }-->

# A Rich Text Editor Component

```html
<tosijs-styled-editor widgets="default" localized>
  <h2>Try it</h2>
  <p>This is a live editor. Click anywhere to place the cursor and start typing,
  then use the menus and toolbar above to format what you write. The 🇬🇧 menu
  switches the interface to Suomi.</p>
  <p>Double-click selects a word, triple-click selects a block, and clicking past
  the end of a line puts the cursor at the end of that line.</p>
  <ul>
    <li>Select these two items</li>
    <li>Press the numbered-list button to renumber them</li>
  </ul>
</tosijs-styled-editor>
```

```css
tosijs-styled-editor {
  --editor-ink: #27488c;
  --editor-surface: var(--tosi-bg, Canvas);
  --editor-text: var(--tosi-text, CanvasText);
  border: 1px solid var(--editor-edge);
  border-radius: 6px;
  overflow: hidden;
  height: 340px;
  resize: vertical;
}
.preview.preview {
  padding: 0;
}
```

A pure web-component. What it does **not** use:

- No `document.execCommand`
- No `contentEditable`
- No horrible browser selection and Range APIs

What you get instead:

- Fully styleable selections
- Exact control over editing behavior
- Exact control over cursor behavior
- Touch-friendly selection

## Development

```bash
bun install
bun run tls     # once — locally-trusted dev certs (needs mkcert)
bun start       # dev server + doc site on https://localhost:8789
bun test        # unit tests
bun run lint    # typecheck, including unused locals/params
bun run format  # Prettier
bun run make    # full build (NOT `bun run build` — `bun build` is a Bun builtin)
```

`bin/site.ts` is the only build/dev entry; it wraps tosijs-ui's doc system and
is configured in `tosijs-editor-site.config.ts`.

Live site and docs: <https://editor.tosijs.net>

## Installation

```bash
npm install tosijs-styled-editor
```

Peer dependencies: `tosijs`, `tosijs-ui`

## Usage

Drop it in and it is editable. `widgets` picks a built-in toolbar preset —
`none` (the default), `minimal`, or `default` (toolbar + menus), as in the
example above.

```xml
<tosijs-styled-editor widgets="default">
  <p>Edit this text!</p>
  <p>It supports <b>bold</b>, <i>italic</i>, and more.</p>
</tosijs-styled-editor>
```

The whole chrome is mixed from one custom property, so re-theming is a single
value:

```xml
<style>
  tosijs-styled-editor { --editor-ink: #27488c; }
</style>
```

### Setting up toolbars and menus

```typescript
import { tosijsStyledEditor, type TosijsStyledEditor } from 'tosijs-styled-editor'
import { defaultToolbar, defaultMenubar } from 'tosijs-styled-editor'

const editor = tosijsStyledEditor() as TosijsStyledEditor
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

| Key                                | Action                                                       |
| ---------------------------------- | ------------------------------------------------------------ |
| **Typing**                         | Inserts character at caret; replaces selection if any        |
| **Backspace**                      | Deletes character before caret, or deletes selection         |
| **Delete**                         | Deletes character after caret, or deletes selection          |
| **Enter**                          | Splits the current block at the caret                        |
| **ArrowLeft / ArrowRight**         | Moves caret one character                                    |
| **ArrowUp / ArrowDown**            | Moves caret one visual line, maintaining horizontal position |
| **Alt+ArrowLeft / Alt+ArrowRight** | Moves caret one word                                         |
| **Shift+Arrow**                    | Extends selection                                            |

### Mouse selection

| Action           | Selects                             |
| ---------------- | ----------------------------------- |
| **Click**        | Places caret at character position  |
| **Shift+Click**  | Extends selection to click position |
| **Double-click** | Selects word                        |
| **Triple-click** | Selects block                       |
| **Click-drag**   | Selects character range             |

### Inside a table cell

| Key                    | Action                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| **Tab**                | Move to next cell; at last cell, creates a new row               |
| **Shift+Tab**          | Move to previous cell                                            |
| **ArrowDown**          | Move to cell below; at last row, exit table downward             |
| **ArrowUp**            | Move to cell above; at first row, exit table upward              |
| **Shift+Enter**        | Move to cell below (same column); at last row, creates a new row |
| **Shift+ArrowDown**    | Same as Shift+Enter                                              |
| **Enter**              | Insert line break (`<br>`) within the cell                       |
| **Backspace / Delete** | Delete within cell only (won't escape the cell)                  |

### Inside a list item (`<ul>/<ol>`)

| Key           | Action                                                                 |
| ------------- | ---------------------------------------------------------------------- |
| **Enter**     | Split into a new list item; if item is empty, exit the list as a `<p>` |
| **Backspace** | Delete within item; at start, merge with previous item or exit list    |
| **Delete**    | Delete within item; at end, merge with next item                       |

### Keyboard shortcuts

Shortcuts are defined by toolbar buttons via `data-shortcut` attributes. The default toolbar provides:

| Shortcut       | Action    |
| -------------- | --------- |
| **Ctrl/Cmd+B** | Bold      |
| **Ctrl/Cmd+I** | Italic    |
| **Ctrl/Cmd+U** | Underline |
| **Ctrl/Cmd+Z** | Undo      |
| **Ctrl/Cmd+Y** | Redo      |

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

### Links, images and footnotes

```
setLink https://example.com          # wraps the selection; opens in a new tab
setLink https://example.com _self    # same tab
setLink https://example.com pane     # a named target
removeLink                           # unwrap, keeping the text
insertImage https://host/cat.png A cat
insertFootnote optional initial text
renumberFootnotes                    # recompute after editing by hand
```

Links default to `target="_blank"` and get `rel="noopener"` with it — without
that, the opened page receives a live `window.opener` reference back to yours.
Pass `_self` to clear both.

Footnote **numbers are never stored**; they are derived from document order, so
inserting one in the middle renumbers the rest and reorders the list to match.
Deleting a marker drops its entry on the next renumber, and deleting the last
one removes the list. The stable identity is `data-footnote`, not the number.

Inside the editor a link is text you are editing, so clicking it places the
caret rather than navigating. Ctrl/Cmd-click follows it.

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

```xml
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

## Localization

Add `localized` and the built-in widgets translate themselves, with a flag-only
language picker in the menubar:

```xml
<tosijs-styled-editor widgets="default" localized></tosijs-styled-editor>
```

Strings live in one tab-separated table, `localized-strings.tsv`. **To add a
language, add a column** — nothing else changes:

```
en	fi
(row 1 is ignored — notes go here)
English	Suomi
🇬🇧	🇫🇮
Bold	Lihavointi
Italic	Kursivointi
```

Row 0 is the locale codes, row 2 the language names, row 3 the flag emoji, and
every row after that is one string. **Column 0 is both the lookup key and the
English text**, so a missing cell or a missing row falls back to English rather
than showing a key — you can ship a half-translated column safely. A `"` cell
means "same as English", which is what proper nouns and numerals use.

Load it once at startup:

```typescript
import { initLocalization } from 'tosijs-ui'

initLocalization(await (await fetch('/localized-strings.txt')).text())
```

A doc site built on `tosijs-ui/site` does this for you — pass the table as
`localizedStrings` in the site config.

Under the hood this is tosijs-ui's convention, not a private one: buttons carry
`data-tosi-localized` (a JSON map of attribute to key, re-applied on locale
change), menus set `localized`, and menu labels are `<tosi-localized>` elements.
Custom widgets you add follow the same rules and get translated too.

## Component API

| Property    | Type                                                | Description                                                           |
| ----------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `value`     | `string`                                            | Get/set the editor content as HTML                                    |
| `active`    | `boolean`                                           | Enable/disable editing                                                |
| `pastemode` | `'merge' \| 'remove' \| 'preserve' \| 'paragraphs'` | How pasted HTML is handled                                            |
| `commands`  | `object`                                            | Command registry (extend to add custom commands)                      |
| `widgets`   | `'none' \| 'minimal' \| 'default'`                  | Attribute — built-in toolbar preset                                   |
| `localized` | `boolean`                                           | Attribute — translate the built-in widgets and show a language picker |

| Method           | Description              |
| ---------------- | ------------------------ |
| `doCommand(str)` | Execute a command string |
| `focus()`        | Focus the caret          |

## License

Apache-2.0

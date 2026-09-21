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
}
```

A pure web-component. What it does **not** use:

- No `document.execCommand`
- No `contentEditable`
- No `getSelection`, no browser selection model, no `execCommand`-era APIs

Range is used, but only as a **measuring tape** — `getBoundingClientRect()` to
ask the layout engine where a character is. It is never a selection model, and
nothing is handed back to the browser to edit.

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

**Peer dependencies** (you install these): `tosijs`, `tosijs-ui`

**Runtime dependency** (installed automatically):
[`tosijs-kilpi`](https://github.com/tonioloewald/kilpi) — the sanitizer applied
to pasted and dropped content. It has no dependencies of its own and is about
0.8 kB gzipped. The drop-in `dist/index.js` build bundles it; the ESM build
leaves it external so you get one copy if you also depend on it directly.

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
2. **Selection** (`selection.ts`) — a custom selection model. Character positions are found by MEASURING with a Range, which does not touch the document; wrapping characters in spans to measure them changes the thing being measured (it breaks shaping, so cursive scripts come apart and lines re-wrap)
3. **Commands** (`commands.ts`) — extensible command system for formatting and editing

The caret is an `<input>` element, so mobile browsers show their keyboard automatically.

## Security: what is sanitized, and what is not

Replacing `contentEditable` also means replacing the sanitization the browser was
doing on your behalf.

**Sanitized** — content arriving from outside the document, which is the path an
attacker controls: **paste** and **drop**, both through one shared choke point.

The filtering itself is [`tosijs-kilpi`](https://github.com/tonioloewald/kilpi),
and **[its SECURITY.md is the authoritative policy](https://github.com/tonioloewald/kilpi/blob/main/SECURITY.md)** —
read it before relying on this. It is deliberately not restated here, because a
copy of a policy drifts from the policy. The one thing worth repeating, because
it is a trade rather than a detail:

> kilpi is a **denylist** for elements and attributes and an **allowlist** for URL
> schemes. That is why unknown elements survive — your plugin markup round-trips
> intact — and it is also why an element that becomes dangerous in a future
> browser, and that kilpi has never heard of, would pass through. If protection
> from the not-yet-known matters more to you than preserving unknown markup, use
> DOMPurify instead (see the hook below).

**NOT sanitized** — content you supply, which is inside your own trust boundary:

- `editor.value = html`
- initial light-DOM content

**If you are upgrading from 0.4.3 or earlier:** documents your users created
before 0.4.4 may already contain a payload that was pasted in, and this component
cannot fix that for you — setting `value` does not filter. Sanitize your stored
corpus as part of the upgrade.

**Using a different sanitizer.** `editor.sanitize` is the hook — it receives a
detached element and mutates it:

```javascript
editor.sanitize = (root) => {
  DOMPurify.sanitize(root, {
    IN_PLACE: true,
    FORBID_TAGS: ['style'],
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: /^[a-z][a-z0-9]*-[a-z0-9-]*$/,
      attributeNameCheck: /^data-|^slot$|^dir$/,
    },
  })
}
```

It takes an element rather than an HTML string on purpose: a string signature
would force a serialize-and-reparse round trip, and that round trip is where
mutation XSS lives. Note the `CUSTOM_ELEMENT_HANDLING` block — DOMPurify unwraps
unknown custom elements by default, which would discard plugin markup kilpi
preserves.

**Reporting a vulnerability.** If it is in the sanitizer, file it against
[kilpi](https://github.com/tonioloewald/kilpi/issues) — that is where the code
lives. Anything else, [this repository](https://github.com/tonioloewald/tosijs-editor/issues).

## Spell checking

This editor has **no browser spell checking at all**. Browsers only check editing
hosts — `textarea`, `input`, `contenteditable` — and nothing here is one. That is
a cost of replacing `contentEditable`, and worth knowing before you assume
squiggles will appear on their own.

In exchange you get the thing a `contentEditable` editor cannot have: an
application that can *ask*.

```javascript
editor.spellChecker = (words) => new Set(words.filter((w) => !dictionary.has(w)))
await editor.checkSpelling()

editor.spellingErrors          // [{ word, element }, …] in document order
editor.validity.customError    // true — a real form submit is blocked
editor.clearSpelling()         // remove every mark, change no text
```

### Resolution is the workflow

In a jargon-heavy domain — contracts, medicine, anything with terms of art — the
usual answer to an unknown word is *"that is a real word"*, not *"I mistyped"*.
So accepting has to be as cheap as correcting, and every flagged word has to end
up resolved one way or the other.

That is what the validity is for. **The field stays invalid until every flagged
word is corrected or accepted**, so a real form submit is blocked rather than
relying on anyone to remember to look.

Accepting has two scopes, because they have different lifetimes:

```javascript
editor.acceptWord('indemnitor', 'document')    // this document only
editor.acceptWord('lessor', 'dictionary')      // everywhere, for this user
```

- **`documentWords`** — a contract's defined terms and party names. Persist with
  the document; it is part of the document's meaning, the same way a footnote is.
- **`userDictionary`** — a firm's terms of art. Persist with the user, not the
  document.

Collapsing those into one list is what makes a spell checker unusable in these
domains: either every later document inherits one contract's party names, or the
user re-accepts the same terminology forever.

The editor persists neither — it does not know where either store lives. It tells
you what to write, and you decide where:

```javascript
editor.handleWordAccepted = (word, scope) => {
  if (scope === 'dictionary') saveToUserDictionary(word)
  else saveWithDocument(word)
}
```

Load them back by assigning the sets before checking.

Accepting jargon does not launder a real typo: with `indemnitor` and `lessor`
accepted, `borwn` stays flagged and the field stays invalid.

No dictionary ships with this component. Which words are real is a localization
question with a different answer per document, and a hunspell dictionary is
roughly forty times the size of the whole editor.

### Wiring a real checker

The checker is `(distinctWords) => the subset that is wrong`, sync or async, so
any off-the-shelf engine fits behind it. With a hunspell-style library:

```javascript
import nspell from 'nspell'

const spell = nspell(await loadAffix(), await loadDictionary())
editor.spellChecker = (words) => new Set(words.filter((w) => !spell.correct(w)))
```

Or against a service, which is the case the batching exists for:

```javascript
editor.spellChecker = async (words) => {
  const res = await fetch('/api/spell', {
    method: 'POST',
    body: JSON.stringify(words),
  })
  return new Set(await res.json())
}
```

The editor asks about **distinct** words, once per check — so a 10,000-word
document with a 2,000-word vocabulary is one call carrying 2,000 entries, not
10,000 lookups and not one request per word.

### What it does, and does not, do

Tokenization uses `Intl.Segmenter` word segmentation, so `don't` is one word and
`l'objet` is two — neither of which splitting on whitespace gives you. `code`,
`kbd`, `samp`, `pre` and any `spellcheck="false"` subtree are skipped.

Marks are **view state**: cleared on every check and stripped from `value`, so
they never reach the form value, an undo snapshot, or whatever you persist. A
document should not carry a record of which words some dictionary once disliked.

Not implemented, and worth knowing before you build UI on this:

- **no suggestions** — the checker reports *wrong*, not *did you mean*, and there
  is no native right-click menu to inherit either
- **no incremental check** — `checkSpelling()` re-walks the whole document, which
  is right for a button and wrong for check-as-you-type on a long document
- **persistence is yours** — the editor reports accepted words through
  `handleWordAccepted` but stores nothing; reload the sets yourself

## Tracked changes and LLM proofreading

Insertions and deletions are **content** — `<tosi-ins>` and `<tosi-del>` elements
carrying author and timestamp — not an operation log. A tracked document is still
a document: it serializes, round-trips, and can be read by something that has
never heard of this component.

```javascript
editor.changeAuthor = { id: 'alex', name: 'Alex' }

await editor.reviseWith(async (text) => {
  const res = await fetch('/api/proofread', { method: 'POST', body: text })
  return (await res.json()).text
}, { id: 'gpt-x', name: 'Proofreader' })

editor.changes                    // [{ id, kind, author, authorName, time, text, element }]
editor.acceptChanges(id)          // take this one
editor.rejectChanges(id)          // keep the original
editor.acceptChanges()            // all of them
```

Both readings stay in the document until someone decides. A reviewer can put the
caret inside a proposed insertion and adjust it before accepting — the text
inside a change mark is ordinary editable content.

### What crosses the boundary

**Out goes plain text**, one text node at a time. Formatting is deliberately not
sent: a model asked to preserve markup will sometimes not, and a reviewer should
be reviewing prose rather than diffing HTML. Marks *inside* a block — a link, a
bold run — survive because each text node is revised in place. What the model
never sees, it cannot damage.

**Back comes text, and only text.** The response is inserted as text nodes inside
change marks and is never parsed as HTML, so a model that returns `<script>`
produces those literal characters, visible for review. That is a stronger
guarantee than sanitizing the response would be — there is no parse step to
attack — which is why this path does not go through `editor.sanitize`.

Text already under review is skipped, so a second pass cannot mark up the marks.

### Why word-level

The diff is word-level because the unit has to be something a reviewer can
meaningfully accept or reject. A character diff turns `teh → the` into three
separate changes, and a rewritten sentence into confetti.

### Styling is correctness here

`<tosi-ins>` and `<tosi-del>` are styled in the **core** stylesheet even though
the behaviour is a plugin. An unloaded footnote plugin is benign — you see a
stray marker. A `<tosi-del>` without its strikethrough renders deleted text as
ordinary prose, which reads as the opposite of what the document means.

### Tracking live edits

```javascript
editor.changeAuthor = { id: 'alex', name: 'Alex' }
editor.trackChanges = true
```

Typing then lands inside a `<tosi-ins>`, and **every** deletion wraps in
`<tosi-del>` instead of removing — caret Backspace and Delete, a selection
delete, a cut, inside a list, inside a table cell. Nothing leaves the document
without a mark and an entry in `changes`, which is the only property that makes
`rejectChanges()` mean anything.

The whole mechanism is **one predicate**, re-evaluated only when the insertion
point might have moved: *is the caret already inside an insertion that is mine,
from this session?* If yes, typing appends to it. If no, a new one opens. There
is no per-operation bookkeeping, because a continuous run of typing keeps the
predicate true and it stops being true exactly when it should — a click
elsewhere, an arrow key, a new line, a different author, a later session.

**Session, not just author.** Reopening a document and typing at the edge of your
own earlier tracked insertion opens a *new* change. That edit happened at a
different time and a reviewer may want to treat it separately; without this they
would silently merge into one change bearing the older timestamp.

**Cut and paste are tracked too.** A cut wraps in `<tosi-del>` like any other
deletion. A paste is **one** change rather than one per word — you did not build
it a keystroke at a time, and a reviewer wants to accept or reject the paste, not
its individual words — so it gets its own mark even mid-typing-run. Pasted
content is still sanitized before it is marked.

Two deletions behave specially, because the pedantic version would be noise:

- text inside **your own current insertion** is really removed — you are
  un-typing something you just typed, not proposing to delete your own proposal
- text already inside a `<tosi-del>` is left alone — it is deleted already

### Not implemented

- **no structural tracking.** A change mark wraps *content*, and structure is
  not content. So while `trackChanges` is on, edits that restructure rather
  than delete text are **refused** rather than performed:
  - Backspace at the start of a paragraph, Delete at the end of one, and
    Backspace out of a list item (each deletes a paragraph break)
  - **Delete Row** and **Delete Column** on a table — a grid table has no row
    elements, so row and column are derived from `cellIndex`, and a
    `<tosi-del>` around a cell would itself become a grid item and shift every
    later cell

  Refusing is deliberate: the alternative is silently restructuring the
  document with nothing in `changes` to show for it, which is the failure this
  feature exists to prevent. Text deletion inside a block or a cell is
  unaffected and fully tracked.

  A refusal fires a cancelable **`structural-edit-refused`** event carrying
  `detail.reason`, so the key is not simply dead — show a note, or call
  `preventDefault()` on it to allow the edit:

  ```javascript
  editor.addEventListener('structural-edit-refused', (e) => {
    toast(`Not tracked yet: ${e.detail.reason}. Turn off tracking to do this.`)
  })
  ```

  `detail.reason` is one of `merge-blocks-backward`, `merge-blocks-forward`,
  `remove-list-item`, `merge-list-items`, `delete-table-row`,
  `delete-table-col`. **Calling `preventDefault()` performs the edit
  untracked** — if tracking could have represented it, there would have been
  nothing to refuse. A custom command refuses the same way, through
  `ctx.refuseStructural(reason)`; see EXTENSIBILITY.md.
- **no merge story.** Changes-as-content gets attribution, review and round-trip,
  but not collaborative merge. That needs an operation log, which is a larger
  decision — see
  [EXTENSIBILITY.md](https://github.com/tonioloewald/tosijs-editor/blob/master/EXTENSIBILITY.md)
  (a repo document; it is not in the npm tarball).
### Resolved changes leave nothing behind

Accepting or rejecting a change **evaporates the mark entirely** — no wrapper, no
`data-change`, no attribution residue, and the text is re-normalized rather than
left fragmented. A document does not accumulate its own history.

That is deliberate. Undo, and whatever version store the document lives in,
already record past states; a document that carries every resolved edit becomes
unreadable, larger than its content, and awkward to share with anyone who was not
part of the review.

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
| **Click-drag**   | Selects words, sticky at boundaries |

**Click-drag is sticky at word boundaries.** Snapping engages only once the drag
leaves the word it began in — in practice, as soon as you cross a space. Inside
that first word you keep character precision, so pulling `fix` out of `prefix`
still works; cross into another word and both ends snap, including the anchor,
because a selection that spans words but starts mid-word is almost never what was
meant. Punctuation comes along only when the pointer reaches it, and a selection
never ends in a trailing space you did not ask for. Sticky within a block only —
a double-click drag is already word-granular, and a cross-block selection has
larger units than words. `stickySelectionBounds(text, anchor, head)` is exported
if you want the rule without the editor.

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

### Drag and drop

Selected text becomes a real draggable object — the selection is marked on
elements, which is exactly what HTML5 drag and drop wants, so dragging works
between windows, between browsers, and to and from the desktop with no extra
machinery.

Every drag offers **both representations**, and the receiver picks:

| type         | what it gets      |
| ------------ | ----------------- |
| `text/html`  | the styled markup |
| `text/plain` | clean text        |

- **Move within the editor, Alt to copy.**
- **Leaving the editor is always a copy.** The source is only deleted by this
  editor's own drop handler, so text dragged into another app is never removed
  from a document you can no longer see.
- **The drop indicator IS the caret.** Since the editor owns its caret, the
  thing showing where text will land is the thing that receives it.
- Dropped **image files** are read in as data URIs; dropped HTML goes through
  the same `pastemode` normalisation as a paste, so dropping and pasting the
  same content produce the same document.

The editor declares `data-drop="text/html;text/plain;Files;image/*"` and each
selected element `data-drag="text/html;text/plain"`, matching the conventions
`tosijs-ui`'s drag library uses to mark compatible drop zones.

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

### Change tracking

| Member                          | Type                               | Description                                                              |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `trackChanges`                  | `boolean`                          | Record live edits as tracked changes                                     |
| `changeAuthor`                  | `{ id, name? }`                    | Who the next change is attributed to                                     |
| `sessionId`                     | `string` (readonly)                | Distinguishes this editing session from an earlier one by the same author |
| `changes`                       | `TrackedChange[]`                  | Every change in the document, in document order                          |
| `acceptChanges(id?)`            | `void`                             | Accept one change, or all of them with no argument                       |
| `rejectChanges(id?)`            | `void`                             | Reject one change, or all of them with no argument                       |
| `reviseWith(revise, author?)`   | `Promise<number>`                  | Round-trip the prose through a proofreader; returns changes introduced   |

### Spell checking

| Member                            | Type                                 | Description                                              |
| --------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| `spellChecker`                    | `(words) => Set \| Promise<Set>`     | Supply a checker; without one, nothing is checked        |
| `checkSpelling()`                 | `Promise<SpellingError[]>`           | Check now and mark what comes back wrong                 |
| `spellingErrors`                  | `SpellingError[]`                    | The current errors — the query browsers refuse to answer |
| `acceptWord(word, scope?)`        | `void`                               | `'document'` (default) or `'dictionary'`                 |
| `documentWords` / `userDictionary` | `Set<string>`                       | The two accepted-word scopes, for persisting             |
| `handleWordAccepted`              | `(word, scope) => void`              | Called when a word is accepted, so the host can persist  |
| `clearSpelling()`                 | `void`                               | Drop every mark without changing the text                |

### Other

| Member           | Description                                                      |
| ---------------- | ---------------------------------------------------------------- |
| `doCommand(str)` | Execute a command string                                         |
| `focus()`        | Focus the caret                                                  |
| `sanitize`       | `(root: Element) => void` applied to pasted and dropped content   |

Also exported from the package: `stickySelectionBounds`, `sanitizeInPlace` and
`isSafeNavigationUrl` (re-exported from
[tosijs-kilpi](https://www.npmjs.com/package/tosijs-kilpi)), `changeId`,
`diffWords`, `acceptChange`/`rejectChange`, `checkSpelling`, `wordsIn`,
`renumberFootnotes`, and the element classes behind the four content tags.

## License

Apache-2.0

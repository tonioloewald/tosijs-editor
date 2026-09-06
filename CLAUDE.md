# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A rich text editor web component that completely replaces browser `contentEditable`,
`execCommand`, `getSelection`, and Range APIs with pure DOM manipulation. Built on the
tosijs/tosijs-ui ecosystem.

**Naming is inconsistent across the repo — don't "fix" one without checking the others:**

| Thing | Value |
|---|---|
| repo directory | `tosijs-editor` |
| npm package | `tosijs-styled-editor` |
| custom element tag | `<tosi-styled-editor>` (set in `TosiEditable.elementCreator`) |
| class / creator | `TosiEditable` / `tosiEditable()` |
| main source file | `src/tosi-editable.ts` |

README.md and the doc comment at the top of `src/tosi-editable.ts` still say
`<tosi-editable>`, which is **not** the registered tag. The demo (`demo/index.html`) uses
the real one.

## Commands

```bash
bun install                     # first — node_modules may not exist
bun start                       # build + watch + dev server on http://localhost:8789
bun test                        # all unit tests
bun test src/dom-utils.test.ts  # single test file
bun test -t "wraps each char"   # single test by name
bun run build                   # build only, then exit
bun run format                  # eslint --fix + prettier (see caveat below)
```

`bun run format` is declared in package.json but **eslint and prettier are not in
devDependencies and there is no eslint config in the repo** — expect it to fail or
auto-fetch. Don't assume it ran.

## Build System

`dev.ts` is the entire build + dev server (no bundler config files). One script does:

1. **prebuild** — regenerates `src/version.ts` from `package.json`'s version, then wipes `dist/`.
   **Never hand-edit `src/version.ts`; bump `package.json` instead.**
2. **build** — `tsc --emitDeclarationOnly` into `dist/`, then flattens `dist/src/index.d.ts`
   to `dist/index.d.ts`; two Bun builds: `dist/module.js` (ESM, `tosijs`/`tosijs-ui`
   external) and `dist/index.js` (IIFE, everything bundled); prints gzipped sizes;
   copies `demo/` into `docs/`.
3. **serve** — static server over `docs/` with `/dist/*` passthrough, unless `--build`.

`chokidar` watches `src/` (full rebuild) and `demo/` (demo rebuild). Both `dist/` and
`docs/` are gitignored.

## Architecture

Four layers, each depending only on the ones above it.

### `src/dom-utils.ts` — leaf-node traversal
Pure, dependency-free functions: `firstLeafNode`, `lastLeafNode`, `nextLeafNode`,
`previousLeafNode`, `leafNodes`, `siblingOrder`, `isBefore`, `topSingleParentAncestor`,
`closestSingleParentAncestor`, `allowSelection`.

**Leaf nodes** (nodes with no children) are the fundamental unit — nearly every editor
operation is expressed as navigation between leaf nodes, not as offsets into text.

**Single-parent chains** (an element whose only child is another element, recursively)
matter for two things: deleting a character deletes the whole empty chain around it, and
`setText` reuses an existing `.setText` span found in the chain instead of nesting a new one.

### `src/selection.ts` — the selection replacement
`spanify(element, make, byWord?)` temporarily wraps every character in
`<span class="spanified">` (or `.spanified-word` wrapping chars) so that character
positions can be hit-tested with `getBoundingClientRect` — this is how the editor
resolves a click to a character with no browser Range API. `spanify(el, false)` unwraps
and normalizes.

`Selectable` owns the mouse/touch listeners on the doc element and maintains selection as
DOM state:

| Class | Meaning |
|---|---|
| `.sel-start` | `<input>` marking selection start |
| `.sel-end .caret` | `<input>` marking selection end / the caret. It's an `<input>` so mobile keyboards appear |
| `.selected` | every selected leaf-level element |
| `.selected-block` | every block intersecting the selection |
| `.first-block` / `.last-block` | ends of a multi-block selection |
| `.spanified` / `.spanified-word` | transient char/word wrappers |
| `.do-not-spanify` | subtree spanify skips |
| `.not-selectable` | subtree selection skips (UI chrome, annotations) |
| `.not-editable` | keydown handling bails out inside this |

`markBounds()` (bounds → `.selected`), `resetBounds()` (`.selected` → bounds), and
`removeBounds()` convert between the two representations. Commands that restructure the
DOM must move between them explicitly — the bounds markers are real elements and will
break single-parent chains if left in place during a mutation.

### `src/commands.ts` — command definitions and dispatch
Every editing operation goes through a command string. `executeCommand(ctx, str)` splits
on `;`, then splits each command on whitespace into name + args, and calls
`commands[name](ctx, ...args)`. Values containing spaces use `+`
(`setText font-family Times+New+Roman`).

Commands never touch the component; they receive an `EditableContext` (`root`,
`selectable`, `find`/`findAll`, `selectedLeafNodes`, `selectedBlocks`, `insertionPoint`,
`block`, `normalize`, `focus`, `updateUndo`) built by `TosiEditable.getContext()`. This is
what makes commands unit-testable without a live component.

**The command choreography** (deviating from it corrupts selection state) — see `setText`:

```
ctx.selectable.resetBounds()      // .selected -> markers
spanify(ctx.root, false)          // work on real text nodes
ctx.selectable.markBounds()       // markers -> .selected
ctx.normalize()
const nodes = ctx.selectedLeafNodes()
ctx.selectable.removeBounds()     // markers out of the way before mutating
...mutate...
ctx.selectable.resetBounds()      // rebuild markers from .selected
ctx.focus()
ctx.updateUndo('new')
```

**Extension point:** `executeCommand` resolves names against `ctx.commands` and falls
back to the module-level `commands` when a context omits it. `TosiEditable.getContext()`
passes its per-instance `this.commands`, so assigning `editor.commands.myCommand = fn`
(or overriding a built-in) takes effect on the next `doCommand()`.

### `src/tosi-editable.ts` — the web component (~2300 lines)
`TosiEditable extends Component` (tosijs), `formAssociated`, shadow parts
`menubar` / `toolbar` / `doc`. Everything event-driven lives here: keydown/keypress,
copy/cut/paste, table-cell navigation, list-item Enter/Backspace/Delete, vertical arrow
movement (via spanified line grouping in `groupByLine`/`closestCharOnLine`), touch
selection affordances and context menu, and column-resize dragging.

Content initialization order in `connectedCallback`: existing `doc.innerHTML`, else a
pre-set `value`, else non-slotted light-DOM children.

`docHTML` (private getter/setter) is the single choke point for reading/writing document
HTML — it detaches and re-attaches the touch-affordance elements so UI chrome never leaks
into `value`, undo snapshots, or the form value.

**Undo is full-HTML snapshots**, not operations: `updateUndo(command?, reason?)` where
command is `'init' | 'new' | 'undo' | 'redo' | undefined` (undefined coalesces into the
current snapshot). `reason` deduplicates consecutive same-reason edits so typing a word
is one undo step. It also drives the toolbar's disabled states and
`internals.setFormValue`.

**Keyboard shortcuts are data, not code**: `handleShortcut` builds a `ctrl+<key>` string
and looks up `[data-shortcut="..."]` in the toolbar, then runs that element's `value`
attribute as a command. Adding a shortcut means adding a toolbar button, not a keymap entry.

### `src/table-utils.ts` — grid tables
Tables are `<ul class="editor-table">` with `grid-template-columns`; cells are `<li>`,
header cells are `.table-header`. There are no row elements — row/column position is
derived arithmetically from `cellIndex` and `getColumnCount`, so any change to column
count must go through `setColumnWidths` to stay consistent.

### `src/toolbar.ts` — widget factories
`defaultToolbar()` / `minimalToolbar()` / `defaultMenubar(editor)` build plain elements
using tosijs-ui `icons` and menus. Buttons carry the command in `value` and optionally
`data-shortcut`. Toolbar widgets are appended by the host with `slot="toolbar"`; menus go
to `slot="menubar"`.

## Testing

`bun:test` with happy-dom. `bunfig.toml` sets test root to `./src` and preloads
`test-setup.ts`, which constructs a happy-dom `Window` and copies an **explicit
allowlist** of globals (`windowProps`) onto `globalThis`. If a test fails with
`X is not defined`, add `X` to that list rather than working around it.

happy-dom has no layout, so anything geometry-based (click-to-character hit testing,
vertical arrow movement, affordance positioning) cannot be unit tested — those paths are
verified in the browser via `bun start`.

## Notes

`TODO.md` and `Working Notes.md` track outstanding behavior bugs and are worth reading
before touching selection or keyboard handling. The original jQuery implementation that
this replaced was deleted from the repo; recover it from git history if a reference is
ever needed (`git show 298bf16 -- edx-editable.js`).

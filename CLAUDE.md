# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A rich text editor web component that completely replaces browser `contentEditable`,
`execCommand`, `getSelection`, and Range APIs with pure DOM manipulation. Built on the
tosijs/tosijs-ui ecosystem.

**One name, everywhere: `tosijs-styled-editor`.** The repo directory is the only
exception, and it is deliberate:

| Thing            | Value                                                |
| ---------------- | ---------------------------------------------------- |
| repo directory   | `tosijs-editor`                                      |
| npm package      | `tosijs-styled-editor`                               |
| custom element   | `<tosijs-styled-editor>` (`static preferredTagName`) |
| class / creator  | `TosijsStyledEditor` / `tosijsStyledEditor()`        |
| main source file | `src/tosijs-styled-editor.ts`                        |

Note the element does NOT use the ecosystem's `tosi-` prefix (`tosi-menu`,
`tosi-doc-system`) — those are tosijs-ui's; this package is named for itself.

## Commands

```bash
bun install                     # first — node_modules may not exist
bun start                       # build + watch + dev server on http://localhost:8789
bun test                        # all unit tests
bun test src/dom-utils.test.ts  # single test file
bun test -t "wraps each char"   # single test by name
bun run make                    # full build (site + dist), then exit
bun run tls                     # once — locally-trusted dev certs (needs mkcert)
bun run format                  # eslint --fix + prettier (see caveat below)
```

**There is deliberately no `build` script.** `bun build` is a Bun builtin, so a
script by that name makes `bun build` and `bun run build` different commands.

`bun run format` is declared in package.json but **eslint and prettier are not in
devDependencies and there is no eslint config in the repo** — expect it to fail or
auto-fetch. Don't assume it ran.

## Build System

`bin/site.ts` is the ONLY build/dev entry — a thin wrapper over tosijs-ui's doc
system (`buildSite` / `devServer`), configured in `tosijs-editor-site.config.ts`.
There is no bundler config and no `dev.ts`.

- `prebuild` stamps `src/version.ts` from `package.json`. **Never hand-edit it.**
- `libraryBuild` emits the package: types, `dist/module.js` (ESM, peers external),
  `dist/index.js` (IIFE). Bundling shells out to the `bun build` CLI — calling
  `Bun.build()` from the long-lived dev server leaks tens of MB per rebuild
  (oven-sh/bun#34053).
- `docs/` is the generated Pages web root and IS committed. `docs/*.map` is not:
  multi-MB per build, and it embeds dependency source that has tripped GitHub
  push protection.

### Doc-system traps (each of these cost a debugging session)

- **`bundleEntry` REPLACES tosijs-ui's `iife.js`, it does not extend it.** If
  `demo/index.ts` omits the doc system, `<tosi-doc-system>`/`<tosi-example>`
  never register: no header, no menu, no live examples — and no error, because
  the prerendered markup still renders. (tosijs-ui#145)
- **Import the element creators BY NAME and reference them.** A bare
  `import 'tosijs-ui/live-example'` is tree-shaken out, with the same silent
  failure. `demo/index.ts` assigns them to `globalThis` to hold them in.
- **`js`, `ts`, `html`, `css` and `test` fences all EXECUTE** in doc comments and
  markdown. An illustrative CSS block becomes a global `<style>`; a lone `html`
  block becomes a stray live example. Use a display-only language (`typescript`,
  `xml`) for anything meant only to be read. (tosijs-ui#146)
- **Adjacent fences form ONE `<tosi-example>`; prose between them starts a new
  one.** Keep a `test` block next to the `html` it drives, or it builds its own
  editor and renders an empty box.
- **No `*/` inside a doc comment's examples** — it closes the `/*# … */` early,
  and the error names the example, not the delimiter.
- **`baseUrl` already carries the project-page path, so `basePath` stays `/`.**
  Setting both doubles it in canonical/og/sitemap. (tosijs-ui#144)
- **Restart the dev server after editing the site config** — the running process
  holds the imported config, and a delegated build reuses the stale one.

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

**Click-to-character hit testing uses Range measurement, not DOM mutation**
(`characterAtPoint` in `dom-utils.ts`). A Range whose boundaries are set ON A TEXT NODE
takes *character* offsets, so `setStart(t, i); setEnd(t, i + 1); getBoundingClientRect()`
returns one glyph's box without touching the DOM. This is NOT true of a Range set on an
element: there the offsets are *child indices*, so the finest rect available is a whole
child node — which is why measuring via `selectNode`/`selectNodeContents` appears
impossible and led to the original spanify approach.

Two caveats. Text-node offsets are UTF-16 code units, so stepping by 1 lands inside a
surrogate pair (step graphemes with `Intl.Segmenter`). And characters inside a cursive
ligature cluster (Arabic lam-alef) have overlapping rects, so a point inside one is
genuinely ambiguous — measured ~99% agreement overall, with every disagreement being an
adjacent character in an Arabic cluster. `getClientRects()` (plural) returns one rect per
line box, split at bidi run boundaries.

**Do not reintroduce spanification for measurement.** Wrapping characters in spans
changes the thing being measured: each span is an inline box, so shaping breaks across
the boundaries, Arabic cursive joins come apart, and lines re-wrap. Hovering a paragraph
visibly relaid it out. Spans are still created for *word/line grouping* by double-click
and vertical arrows, but never on hover and never to resolve a click.

`spanify(element, make, byWord?)` wraps each character in `<span class="spanified">` (or
`.spanified-word`); `spanify(el, false)` unwraps and normalizes. Whitespace is left as
bare text nodes — putting it inside spans changes *which* spaces collapse.

`Selectable` owns the mouse/touch listeners on the doc element and maintains selection as
DOM state:

| Class                            | Meaning                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `.sel-start`                     | `<span>` marking selection start                                                          |
| `.sel-end .caret`                | `<span>` marking selection end / the caret                                                |
| `.selected`                      | every selected leaf-level element                                                         |
| `.selected-block`                | every block intersecting the selection                                                    |
| `.first-block` / `.last-block`   | ends of a multi-block selection                                                           |
| `.spanified` / `.spanified-word` | transient char/word wrappers                                                              |
| `.do-not-spanify`                | subtree spanify skips                                                                     |
| `.not-selectable`                | subtree selection skips (UI chrome, annotations)                                          |
| `.not-editable`                  | keydown handling bails out inside this                                                    |

The bounds markers are `<span>`, deliberately. They were `<input>` (to raise mobile
keyboards) but a replaced element between two characters ALWAYS breaks the shaping run —
measured on Arabic, a neighbouring glyph's advance shifts even when the box is
width-neutral. Paint-only styling (box-shadow/outline) measures clean; anything that
generates a box, including a pseudo-element, does not. Mobile keyboard focus is handled by
a separate off-document `focusTarget`.

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
`block`, `normalize`, `focus`, `updateUndo`) built by `TosijsStyledEditor.getContext()`. This is
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
back to the module-level `commands` when a context omits it. `TosijsStyledEditor.getContext()`
passes its per-instance `this.commands`, so assigning `editor.commands.myCommand = fn`
(or overriding a built-in) takes effect on the next `doCommand()`.

### `src/tosijs-styled-editor.ts` — the web component (~2400 lines)

`TosijsStyledEditor extends Component` (tosijs), `formAssociated`, shadow parts
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

happy-dom has no layout: every rect is zero. Geometry-based paths (click-to-character
hit testing, vertical arrow movement, affordance positioning) therefore need a stub, and
the stub goes on the surface the code actually measures through — `getBoundingClientRect`
on the **Range prototype** (reachable as `Object.getPrototypeOf(document.createRange())`),
not on elements. See `describe('click position resolution')` in `selection.test.ts`, which
gives every character a synthetic 10px box. That only proves the resolution logic; whether
the measurement matches real shaping is a browser question — verify via `bun start`, and
drive it with `hj eval` against the RTL page for a repeatable per-character sweep.

## Notes

`TODO.md` and `Working Notes.md` track outstanding behavior bugs and are worth reading
before touching selection or keyboard handling. The original jQuery implementation that
this replaced was deleted from the repo; recover it from git history if a reference is
ever needed (`git show 298bf16 -- edx-editable.js`).

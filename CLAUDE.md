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

`bun run format` is `prettier --write .` and prettier IS a devDependency, so it runs.
There is no eslint config; `bun run lint` is `bun run typecheck`, i.e. `tsc --noEmit
--noUnusedLocals --noUnusedParameters`. **Run `bun run typecheck`** — there was no
script by that name until 0.5.0, release-doctor reported it as a skip, and it
immediately caught a filter written against a field name that does not exist.

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

Four of these were filed upstream and fixed — see `UPSTREAM.md` for the issue URLs and
status. **The fix only helps if you are on a version that has it**: tosijs-ui sat pinned
at 1.13.0 for three releases while #145's detector shipped in 1.14.1, so this repo taught
the trap as undetectable while the net existed. Now on 1.15.0, and
`bundleRegistrations()` runs on every build.

- **`bundleEntry` REPLACES tosijs-ui's `iife.js`, it does not extend it.** If
  `demo/index.ts` omits the doc system, `<tosi-doc-system>`/`<tosi-example>`
  never register: no header, no menu, no live examples — and no error, because
  the prerendered markup still renders. (tosijs-ui#145)
- **Import the element creators BY NAME and reference them.** A bare
  `import 'tosijs-ui/live-example'` is tree-shaken out, with the same silent
  failure. `demo/index.ts` assigns them to `globalThis` to hold them in.
- **`js`, `ts`, `html`, `css` and `test` fences all EXECUTE** in doc comments and
  markdown. An illustrative CSS block becomes a global `<style>`; a lone `html`
  block becomes a stray live example. Use a display-only language (`javascript`,
  `typescript`, `xml`) for anything meant only to be read. (tosijs-ui#146)
  Walked into again in 0.4.5: an illustrative `` js block in README.md showing how
to swap in a different sanitizer was EXECUTED on the home page, throwing
`ReferenceError: editor is not defined`. The home page is built from README.md
(`docPaths`), so README fences are live examples too — that is easy to forget
while editing a README as prose.  ``javascript renders and does not run.
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

Pure functions with one runtime dependency: `firstLeafNode`, `lastLeafNode`,
`nextLeafNode`, `previousLeafNode`, `leafNodes`, `siblingOrder`, `isBefore`,
`topSingleParentAncestor`, `closestSingleParentAncestor`, `allowSelection`, plus the
geometry primitives `characterAtPoint` and `caretGeometryAt`.

The sanitizer used to live here and now does not: `sanitizeInPlace` and
`isSafeNavigationUrl` are **re-exported from `tosijs-kilpi`**, a sibling package of
ours (18x smaller than DOMPurify, parity on its 223-payload fixture set). Bug reports
about sanitization belong in that repo, not this one.

**Leaf nodes** (nodes with no children) are the fundamental unit — nearly every editor
operation is expressed as navigation between leaf nodes, not as offsets into text.

**Single-parent chains** (an element whose only child is another element, recursively)
matter for two things: deleting a character deletes the whole empty chain around it, and
`setText` reuses an existing `.setText` span found in the chain instead of nesting a new one.

### `src/selection.ts` — the selection replacement

**Click-to-character hit testing uses Range measurement, not DOM mutation**
(`characterAtPoint` in `dom-utils.ts`). A Range whose boundaries are set ON A TEXT NODE
takes _character_ offsets, so `setStart(t, i); setEnd(t, i + 1); getBoundingClientRect()`
returns one glyph's box without touching the DOM. This is NOT true of a Range set on an
element: there the offsets are _child indices_, so the finest rect available is a whole
child node — which is why measuring via `selectNode`/`selectNodeContents` appears
impossible and led to the original spanify approach.

Two caveats. Text-node offsets are UTF-16 code units, so stepping by 1 lands inside a
surrogate pair (step graphemes with `Intl.Segmenter`). And characters inside a cursive
ligature cluster (Arabic lam-alef) have overlapping rects, so a point inside one is
genuinely ambiguous — measured ~99% agreement overall, with every disagreement being an
adjacent character in an Arabic cluster. `getClientRects()` (plural) returns one rect per
line box, split at bidi run boundaries.

`characterAtPoint` has two details that are easy to undo by accident:

- **Ties break on distance to the glyph's CENTRE.** Cursive rects overlap, so a point in
  Arabic often sits inside several at once and they tie on edge distance. Breaking the tie
  by document order (a plain `<`) makes the answer non-monotonic in x: dragging a selection
  stalled for 216px of pointer travel and then jumped 32 characters.
- **A per-node pre-pass picks the nearest line band first.** Measuring every character is
  one rect per character on every mousemove — 2.1ms for 1k characters, so ~21ms and visible
  jank at 10k. One rect per text node narrows it to a line band first (0.84ms for the same
  document, and now scaling with the band rather than the document).

**Do not reintroduce spanification for measurement.** Wrapping characters in spans
changes the thing being measured: each span is an inline box, so shaping breaks across
the boundaries, Arabic cursive joins come apart, and lines re-wrap. Hovering a paragraph
visibly relaid it out. Spans are still created for _word/line grouping_ by double-click
and vertical arrows, but never on hover and never to resolve a click.

`spanify(element, make, byWord?)` wraps each character in `<span class="spanified">` (or
`.spanified-word`); `spanify(el, false)` unwraps and normalizes. Whitespace is left as
bare text nodes — putting it inside spans changes _which_ spaces collapse.

`Selectable` owns the mouse/touch listeners on the doc element and maintains selection as
DOM state:

| Class                            | Meaning                                          |
| -------------------------------- | ------------------------------------------------ |
| `.sel-start`                     | `<span>` marking selection start                 |
| `.sel-end .caret`                | `<span>` marking selection end / the caret       |
| `.selected`                      | every selected leaf-level element                |
| `.selected-block`                | every block intersecting the selection           |
| `.first-block` / `.last-block`   | ends of a multi-block selection                  |
| `.spanified` / `.spanified-word` | transient char/word wrappers                     |
| `.do-not-spanify`                | subtree spanify skips                            |
| `.not-selectable`                | subtree selection skips (UI chrome, annotations) |
| `.not-editable`                  | keydown handling bails out inside this           |

The bounds markers are `<span>` styled `display: contents`, and both halves matter.

They were `<input>` (to raise mobile keyboards), but a replaced element between two
characters ALWAYS breaks the shaping run. The keyboard is now raised by the caret
OVERLAY instead — `elements.input({ part: 'caret' })` in the shadow root, assigned to
`selectable.focusTarget`. It is outside the text flow, so it can be a real form control
without disturbing the line. That also means its computed `font-size` matters: iOS
Safari zooms the page on focus below 16px (see the caret CSS).

`display: contents` is what keeps them from generating a BOX. They were previously
`display: inline; font-size: 0`, which is narrow but still an inline box — and an empty
inline box contributes a strut to its line. Measured in WebKit, selecting inside an Arabic
paragraph grew the block 33.59px -> 38.47px, lifted it 7.31px and shifted every following
block by 2.44px. With `display: contents` all three deltas are 0.

Because they generate no box, **their own `getBoundingClientRect()` is meaningless** —
never measure a marker directly. `TosijsStyledEditor.markerRect()` derives a marker's
screen position from `caretGeometryAt()`, and everything that needs marker geometry (the
caret overlay, vertical arrow movement, the touch affordances) goes through it.

WHAT THIS STILL DOES NOT FIX: WebKit does not shape across TEXT NODE boundaries. Merely
splitting a text node — inserting no element at all — reshapes Arabic at roughly half the
positions tested, by up to 4px. Since the markers live in the text, inserting them splits
it. No styling avoids this; `display: contents` and a bare `splitText()` measure
identically. Removing it means representing the bounds as offsets rather than as elements,
i.e. a change to the selection model. Chromium measures 0 throughout.

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

### `src/tosijs-styled-editor.ts` — the web component (~3700 lines)

`TosijsStyledEditor extends Component` (tosijs), `formAssociated`, shadow parts
`menubar` / `toolbar` / `doc`. Everything event-driven lives here: keydown/keypress,
copy/cut/paste, table-cell navigation, list-item Enter/Backspace/Delete, vertical arrow
movement (via spanified line grouping in `groupByLine`/`closestCharOnLine`), touch
selection affordances and context menu, and column-resize dragging.

Content initialization order in `connectedCallback`: existing `doc.innerHTML`, else a
pre-set `value`, else non-slotted light-DOM children.

`docHTML` (private getter/setter) is the single choke point for reading/writing document
HTML. It detaches and re-attaches the touch-affordance elements, and it unwraps and
restores the `<tosi-misspelling>` marks, so neither leaks into `value`, undo snapshots,
or the form value.

**The mark restore runs LAST-TO-FIRST, and that is load-bearing.** A mark's saved
anchor is very often the next mark — marks become direct siblings as soon as anything
calls `normalize()`, which collapses the empty text nodes `Range.insertNode` leaves
between them. Restoring forwards reaches an anchor that is still detached,
`insertBefore` throws `NotFoundError` mid-loop, and every remaining mark stays unwrapped
permanently. Because `updateUndo()` reads this getter first thing on keypress, that one
throw also silently lost the undo snapshot and the form value.

**Selection markers still DO leak into `value`.** `docHTML` serves both `value` and the
undo stack, and undo wants the caret back — so splitting them is an open item
(`TODO.md`), not an oversight.

**Undo is full-HTML snapshots**, not operations: `updateUndo(command?, reason?)` where
command is `'init' | 'new' | 'undo' | 'redo' | undefined` (undefined coalesces into the
current snapshot). `reason` deduplicates consecutive same-reason edits so typing a word
is one undo step. It also drives the toolbar's disabled states and
`internals.setFormValue`.

**Keyboard shortcuts are data, not code**: `handleShortcut` builds a `ctrl+<key>` string
and looks up `[data-shortcut="..."]` in the toolbar, then runs that element's `value`
attribute as a command. Adding a shortcut means adding a toolbar button, not a keymap entry.

### `src/changes.ts`, `src/spelling.ts`, `src/footnote.ts` — the plugin layer

Added in 0.5.0. All three follow one rule: **a feature is a custom element, and its
state is written in the document, not held by an instance.** An unregistered element
still round-trips through `innerHTML`, so a document edited by a build that lacks the
plugin does not lose the marks — which is what makes these safe to put in content.

| Tag                  | Module        | Kind                                         |
| -------------------- | ------------- | -------------------------------------------- |
| `<tosi-ins>`         | `changes.ts`  | container — text inside stays editable       |
| `<tosi-del>`         | `changes.ts`  | container                                    |
| `<tosi-misspelling>` | `spelling.ts` | container, VIEW state, stripped by `docHTML` |
| `<tosi-footnote>`    | `footnote.ts` | renumbers from its own lifecycle             |

Three things that are easy to undo by accident:

- **Change-mark CSS lives in CORE, not the plugin.** An unloaded footnote plugin is
  benign; an unstyled `<tosi-del>` renders deleted text as ordinary prose, i.e. the
  opposite of what the document means. Its styling is correctness, not appearance.
- **Every destructive path goes through `removeNode()` or `deleteEdgeCharacter()`.**
  `trackDeletion` once had a single call site and six other paths deleted raw, so
  content left the document with no `<tosi-del>` and no entry in `changes`. Never write
  a bare `removeChild` in a deletion path; a tracking gate that fails open is worse
  than no gate. Deletions that would MERGE blocks are refused while tracking, because a
  change mark wraps content and a paragraph break is not content.
- **A whole-block deletion marks the block's CONTENTS, never the block.**
  `<tosi-del><p>…</p></tosi-del>` lands at document top level and then `block()` answers
  `tosi-del` for everything inside it, mis-targeting `setBlockType`, `selectedBlocks`
  and Enter handling.

**Anything that reads the document as LANGUAGE must call `Selectable.withoutBounds()`.**
The bounds markers are real elements, so they split the text node they sit in: with the
caret after `br` in `the brown fox`, a plain `createTreeWalker` walk yields `the br` and
`own fox`. A spell checker asked about that flags a correctly-spelled word and blocks a
form submit; a proofreader gets two fragments, one ending mid-word. There is no blur
handler anywhere, so one click leaves a marker in the text indefinitely. `withoutBounds`
is synchronous on purpose — let no live node reference cross an `await`, or a document
that changed during a network call gets marked up from a walk of the old one.

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

**There are three test lanes, and passing in one is not passing in another.**
`bun test` (happy-dom) is the bulk; the doc system executes ```test fences in doc
comments and markdown as in-page browser tests, which is the project's only
layout-capable check; and some things are verifiable in neither and must be driven by
hand via `bun start`. Do not write "verified in a real browser" in a comment without
pointing at the fence that does it — a comment that claims coverage which does not
exist is worse than no coverage, because it stops the next reader looking.

happy-dom implements neither `attachInternals()` nor the `Touch` constructor. For
`internals`, assign a recording stub — it is a public optional field on the tosijs
`Component` — rather than leaving the form-association behaviour unasserted; see
`withInternals` in the spelling tests.

**A passing test is not evidence until you have made it fail.** Break the thing under
test and confirm that specific test goes red. In the 0.5.0 review remediation, four
tests written against confirmed, reproduced bugs passed against the UNFIXED code and
had to be rewritten — they asserted a condition the bug did not actually violate.

happy-dom has no layout: every rect is zero. Geometry-based paths (click-to-character
hit testing, vertical arrow movement, affordance positioning) therefore need a stub, and
the stub goes on the surface the code actually measures through — `getBoundingClientRect`
on the **Range prototype** (reachable as `Object.getPrototypeOf(document.createRange())`),
not on elements. See `describe('click position resolution')` in `selection.test.ts`, which
gives every character a synthetic 10px box. That only proves the resolution logic; whether
the measurement matches real shaping is a browser question — verify via `bun start`, and
drive it with `hj eval` against the RTL page for a repeatable per-character sweep.

## Notes

**Tasks live on the virta board**, not in `TODO.md` — run `virta brief` (a SessionStart
hook does it for you) or see <https://virta.tosijs.net/host/#?virta.scope=tosijs-editor>.
File with `virta create`; `ready` is the owner's go-ahead, so agents file into the backlog
and leave it there. `TODO.md` and `UPSTREAM.md` are pointers now. `Working Notes.md` still
tracks outstanding behavior bugs and is worth reading before touching selection or keyboard
handling. The original jQuery implementation that
this replaced was deleted from the repo; recover it from git history if a reference is
ever needed (`git show 298bf16 -- edx-editable.js`).

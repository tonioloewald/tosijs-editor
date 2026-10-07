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

**The mouse and touch paths must share their gesture code, not mirror it.** Word stickiness
was written inline in `handleMouseDown`/`handleMouseMove` and touch was written separately, so
`dragAnchor` had one assignment and `extendSticky` one caller — snapping worked with a mouse and
not with a finger, which is backwards, since the fingertip is the imprecise pointer. It read as
finished because the touch handler carried the comment "Same measurement as a mouse drag": true
of `characterAtPoint`, false of the sticky rule. `setDragAnchor()` and `extendTo()` are now the
single copies; add to those rather than to a handler. Same family as the deletion paths below —
a rule applied at one site while another keeps the old behaviour.

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
  than no gate. A deletion that would MERGE blocks is not refused — it is recorded
  structurally; see below.
- **A whole-block deletion marks the block's CONTENTS, never the block.**
  `<tosi-del><p>…</p></tosi-del>` lands at document top level and then `block()` answers
  `tosi-del` for everything inside it, mis-targeting `setBlockType`, `selectedBlocks`
  and Enter handling.
- **A STRUCTURAL edit is blocks out, blocks in** — `trackStructuralEdit`. A change mark
  wraps content and a paragraph break is not content, so a merge strikes both originals
  (`data-block-delete`) and proposes a third (`data-block-insert`), sharing one
  `data-change` because one keystroke is one change (the rule paste already follows).
  **A merge is an ordinary edit — do not privilege it.** Three drafts added a veto on
  pending changes, an atomic group spanning other people's marks, and absorption of the
  author's own edits into the merge's id. That is a transaction system; change tracking
  shows the old text and the new text and lets the reviewer decide. Contradictory
  resolutions are therefore reachable and are honoured; a review UI can resolve a merge
  together with the edits inside it if it wants to prevent that.
  Two things that ARE the primitive's job: **ask `canMergeBlocks` before mutating** (a
  refusal resolved midway leaves the gesture half-applied — that shape had to be fixed
  three times before it stuck), and **strike an earlier proposal like any other block**.
  Dropping it is the tempting reading — an intermediate proposal was never in the
  document under review, so rejecting should not resurrect it — and it was what an
  earlier draft did. It was only safe while ABSORPTION re-stamped the earlier gesture
  into the later one. Removing absorption kept the drop, which orphaned the earlier
  change: an id with a delete half and no insert half, a state no gesture produces, and
  a two-merge chain resolved per id then LOST text from a document with nothing pending
  (review `0.6.0-structural-tracking-r2.md`, B‑1; fixed in `f5a4313`). Removing a
  mechanism means re-deriving what depended on it.

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
`bun test` (happy-dom) is the bulk; `bun run test:browser` drives real engines —
`browser-tests/` plus the doc system's ```test fences, which execute the examples in
doc comments and markdown; and some things are verifiable in neither and must be
driven by hand via `bun start`.

**The fences are gated now, and that was the point.** They were in NO gate —
release-doctor discovers `test`/`test:*` scripts and a fence ran only when a human
opened the page — while *documentation asserting the opposite of the code held the
0.6.0 tag three times*: CLAUDE.md's superseded-proposal rule, CHANGELOG's copy of the
same sentence, README's sticky-drag claim. Three instances fixed, and the mechanism
that would make the fourth FAIL rather than ship was already here, shipped and
documented as load-bearing, with nothing running it.
`browser-tests/doc-fences.test.ts` runs it. Four things about fences that are
discoverable only by reading tosijs-ui's source (filed there as a docs issue):

- **examples are inserted client-side** — `grep tosi-example docs/*.html` finds
  nothing, so checking them needs a browser, not a parse of the built output
- **tests are enabled by default on localhost and disabled elsewhere**
  (tosijs-ui#113: "off" and "none exist" rendered identically, which bit hardest down
  the tunnel, whose hostname is necessarily not localhost); `enableTests()` forces it
- **the result is a CLASS on `<tosi-example>`**: `-has-tests` plus `-test-running`,
  settling to `-test-passed` or `-test-failed`
- **a build or execution failure counts as a failure** even with no `test` block,
  which is what catches an illustrative fence that throws — this repo has shipped
  that twice

So a claim in a doc comment or README can be made executable, and an executable claim
now blocks the tag. Prefer that to asserting behaviour in prose. Do not write "verified in a real browser" in a comment without
pointing at the fence that does it — a comment that claims coverage which does not
exist is worse than no coverage, because it stops the next reader looking.

happy-dom implements neither `attachInternals()` nor the `Touch` constructor. For
`internals`, assign a recording stub — it is a public optional field on the tosijs
`Component` — rather than leaving the form-association behaviour unasserted; see
`withInternals` in the spelling tests.

## Fixing a blocker: find the other copies, and ask whether the guard is needed

**Every blocker and major in 0.6.0 was one shape: one rule, several copies, and nothing that
makes a divergence fail.** Word stickiness in three copies (mouse, touch, affordance handle).
The mergeability gate pasted into `backspace()` twice and `forwardDelete()` not at all.
`refuseStructural`'s return value read at one of three sites. Both resolution sweeps deriving a
block by `parentElement`. `renumberFootnotes` and `resolvedClone` each handling identity as if
the other did not exist. The superseded-proposal rule stated one way in CHANGELOG and the
opposite way in CLAUDE.md and the code. The suite was green for all of them.

So two questions, after any blocker, before calling it fixed:

1. **What is the OTHER copy of this?** Grep for the rule, not for the symptom, and verify
   PLACEMENT — print which function each call site is in. `grep -c` returning 2 was read as
   "one per path" when it was two in one path and none in the other.
2. **If the fix adds a guard, would a different call shape make the guard unnecessary?**
   `deletionTarget` is the worked example: four callers pass the container the deletion may not
   leave (`li`, `cell`) and cannot get it wrong, while the two block paths pass
   `this.parts.doc` and have to REMEMBER that crossing a boundary deletes a break rather than a
   character. They forgot, and an untracked Backspace ate a character of the neighbouring
   block. The `crossesBlocks` guard that fixes it reproduces at the call site what the other
   four get free from an argument (board #3091).

And the counter-rule, because over-reach is its own failure: **fix the cause you have evidence
for, not a grander one you have inferred.** The 0.6.0 footnote corruption was caused by
`renumberFootnotes` keying its map so a second reference minted a duplicate item — proven,
since every test for it passes with only that fixed. Stripping `id` from the proposal "for the
general case" on top of that implemented neither coherent model of identity ownership and
permanently destroyed every descendant `id` on accept. A second fix for a cause nobody
demonstrated is a new defect with a rationale.

**The lens whose job this is does not run by default.** `dryness` is in the `dx` tier, not in
`always-on` or `pre-minor`, so a release can pass the gate twice with twins intact — which is
what happened here.

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

## Stopping the dev server

`bun run dev:stop` (`bin/dev-stop.ts`). **Never `pkill -f "bin/site.ts"`** — that is the
dev-server entry point in tosijs, tosijs-3d and tosijs-virta as well, so it kills theirs.
It killed tosijs-3d's twice in one session, the second time one command after the agent
doing it had written a practices note against it. The note did not survive habit, which is
why there is now a command. It identifies the server by PORT and refuses if the listener's
cwd is not this repo — a port held by someone else is a collision, and killing it is the
wrong repair.

## The browser lane (`browser-tests/`)

`bun run test:browser`. Playwright drives the page; haltija's
`testInBrowser` (`haltija@beta`) supplies the probe/assertion split — the body and its
`expect` stay on the host, only the probe crosses. Not in `bun test`: `bunfig.toml` roots
that at `./src`.

**It brings up its own dev server** (`bin/test-browser.ts`): it reuses one already serving this
repo and leaves it running, starts one if there is none and stops only that, and refuses a port
held by another directory — or held by this one without answering. It used to assume `bun start`
was open, which made the result depend on what the operator had running: release-doctor runs
every `test*` script, so the same commit reported red or green depending on that.

**And it REBUILDS `docs/` first, because readiness is not freshness.** `docs/` is the generated
web root and it is COMMITTED, so the dev server answers from the last release's build the moment
it binds — the readiness probe proves the server responds, not that what it serves is this
working tree. Measured 2026-10-07: every touch affordance was redesigned in `src/`, the whole
lane went GREEN, and the bundle under test still contained `touch-context-menu`, an element the
source no longer creates. Eleven tests passed against the shipped 0.6.0 build.

Two things worth keeping from that. First, **it passed** — the same family as the defect this
script was written to fix, a result depending on state the lane does not control, but worse,
because loud failure is the easy case. Second, **what caught it was a precondition**: one new
test asserted that the element it was about to measure exists. Every describe in this repo that
drives a browser should carry one, for the same reason `doc-fences.test.ts` does — a lane that
cannot see its subject reports zero failures.

**One-time setup, and it is NOT in the repo:** `bunx playwright install webkit`. That writes
~1 GB into `~/Library/Caches/ms-playwright` (measured 3.2 GB here across three revisions each of
chromium, headless shell, firefox and webkit) or into `$PLAYWRIGHT_BROWSERS_PATH`. That cache is
shared with every other Playwright project on the machine, survives deleting this repo, and
nothing here prunes it. `bun.lock` pins playwright at 1.63.0, so only a deliberate `bun update`
pulls a new revision set. Machine scope is the right call; the gap was that nothing said so.

CI cannot run this lane — `tls/*` is gitignored, so the dev server cannot start on a runner —
which is why `package.json` declares `releaseDoctor.attestedLanes: ["test:browser"]`. The tag
carries `release-attestation.json` recording that the lane ran locally on exactly that tree; an
unattested tag fails Tier 0 saying so.

**Producing the attestation is `bun run release:ready`, and the ORDER is load-bearing:**

```bash
# everything committed, version stamped, docs/ rebuilt — then, in THIS order:
bun run release:ready        # runs the attested lanes, writes release-attestation.json
git add release-attestation.json && git commit -m "attest: v0.6.0"   # that file ALONE
git push
gh workflow run publish.yml --ref <branch> -f tag=<branch> -f dry_run=true
#   ^ dry run AFTER attesting, and with the BRANCH as `tag`
git tag -a v0.6.0 -m "…" && git push origin v0.6.0
gh workflow run publish.yml --ref <branch> -f tag=v0.6.0
```

**The dry run comes AFTER the attestation, not before it** — which inverts the order
`publish.yml`'s own header suggests, and the inversion is caused by declaring
`attestedLanes`. The workflow's "Attested lanes need an attestation" step fails any run
without `release-attestation.json`, dry or not, so a dry run attempted first dies there
(measured, 0.6.0). Attesting first is safe: the attestation records the tree, and a dry run
adds no commits, so the attestation still verifies when the tag lands on it.

**`tag` takes the BRANCH name for a dry run.** `dry_run` checks out `inputs.tag` as a ref
directly, so passing the future tag fails with "A branch or tag with the name 'v0.6.0' could
not be found". The tag/version match is explicitly skipped on a dry run and the version comes
from `package.json`, so the branch is the right ref to hand it.

`verifyAttestation` requires HEAD to change **only** `release-attestation.json` and HEAD's
parent to be the tree the lanes ran on, so any other change in that commit invalidates it —
and so does amending anything afterwards. Getting it wrong is not a re-run: the tag has to be
deleted and recreated. `publish.yml` with `dry_run` on the branch catches it before any tag
exists, which is why its own header tells you to run that first.

The script needs a pulled sibling checkout of `tosijs-coding-practices`
(`../tosijs-coding-practices`), since that is where `tools/attest.ts` lives. Local Tier 0
reports this lane as PASS with no attestation, because release-doctor only fails an attested
lane it CANNOT run — so a green local Tier 0 does not mean the tag will pass.

**WebKit is the point.** `ENGINE=chromium` is a control, not coverage: Chromium measures
~0 for everything this lane exists to catch. haltija's own `--headless` is Chromium-only,
so the bridge is backed by Playwright directly — `BrowserBridge` is structural (four
methods), which is what makes that a two-minute job.

**Measured 2026-09-26** — what the change and spelling marks cost real Arabic layout,
which nothing in the happy-dom suite can see (every rect there is zero):

| mark position | WebKit | Chromium |
| --- | --- | --- |
| wrapping a whole word | **0.00px**, 0 of 98 glyphs | 0.02px |
| 1–2 chars INSIDE a word (`مكتوب`) | **1.00px**, 3 of 98 glyphs | 0.02px |
| block height / top, all cases | 0.00px | 0.00px |

So marks at word boundaries — a spelling mark, a selection delete — are free, and a
single-character `<tosi-del>` from one Backspace costs 1px on three glyphs of the word it
sits in. Smaller than the up-to-4px this file records for merely splitting a text node,
because a mark usually lands where the cursive run already breaks. No re-wrap, no block
growth, so nothing downstream shifts.

**The first version of this lane reported a 1058px shift and it was an artifact**: the
probe measured collapsed source whitespace, whose rect goes to 0×0 when anything in the
DOM changes. Both engines agreed on the wrong number, which is what made it convincing.
Measure rendered glyphs only (`width > 0`), and treat agreement between engines as a
reason to look harder, not as corroboration.

## Notes

**Tasks live on the virta board**, not in `TODO.md` — run `virta brief` (a SessionStart
hook does it for you) or see <https://virta.tosijs.net/host/#?virta.scope=tosijs-editor>.
File with `virta create`; `ready` is the owner's go-ahead, so agents file into the backlog
and leave it there. `TODO.md` and `UPSTREAM.md` are pointers now. `Working Notes.md` still
tracks outstanding behavior bugs and is worth reading before touching selection or keyboard
handling. The original jQuery implementation that
this replaced was deleted from the repo; recover it from git history if a reference is
ever needed (`git show 298bf16 -- edx-editable.js`).

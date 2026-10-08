# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **iOS-style touch affordances** (board #3104). iOS shipped much of what this
  editor was building independently, so the direction is to match its observable
  behaviour and improve on it rather than go our own way.
  **Round drag handles.** A 14px painted dot (`AFFORDANCE_DOT`) above the start
  of the selection and below its end, each centred in an invisible 44px hit box
  (`AFFORDANCE_HIT`). The handles used to be 44px squares with an asymmetric
  rounded-corner icon, i.e. visually as large as their own hit area, so they
  covered the text they were bracketing. The dot's POSITION says which bound it
  is — above the line or below it — which is what the chevron glyphs were for.
  **An action lozenge** replaces the round context-menu button and the
  horizontal strip it opened. Translucent, blurred, centred on the PAGE, placed
  above the selection when there is room and below it otherwise, never over it.
  Cut / Copy / Paste inline; a chevron expands the SAME element into a vertical
  menu with Delete, Bold, Italic and Plain. It fades out and collapses while a
  handle is being dragged.
  One element in two states, and one action list: `-extra` plus `display: none`
  is the only difference between condensed and expanded, so they cannot hold
  different actions. The design it replaces built a separate menu element — two
  things to place, two dismissal paths and two lists.
- `lozengePlacement(selection, size, bounds, gap?)`, exported, with the
  placement rule as a pure function.
- `browser-tests/affordances.test.ts`: the affordance geometry measured in real
  WebKit layout. The lozenge never intersects the selection's LINE BOXES (not
  its union rect — a wrapped selection has a gap between lines that the union
  would call "inside"), it flips above/below at the document's edges, it is
  centred on the page wherever the selection sits, and the painted dot really is
  14px rather than 44. No unit test in this repo can check any of that: every
  rect in happy-dom is zero.

### Changed

- **`trackStructuralEdits` is still off, and the reason has changed.** The
  resolution defect it was created for (#3107, above) is fixed; what gates it
  now is **#3090, identity ownership**. A block-scoped proposal is a copy that
  coexists with the originals it supersedes, so while a merge is pending every
  `id` in the merged block answers twice — bounded, cleared by resolution, and
  nobody has decided who owns identity while pending or who inherits it on
  resolution. Either coherent model changes resolution, which is the code that
  produced blockers in three consecutive review rounds, so it wants its own
  cycle with tests written first. The feature is correct about STRUCTURE and
  undecided about IDENTITY; a document with no `id` attributes is now believed
  sound.
- **`AFFORDANCE_SIZE` is removed, replaced by `AFFORDANCE_HIT` (44) and
  `AFFORDANCE_DOT` (14).** It meant the hit target and the painted size at once,
  which is not expressible as one number once the two differ.
- **`menuAffordanceX` is removed**, with its six tests. It existed to keep a
  SELECTION-centred menu off the start handle, because the two shared a row and
  a selection narrower than one handle put them on top of each other. Centring
  on the page makes that unreachable, so the guard is deleted rather than
  carried with a condition nobody could explain later.
- The lozenge is a sibling of `[part="doc"]`, not a child of it — the same
  reason the caret overlay and selection edges are. A child of the doc element
  is a document BLOCK and turns up in `selectedBlocks()`, `block()` and arrow
  navigation; and the lozenge's seven labels joined the document's own
  `textContent`, which is what a consumer reading `doc.textContent` would have
  seen too. (`value` was unaffected: `docHTML` detaches the affordances.)
- The top/bottom padding that keeps the handles reachable near a document edge
  is now `AFFORDANCE_DOT + 4` rather than a hand-written 48/52 pair sized for
  the old square handle — one quantity, derived, not written twice.
- A handle drag takes its offset from the bound's own measured geometry
  (`markerRect`) instead of reconstructing it from the handle's box plus half a
  line height. That reconstruction was only correct while the handle was a
  square whose anchor CORNER touched the character.
- `bun run test:browser` **rebuilds `docs/` before running.** `docs/` is the
  generated web root and it is committed, so the dev server answers from the
  previous release's build the moment it binds — readiness proved the server
  responded, not that it was serving this working tree. Measured here: every
  affordance was redesigned, the whole lane went GREEN, and the bundle under
  test still contained `touch-context-menu`, an element the source no longer
  creates. It surfaced only because one new test asserted that the thing it was
  about to measure exists.

### Fixed

- **The action lozenge no longer paints itself over an untouched editor.**
  From the moment the element upgraded until the first click or tap, every
  editor showed the Cut / Copy / Paste bar floating over its own content —
  both `document.createElement` and declarative markup, confirmed in WebKit.
  `.touch-affordances` declares `display: none`; the lozenge did not need its
  own copy of that while it was a CHILD of that element, and moving it out to
  the shadow root (above) took the hiding away with the parent. Nothing caught
  it because nothing ever looks at an untouched editor: the documentation site
  clicks its own editor on load, and every unit test drives a selection before
  asserting anything.
- **A deletion no longer consumes the editor's own chrome.** *Also released in
  0.6.1 — see that entry for both symptoms; it is listed here for anyone
  coming from 0.6.0.* Live in shipped 0.6.0, with no configuration and
  tracking OFF: one forward Delete at the end
  of the last block moved the touch affordance handles into the paragraph and
  into `editor.value` — the form value, the undo snapshot and whatever the host
  persists. `docHTML` detaches the affordance CONTAINER, so handles moved out of
  it were no longer covered. The cause is one rule with a missing copy:
  `Selectable`'s mouse and touch handlers both refuse `.not-selectable`, and
  `siblingBlock` exists precisely because a naive sibling walk finds UI
  furniture — `deletableFilter` was the fourth site and the one nobody had
  applied it to. A `.not-selectable` widget in the host's own content (the
  shipped `annotate` command builds those) is now stepped over rather than
  consumed.
- **Accepting a tracked structural merge now matches the untracked result**
  (board #3107), for a block with **nothing to strike** — empty,
  inline-wrapper-only, or already fully struck by another author.
  `trackDeletion` declined to mark such a block, and `BLOCK_DELETE_ATTR` on the
  mark is the only record that the BLOCK rather than merely its contents is
  proposed for removal; with no mark the block survived `acceptChanges()`.
  `<p>First</p><p></p><p>Third</p>` + Delete in the empty block accepted to
  `<p></p><p>First</p><p>Third</p>`. An empty `<tosi-del data-block-delete>` is
  the correct mark, not a degenerate one: accept removes the block, reject
  unwraps the mark and leaves the empty block exactly as it was.
  The proposal is also anchored at `blocksOut[0]` rather than after the last
  outgoing block, so the result lands where the block at the START of the
  selection was — the owner's rule for every block gesture, and the same end
  `blockLike()` already took the type from.
  `isFullyStruck` is deleted with the skip it served. Its own history was the
  argument: it had to be corrected once already, because
  `<p>keep <tosi-del>cut</tosi-del></p>` answered "already deleted" and
  accepting the merge then left that text in the document twice. Nesting a mark
  inside a mark is fine — `acceptChange` removes a `<tosi-del>` whole, so
  accepting "remove this block" takes another author's pending deletion of its
  contents with it, and rejecting unwraps ours and hands theirs back.
- **A live handle drag no longer has `Selectable`'s own touchmove running
  underneath it** (board #3083). The handles carry only POINTER listeners and
  live inside the doc element, so their touch events bubble to the doc, and
  `beginBoundDrag` sets `selecting = 1` deliberately — `extendSticky` requires
  it. Normally invisible, because the handle tracks the finger and
  `elementFromPoint` keeps resolving to its own `.not-selectable` box; it bites
  when the drag handler bails WITHOUT repositioning the handle (the offset
  cursor over `.not-selectable` content, or above the first line), after which
  the finger walks out of the stale 44px box and the doc path extends the
  selection to the UN-OFFSET coordinate.
- **A cancelled handle drag now runs the same teardown as a finished one.**
  Nothing listened for `pointercancel`, so a gesture the platform took away — an
  incoming call, a system edge swipe, a second finger ruled a pinch — left its
  `touchDrags` entry behind; because the teardown is guarded on `size === 0`,
  `endBoundDrag`, `despanify` and `selectionChanged` then stopped running for
  every later drag. `pointercancel` and `lostpointercapture` reach the one
  teardown.
- **One pointer move re-marks the selection once, not three times.** `extendTo`
  ends in `markRange` via `extendSelection`, so the `markBounds()` after it
  repeated the identical O(document) sweep; `extendTo` also fired
  `onBoundsChanged` a second time itself, repainting the caret and repositioning
  the affordances again — on the one device where the handles ARE the gesture.
## [0.6.1] - 2026-10-07

### Fixed

- **No gesture can reach the editor's own chrome any more.** Two symptoms, one
  cause, both reachable in 0.6.0 with no configuration and with change tracking
  OFF.

  **The caret could end up inside the editor's UI.** Right-arrow at the end of
  the last block moved it into the touch-affordance container, where
  `insertionPoint()` still answers non-null — so the next character typed was
  built into the chrome rather than into the document. If your caret ever
  vanished at the end of a document and typing stopped appearing, this is why.

  **A forward Delete at the end of the last block** moved the touch affordance
  handles into the paragraph and into `editor.value`:

  ```
  el.value = '<p>hello</p>'   // caret at the end, press Delete
  el.value → <p>hello<div class="touch-affordance touch-handle-start …"></div>…</p>
  ```

  That value is the form value (`internals.setFormValue`), the undo snapshot and
  whatever the host persists, so a document saved after that keypress carried
  the editor's own UI inside it. `docHTML` detaches the affordance CONTAINER,
  which is why `value` is normally clean — handles moved OUT of the container
  are no longer covered by that.

  The cause of both: `deletableFilter` did not refuse `.not-selectable`.
  `Selectable`'s mouse and touch handlers both do, and `siblingBlock` exists
  precisely because a naive sibling walk finds UI furniture — this was the
  fourth site for one rule and the one nobody had applied it to. The affordance
  container is a SIBLING of every block, so the leaf walk left the paragraph and
  reached it; the arrow keys then moved the caret there, and the deletion paths
  found `block()` answering the container, `crossesBlocks` true, and merged the
  document with its own UI.

  Fixed in the shared filter rather than at the call sites, which is what covers
  both gestures and the four other walks that use it.

  A `.not-selectable` widget in the host's own content — the shipped `annotate`
  command builds those — is now stepped over by a deletion rather than consumed.

  **Patch rather than part of 0.7.0 on purpose:** `^0.6.0` resolves to
  `>=0.6.0 <0.7.0`, so a patch reaches every current consumer and a minor
  reaches none.

  *This entry was amended after 0.6.1 was tagged.* The published tarball's copy
  describes only the Delete symptom: the arrow-key one was found by auditing for
  other instances of the rule after the release was already staged, and the fix
  covers it because it is in the shared filter. No code differs.

## [0.6.0] - 2026-10-07

### Added

- **Structural change tracking, BEHIND AN OFF-BY-DEFAULT FLAG**
  (`editor.trackStructuralEdits`). Not reachable in 0.6.0, and not a supported
  configuration for a document you care about — see the first note under
  **Changed** for why. The rest of this entry describes what it does when
  enabled, which is what 0.7.0 will ship.
  Merging paragraphs is recorded the brute-force way — _these blocks out, these
  blocks in_. A change mark wraps
  content and a paragraph break is not content, so merging two paragraphs
  strikes both originals (`data-block-delete`) and proposes a third
  (`data-block-insert`); all three share one `data-change`, because one
  keystroke is one change — the same rule paste already follows. Covers
  Backspace at the start of a block, Delete at the end of one, and a selection
  spanning blocks, where the proposed block reads as the deletion _would_ read
  once accepted.
  The cost is honest duplication: the text is present twice until someone
  resolves it — and across a chain of merges, once per step, since each
  superseded proposal is struck rather than removed. `value` carries all of it
  until the chain is resolved.
  **A merge is an ordinary edit.** It gets no veto and no special group: a
  pending change in either paragraph, yours or anyone else's, neither blocks it
  nor is absorbed into it. Every mark keeps its own id and stays independently
  resolvable — privileging a structural edit over a textual one is not what
  change tracking is for. The corollary is that contradictory choices are
  possible and the editor honours them: reject an insertion, then accept a merge
  whose proposal was taken from that paragraph, and those words are in the
  result. Both are on screen when you choose; a review UI that wants to prevent
  it should resolve a merge together with the edits inside it.
  A chain of merges **strikes** each superseded proposal like any other block,
  so an intermediate proposal stays in the document as
  `<tosi-del data-change=… data-block-delete>` wrapping the earlier
  `<tosi-ins data-block-insert>` — a shape a review UI has to render, and one
  that stays resurrectable by rejecting the later merge. Dropping it instead
  was tried and reversed: it was only safe while an earlier design absorbed the
  earlier gesture into the later one, and without that it left a change id with
  a delete half and no insert half, a state no gesture produces, from which
  resolving per id lost text outright.
  Lists and grid tables are the one refusal (`merge-blocks-not-mergeable`), and
  it is about valid DOM rather than review policy: merging them produces loose
  text as a direct child of a `<ul>`, or a mark that becomes a grid item and
  shifts every `cellIndex`. That guard applies with tracking **off** as well.
  `merge-blocks-backward`, `merge-blocks-forward` and `merge-blocks-selection`
  no longer fire — those edits are recorded now.

### Changed

- **A cross-block merge is still refused while `trackChanges` is on, and the
  refusal is no longer overridable.** The structural representation above is
  complete and tested, but RESOLUTION has a confirmed defect: accepting a merge
  whose outgoing block has nothing to strike — empty, holding only an empty
  inline wrapper, or already fully struck — leaves that block standing and
  anchors the replacement after it:

  ```
  <p>First</p><p></p><p>Third</p>  + Delete in the empty block
    tracking off          → <p>First</p><p>Third</p>
    tracking on, accepted → <p></p><p>First</p><p>Third</p>
  ```

  A flag about review deciding document structure is the one class this release
  spent five correctness rounds eliminating, so the feature is gated off rather
  than shipped reachable. `rejectChanges()` was correct throughout; accept was
  the broken half. 0.7.0 finishes it.

  0.5.x allowed `preventDefault()` on these refusals to perform the edit
  untracked. That is gone, for the same reason it is gone for
  `merge-blocks-not-mergeable`: an override that half-applies a gesture is the
  shape three earlier remediation rounds kept producing.

- **A mouse drag no longer snaps to word boundaries; a touch drag does.**
  `stickySelection` is the knob — `'touch'` (the default), `'always'`, or
  `'never'` — on both the component and `Selectable`, live and settable at any
  time. **0.5.x snapped for every pointer**, so if you relied on that, set
  `editor.stickySelection = 'always'`.
  The reasoning is per-pointer: rounding a drag a mouse user aimed out to the
  nearest words overrides a precise gesture, and double-click already means
  "select this word". A fingertip has no precision to override. A hybrid device
  (a Surface Pro) answers differently for its two pointers on the same document,
  because the decision is per gesture. A stylus counts as a mouse: pen input
  arrives as pointer plus compatibility mouse events, not touch events.
- **Deleting across blocks now keeps the block at the START of the selection**,
  with its type and its attributes. A selection delete used to keep the LAST
  block while every other block merge kept the first, so dragging from a heading
  into a paragraph and deleting left a `<p>` — and once tracked merges stopped
  being refused, `trackChanges` silently decided which element type and which
  `id` survived: the same gesture gave `<p class="a">Headgraph</p>` untracked and
  `<h1 id="t">Headgraph</h1>` tracked. Same text, different wrapper, chosen by a
  flag about review. One rule now, on every path.
- **Word stickiness now applies to touch at all, including the affordance
  handles.** It had been wired to the mouse only, which is backwards — and on a
  phone the handles are how a selection is adjusted, so a touch user could not
  reach it even after the two `Selectable` paths were fixed.

### Removed

- **Nothing was removed from the `structural-edit-refused` vocabulary.**
  `merge-blocks-backward`, `merge-blocks-forward` and `merge-blocks-selection`
  still fire with the default flags, so a 0.5.x listener keyed on them keeps
  working. They stop firing only when `trackStructuralEdits` is enabled, which
  0.6.0 does not do.
- **`merge-blocks-not-mergeable` is no longer overridable.** 0.5.x documented
  `preventDefault()` on `structural-edit-refused` as "performs the edit
  untracked"; that stands for `remove-list-item`, `merge-list-items`,
  `delete-table-row` and `delete-table-col`, and **not** for
  `merge-blocks-not-mergeable`, which is about valid DOM rather than review
  policy and fires with `trackChanges` off as well, where "untracked" means
  nothing.
  Before → after for a host doing
  `if (e.detail.reason.startsWith('merge-blocks')) e.preventDefault()`: an
  ordinary paragraph merge used to fire `merge-blocks-backward` and be performed
  untracked; it now fires **no event** and is recorded as a tracked structural
  change. Only a list or grid-table merge still refuses, and `preventDefault()`
  on it has no effect — the document is left alone and the event is there to tell
  the user why.

### Fixed

- **A partially struck block was skipped, and its text then appeared twice.**
  The "already entirely deleted" guard tested element children, so
  `<p>keep <tosi-del>cut</tosi-del></p>` looked fully deleted — a text node is
  not an element child. Accepting a merge then left the surviving text in both
  the original and the replacement.
- **Rejecting a block-scoped insertion left an empty paragraph** where the
  proposal had been, and took the caret with it — the mirror of a fix already
  made on the accept side. The caret is now rescued out before the block goes.
- **With `trackChanges: false` — the default — Backspace at the start of a block
  and Delete at the end of one ATE A CHARACTER of the neighbouring block.**
  `<p>one</p><p>two</p>` + Backspace at the start of `two` produced `"ontwo"`;
  Delete at the end of `one` produced `"onewo"`. The character deletion ran and
  then the blocks merged, where a gesture crossing a block boundary should delete
  the paragraph break and nothing else. Present since at least 0.4.4 and
  unaffected by tracking being off, so **every 0.5.x build loses a character on
  every cross-paragraph Backspace.**
- **A footnote reference duplicated in the document minted a second list item**
  sharing one `data-footnote` and one `id`, carrying placeholder text, which
  survived accept, reject and an explicit renumber and reached `value`. Reachable
  in 0.5.x by pasting a reference. Footnote numbering is now per distinct note
  rather than per reference, so repeated references to one note share its number
  and its single list entry.
- **Rejecting a chain of merges left one stray empty paragraph per intermediate
  step**, in the document and in `value`.
- **Delete in an empty block kept the block and pulled the NEXT block's content
  into it**, leaving the caret at the start of what it had absorbed. An empty
  block is residue — most often what a block-series delete just left behind — so
  it now merges into the PREVIOUS block and the caret lands at its end, which is
  what Backspace already did. The gesture's whole effect is that the block the
  caret was in stops existing, so moving the caret forward made no sense. The
  one exception is having no previous block, where the ordinary forward
  behaviour stands.

## [0.5.2] - 2026-09-26

### Security

- **0.5.1's fix was incomplete: `reviseWith()` could still emit live HTML.**
  The guard that strips `<` and `>` from `changeAuthor` was applied at the four
  write sites in the component and missed the fifth, `mark()` in
  `src/changes.ts` — which is exactly what `reviseWith()` and the exported
  `applyRevision()` go through. So the LLM-proofreading path, documented public
  API, still broke a display name out of a raw-text element and put an
  `<img onerror>` into `editor.value`. Reproduced end to end through the public
  `value` setter and `reviseWith()`, with no host cooperation beyond wiring
  `changeAuthor.name` to a profile name.

  The guard now lives in `src/changes.ts` beside the only code that writes those
  attributes, and every writer shares it. **A guard belongs at the layer every
  writer shares, not at the addresses where the bug was first noticed** — which
  is precisely the mistake 0.5.1 made.

  **Upgrade from 0.5.1 as well as from 0.5.0** if you use `trackChanges` or
  `reviseWith`. `SECURITY.md`'s statement in 0.5.1 was true of typing and
  deletion and false of revision.

## [0.5.1] - 2026-09-26

### Security

- **An author's display name could break out of a raw-text element and become
  live HTML.** HTML attribute serialization escapes `&` and `"` but **never
  `<`**, and `style`, `xmp`, `title`, `textarea`, `noembed`, `noframes` and
  `plaintext` re-parse their contents as raw text — so a `changeAuthor.name`
  containing `</style><img src=x onerror=…>`, written into a change mark inside
  one of those elements, terminated the element and the remainder parsed as
  markup. `editor.value` then carried a real `<img onerror>`.

  Nothing external triggers the re-parse: `value` is also the undo stack, so a
  single undo does it in the same session, and `internals.setFormValue` hands it
  to every other reader. Reachable without host cooperation — `tosijs-kilpi`
  drops `style`/`script`/`iframe` but keeps `xmp`/`textarea`/`title`/`noembed`/
  `noframes`/`plaintext`, so a collaborator can paste one — and the host need
  only have wired `changeAuthor.name` to a profile name, which is what that
  field is for.

  `<` and `>` are now stripped from `changeAuthor.id` and `.name` at every write
  site. Stripping rather than escaping: no escape survives attribute
  serialization into a raw-text element. Affects 0.5.0 only, and only with
  `trackChanges` enabled.

  **Still true, and not a vulnerability:** tracked edits inside a raw-text
  element are a bad idea regardless — a caret marker left in a `<style>` block
  round-trips into literal CSS text with no attacker involved. Keeping the
  editor's own marks out of those elements is tracked in `TODO.md`. See
  `SECURITY.md`.

### Changed

- The build no longer passes `--incremental` to `tsc`, so no
  `dist/tsconfig.tsbuildinfo` is produced. An incremental build into a wiped
  `dist/` can emit nothing at all the second time, which disqualifies a build
  that has to reproduce for the publish workflow.

### Added

- `.github/workflows/publish.yml` — OIDC trusted publishing with npm staged
  publishing. CI can only _stage_; the maintainer's 2FA approval on npmjs.com is
  what publishes, and it works from a phone.

## [0.5.0] - 2026-09-21

### Added

- **Drag selection is sticky at word boundaries.** The rule is one sentence:
  snapping engages only once the drag LEAVES the word it began in — which in
  practice means as soon as you cross a space, since offsets bracket the space
  and there is no "crossed the gap but not yet arrived" position to wait in.
  Inside that word you keep character precision, so pulling `fix` out of
  `prefix` still works; cross into another word and both ends snap — including the anchor,
  because a selection spanning words that starts mid-word is almost never what
  was meant. Coming back inside the anchor word returns to precision.
  Punctuation comes along only when the pointer reaches it: the segmenter
  treats `,` as its own segment, so dragging past the comma in `hello,` takes
  it and stopping inside `hello` does not. Whitespace is never dragged along,
  so a selection cannot end in a trailing space you did not ask for.
  Sticky only within a block, and only for plain drags — a double-click drag is
  already word-granular, and a cross-block selection has larger units than
  words.

- **Tracked changes, and an LLM proofreading round-trip.** Insertions and
  deletions are content (`<tosi-ins>` / `<tosi-del>` with author and timestamp),
  not an operation log, so a tracked document still serializes and round-trips.
  `reviseWith(fn, author)` sends each text node out as plain text, diffs the
  response at word level, and applies the result as tracked changes;
  `acceptChanges(id)` / `rejectChanges(id)` resolve them one at a time or all at
  once.
  The response is used as TEXT and never parsed as HTML, so a model returning
  markup produces literal characters rather than elements — a stronger guarantee
  than sanitizing, since there is no parse step to attack. Text already under
  review is skipped, so a second pass cannot mark up the marks.
  Change marks are styled in the core stylesheet on purpose: a `<tosi-del>`
  without its strikethrough reads as the opposite of what the document means.
- **Live edit tracking** (`editor.trackChanges = true`). Typing lands inside a
  `<tosi-ins>`, and every deletion wraps in `<tosi-del>` — caret Backspace and
  Delete, selection deletes, cut, inside lists, inside table cells. Deletions
  that RESTRUCTURE rather than delete text are refused instead — block merges
  (a cross-paragraph selection delete, Backspace at the start of a
  paragraph, Delete at the end of one, Backspace out of a list item) and table Delete Row / Delete Column. A change mark wraps
  content and structure is not content, so the honest answer until structural
  tracking exists is to decline rather than restructure the document with
  nothing in `changes` to show for it. A refusal fires a cancelable
  `structural-edit-refused` event carrying `detail.reason`, so a host can
  explain the dead keystroke or override it. A custom command deletes through
  `ctx.removeNode(node)` and checks `ctx.tracksChanges()` before restructuring
  — see EXTENSIBILITY.md.
  One delete gesture is **one** change however many nodes and blocks it spans,
  matching paste. The mechanism is one predicate —
  is the caret already inside an insertion that is mine, this session? — so a
  continuous run of typing is one change and there is no per-operation
  bookkeeping. Session is part of the test, so reopening a document and typing
  at the edge of your own earlier insertion opens a new change rather than
  silently merging into one bearing the older timestamp. Un-typing your own
  uncommitted text really removes it; re-deleting already-deleted text is a
  no-op. Cut and paste are tracked as well — a paste is ONE change rather than
  one per word, since a reviewer accepts or rejects the paste, not its
  individual words.
  Accepting or rejecting **evaporates the mark entirely**: no wrapper, no
  `data-change`, no attribution residue, and the text is re-normalized. A
  document does not accumulate its own history — undo and the version store
  already do that, and a document carrying every resolved edit becomes
  unreadable and awkward to share.

- **Spell checking, which this editor otherwise has none of.** Browsers only
  spell-check editing hosts (`textarea`, `input`, `contenteditable`), and nothing
  here is one — so replacing `contentEditable` removed browser spell checking
  entirely rather than leaving an unqueryable version of it. A contentEditable
  editor has the opposite problem: checking it cannot query — no count, no list,
  no way to block a submit on unresolved errors. This addresses both. Supply `editor.spellChecker` (a function from
  words to the subset that is wrong) and the editor does tokenization
  (`Intl.Segmenter`, so `don't` is one word and `l'objet` is two), marking,
  and **form validity**: unresolved spelling sets `customError`, so a real form
  submit is blocked rather than relying on the author to remember to check.
  Resolution is `acceptWord(word, scope)` — `'document'` for a contract's
  defined terms, `'dictionary'` for a firm's terms of art, exposed as
  `documentWords` and `userDictionary`, with `handleWordAccepted(word, scope)`
  to persist the latter. In a jargon-heavy domain the normal answer to an
  unknown word is "that is a real word", not "I mistyped", so accepting has to
  be as cheap as correcting. No dictionary ships — which words are real is a
  localization question, and a hunspell dictionary is ~35x the size of this
  editor.
  Marks are view state: cleared on every check and stripped from `value`, so
  they never reach the form value, an undo snapshot, or whatever the host
  persists. Code, `kbd`, `samp`, `pre` and `spellcheck="false"` subtrees are
  skipped.

### Changed

- **Footnote markers are saved as `<tosi-footnote>`, not `<sup>`.** The
  superscript rule lives in the editor's shadow stylesheet, so in a downstream
  renderer a marker will lay out as a full-size baseline digit unless you style
  it. `.footnote-ref` is retained as the class, so **one rule repairs every
  document**, including ones written before this change:
  `tosi-footnote, .footnote-ref { vertical-align: super; font-size: 0.75em; }`
- **`<tosi-del>` needs a strikethrough rule outside the editor too.** A tracked
  document round-trips anywhere, which is the point — but an unstyled
  `<tosi-del>` reads as ordinary prose, i.e. the _opposite_ of what the document
  says. If you render `value` outside this component, ship
  `tosi-del { text-decoration: line-through; opacity: 0.6; }` and
  `tosi-ins { text-decoration: underline; }`. Beware a downstream sanitizer that
  _unwraps_ unknown tags: that inverts a deletion silently. `acceptChanges()` is
  how you hand a plain document to a consumer like that.
- **`ignoreWord` is gone** — it was added and deprecated within this unreleased
  span, so it never shipped and protects no callers. Use
  `acceptWord(word, 'document')`.
- **The build prints bundle sizes.** 0.5.0 measures 284.4 kB / **77.1 kB
  gzipped** for the drop-in `dist/index.js`, and 143.8 kB / **29.2 kB gzipped**
  for `dist/module.js` — three features for +3.4 kB gzipped over 0.4.5.

### Fixed

- **`editor.value` could throw and permanently destroy every spelling mark.**
  Reading `value` unwraps the marks to keep them out of the serialization, then
  restores them. Restoring ran in document order, so when one mark's anchor was
  the _next_ mark — routine, since any `normalize()` collapses the empty text
  node between them — `insertBefore` threw partway and every remaining mark
  stayed unwrapped for good. `updateUndo()` reads `value` first thing on
  keypress, so one keystroke in such a document also silently lost the undo
  snapshot and the form value.
- **Spell checking flagged correctly-spelled words, and the proofreader was sent
  half-words.** Both walked text nodes directly, and the caret is a real element
  that splits the node it sits in — so with the caret after `br` in
  `the brown fox`, the checker was asked about `"br"` and reported it wrong,
  blocking a form submit on a real word. Anything reading the document as
  language now runs with the selection markers out of the text.
- **Under `trackChanges`, most deletions were not tracked at all.** Only
  selection deletes consulted the gate; caret Backspace and Delete — the
  commonest gesture in the editor — along with list and table-cell deletions and
  fully-selected blocks removed content outright, with no `<tosi-del>`, no entry
  in `changes`, and nothing for `rejectChanges()` to restore. Every destructive
  path is now tracked.
- **A paste inside an existing insertion nested the marks**, so rejecting the
  outer change silently discarded the inner one — including rejecting _another
  author's_ change throwing away _your_ pasted text.
- **Change ids could collide** when a deletion and its replacement were produced
  in one keystroke (typing or pasting over a selection), so accepting the
  deletion also accepted the replacement.
- **Change marks arriving by paste are re-stamped.** `<tosi-ins>` is a safe
  element, so pasted markup could carry any `data-author` and `data-time` it
  liked and `editor.changes` reported it as fact — and a pasted `data-change`
  could collide with a live one. Attribution is client-asserted document
  content, not an authenticated identity; what is guaranteed is that a mark
  records who put it in _this_ document.
- **A spelling error could outlive the document it described.** Undo, redo,
  `value =` and form reset all wipe the marks, and none of them touched form
  validity — leaving the field invalid with a message naming an absent word,
  anchored to a detached node.
- **`reviseWith` no longer builds an unbounded diff table from a remote
  response** (16k tokens measured at 1.7 s and +1.2 GB on the main thread), and
  a proofreader that fails part-way no longer leaves the document half-revised
  _outside_ the undo stack.
- **`acceptChanges('')` / `rejectChanges('')` no longer resolve every change in
  the document.** An empty string arrives from a `dataset` lookup that found
  nothing; `undefined` still means all.
- `src/spelling.ts` is exported from the package — `SpellChecker`,
  `checkSpelling`, `wordsIn` and the rest were unnameable.

- **Footnotes maintain themselves.** `renumberFootnotes` was always correct —
  it removed orphans and derived numbers from document order — but only ever ran
  at insertion time, so deleting a reference left its text orphaned in the list
  and the survivors mis-numbered. `<tosi-footnote>` now calls it from
  connected/disconnectedCallback, so a deletion, drag, paste or undo maintains
  the list with no command run. Documents saved earlier, which used a plain
  `<sup class="footnote-ref">`, still renumber correctly.

## [0.4.5] - 2026-09-17

### Added

- **`SECURITY.md`**, with the one thing it needs to say: a sanitizer bypass
  belongs to [`tosijs-kilpi`](https://github.com/tonioloewald/kilpi/issues),
  because that is where the code lives. The README's security section now points
  at kilpi's policy as authoritative rather than restating it — a copy of a
  policy drifts from the policy, which is the same failure the extraction
  removed from the code.
- **`NOTICE`**, for the three Apache-2.0 works the drop-in `dist/index.js`
  bundles.

### Changed

- **Sanitization moved to [`tosijs-kilpi`](https://github.com/tonioloewald/kilpi)**,
  the same code extracted as a standalone library so it is not maintained in two
  places. No API change: `sanitizeInPlace` and `isSafeNavigationUrl` are still
  exported from this package, `editor.sanitize` still works the same way, and
  behaviour is identical.

  The reason it matters is not tidiness. When the sanitizer briefly existed
  twice, a URL-normalization fix reached one copy and not the other — recorded
  as M1 in the 0.4.4 review. Across two repositories that drift would not even
  appear in a diff. kilpi carries DOMPurify's published 223-fixture corpus as a
  hard publish gate, which this package could not run on its own.

  `tosijs-kilpi` is a real dependency (this package's first — tosijs and
  tosijs-ui remain peers), at `^1.0.0`. kilpi went 1.0.0 for that reason alone:
  `^0.1.0` resolves to `>=0.1.0 <0.2.0`, so a 0.2.0 security fix would have
  reached no installed consumer, and for a dependency that _is_ the XSS defence
  a range that blocks propagation is a defect in itself. It is external in `dist/module.js`, so a consumer who
  also depends on it directly gets one copy, and bundled into `dist/index.js`,
  which assumes no installs.

## [0.4.4] - 2026-09-16

First release since 0.4.3 to reach npm. 0.4.4 and 0.4.5 were versioned in the
repo during development and **never published**, so this is numbered 0.4.4:
semver describes what consumers observe between releases, and consumers
observed none of it.

Everything below through the 0.2.0 heading shipped across 0.4.2–0.4.4. The
earlier 0.4.x releases went out without changelog sections of their own, so
they are collected here rather than reconstructed inaccurately.

### Security

- **Pasted and dropped HTML is now sanitized** before it enters the document.
  The editor replaced `contentEditable` but not the sanitization the browser
  was doing on its behalf: clipboard and drop HTML went in through `innerHTML`
  verbatim, so `<img onerror>`, `<svg onload>`, `javascript:` URLs and
  `<script>` reached the live document — and from there `value`,
  `internals.setFormValue` and every undo snapshot, meaning a host storing
  `value` stored the payload. Handlers, executing elements and unsafe URL
  schemes are now stripped at the single shared paste/drop choke point.
  Ordinary formatting and unregistered custom elements are preserved.
  `editor.sanitize` is a swappable hook if you would rather supply your own
  (DOMPurify drops in; see the README).
  _This path was unreachable in 0.4.2–0.4.3 only because `insertionPoint()` was
  broken; fixing that is what made it live again._
- **Ctrl/Cmd-clicking a link checks the URL scheme** and always opens a new
  context. `javascript:` executes in the embedding page's origin and `noopener`
  does not prevent it; `_self`/`_top` are resolved before `noopener` is
  consulted, so a document-supplied `target` could run it same-origin.
  `setLink` validates the scheme too.
- **Commands built from runtime values no longer go through the string form.**
  `executeCommand` splits on `;`, and a data URI contains `;` by spec — so
  every dropped image produced `<img src="data:image/png">` plus a bogus second
  command, and a crafted filename could inject one. `doCommandWith(name, ...args)`
  passes arguments without parsing.

### Fixed

- **Mobile browsers no longer zoom when you select text.** Two independent
  causes: the caret is a real `<input>` (that is what raises the mobile
  keyboard) and inherited the UA default form-control font size of 11px, and
  iOS Safari zooms the page on focus below 16px; and double-tap selects a word
  here, which a touch browser reads as zoom. Fixed by sizing the caret at 16px
  and setting `touch-action: manipulation` on the document, which keeps panning
  and pinch-zoom. Deliberately NOT fixed with `user-scalable=no`, which would
  fail WCAG 1.4.4.
- **The caret no longer strands itself when the document scrolls.** The overlay
  is positioned in viewport coordinates but only repainted when the selection
  bounds changed, so scrolling left it where the text used to be. Scroll, window
  resize and a `ResizeObserver` on the document now repaint it; measured drift is
  0 at every scroll offset, and it hides correctly once its line scrolls out of
  view.
- **Commands that insert at the caret worked again.** `insertionPoint()` selected
  `input.caret`, which has matched nothing since the bound markers stopped being
  `<input>` elements — so `insertFootnote`, `insertTable`, `insertImage` and
  `setLink` all bailed out silently. Its unit test passed throughout because it
  built the `<input>` itself and asserted the selector found it; the test now
  uses the real `createBounds()`.

### Changed

- Both `setTimeout` calls replaced with the signals they were approximating: a
  `ResizeObserver` tracks the touch-affordance padding transition continuously
  instead of waiting a guessed 160ms (and no longer leaves the affordances
  invisible if the transition never runs), and the touch menu's dismiss handler
  ignores the event that opened it by identity instead of deferring its own
  subscription.
- The drop-in `dist/index.js` build is minified: 83.5kB → 70.8kB gzipped.

### Added

- **Drag and drop editing.** Selected text is a real draggable object, offering
  `text/html` and `text/plain` so the receiver picks — which means dragging works
  between windows, between browsers, and to and from the desktop. Move within
  the editor, Alt to copy, and leaving the editor is always a copy. Dropped image
  files come in as data URIs; dropped HTML runs through the same `pastemode`
  path as a paste.

- **Links**: `setLink <url> [target]` and `removeLink`. Defaults to
  `target="_blank"` with `rel="noopener"`. Clicking a link in the editor places
  the caret; Ctrl/Cmd-click follows it.
- **Images**: `insertImage <url> [alt…]`. An `<img>` is already a leaf node, so
  selection and deletion treat it as one thing with no special casing.
- **Footnotes**: `insertFootnote [text…]` and `renumberFootnotes`. Numbers are
  derived from document order rather than stored, so inserting in the middle
  renumbers the rest and reorders the list. Note that renumbering happens at
  INSERTION time only — deleting a reference with Backspace currently leaves its
  entry orphaned in the list and does not renumber the survivors. Tracked in
  `TODO.md`; `EXTENSIBILITY.md` covers why the fix is a lifecycle change rather
  than another call to `renumberFootnotes`.
- An **Insert** menu carrying all three.

- **Localization**, following tosijs-ui's conventions rather than a private
  scheme: `localized` on the element translates the built-in widgets and adds a
  flag-only language picker. Toolbar buttons carry `data-tosi-localized` (a JSON
  attribute-to-key map, re-applied on locale change), menus set `localized`, and
  menu labels are `<tosi-localized>`, so custom widgets get the same treatment.
- `localized-strings.tsv` — a sample table in English and Suomi covering all 51
  UI strings. Adding a language is adding a column. Column 0 is both the lookup
  key and the English text, so missing cells fall back to English and a
  half-translated column is safe to ship.
- README is pinned to the top of the doc-site nav.
- A Right-to-Left doc page with live examples: RTL blocks in Arabic and Hebrew,
  LTR-with-embedded-RTL, and RTL blocks with embedded LTR runs (inline code,
  URLs, version numbers) — the cases where visual and logical order disagree and
  a DOM-only selection has to earn its keep.
- Menu dropdowns are compacted (30px rows, 16px horizontal padding) and scoped
  to this editor's own menus.

- `setList ul | ol | none` — bulleted and numbered list formatting, exposed as
  toolbar buttons and Style menu entries. Adjacent selected blocks become one
  list, a converted block merges into an adjacent list of the same type (so
  `<ol>` numbering continues), and re-applying the current type toggles it off.
- Live behaviour tests that run in a real browser, covering the click
  positioning that happy-dom cannot see.
- `llms.txt`, a sitemap, and prerendered doc pages, generated by the doc system.
- `.haltija.json` pinning agent browser commands to this project's dev origin.

### Fixed

- **The caret no longer reshapes the text it sits in.** It was an `<input>`
  between characters, and a replaced element breaks the shaping run: measured on
  Arabic, a neighbouring glyph's advance moved 6.2 → 6.7 even though the caret's
  box was already width-neutral, and absolute positioning did not rescue it. The
  in-text anchors are now plain spans — bit-identical to no markup at all — and
  the focusable caret is positioned over the text instead of inside it. Placing
  the caret in an Arabic paragraph now leaves its width unchanged at 565.7px.
  A collapsed selection shows an ordinary caret; an expanded one keeps its two
  edges distinguishable.

- **Arabic text jittered when you moused over it.** Not a shaping problem, as it
  appeared: spanification preserves shaping, ligatures and per-glyph positions
  exactly (measured). The cause was wrapping each SPACE in its own span, which
  changes which spaces CSS collapses — the same number collapse, but not the
  same ones, so words merge and gaps open mid-word. Whitespace now stays a text
  node, which reproduces the original layout space for space.

- **Live examples now fill their preview instead of taking a fixed height.**
  `tosi-example` is `height: var(--tosi-example-height)` (320px) and becomes
  `100vh` when maximized, so the editor's hardcoded 340px both overflowed the
  normal case — the EXAMPLE scrolled rather than the document — and ignored the
  space when maximized. The sizing and the preview's padding reset now live in
  the site config's `headExtra`, so every doc page gets them, including the RTL
  page which had no CSS block of its own.

- **The selection was unreadable in dark mode.** `.selected` was a hardcoded
  `rgba(0,0,255,0.3)` and `.selected-block` a hardcoded `#ddf` — a pale blue
  that light text disappears into — and the caret/bounds were `background: black`,
  invisible on a dark page. All three now derive from `--editor-ink` mixed into
  `--editor-surface` (and `currentColor` for the bounds), so they tint whichever
  way the page is themed. The band is lifted toward white BEFORE the ink is
  mixed in — nearly a no-op on an already-white page, but it raises a dark one
  clear of the background, which a plain ink-into-surface mix cannot do because
  the surface dominates. Dark is deliberately given MORE measured separation
  than light, because light-on-dark halates and reads as less contrast at the
  same numbers. Measured light 0.75 against a 0.99 page (separation 0.24), dark
  0.44 against 0.11 (separation 0.33).

- **Emoji were torn in half.** `spanify` split text with `split('')`, which
  splits by UTF-16 code UNIT, so an emoji's surrogate pair became two lone
  surrogates rendering as `?`. Splitting is now by grapheme cluster via
  `Intl.Segmenter`, which also keeps flags (two regional indicators), skin-tone
  modifiers, ZWJ sequences and combining marks whole — every one of those is one
  thing a user clicks on or deletes.
- **Dark mode: the document was black text on a near-black page.** The surface
  followed the page theme but `color` was the system `CanvasText`, which does
  not. Text and surface are now a paired `--editor-text` / `--editor-surface`,
  and a consumer that themes one must theme both.
- Added **Cut** to the touch selection menu, which had Copy and Paste but no Cut.

- **The caret sat on the wrong side of the line when typing LTR into an RTL
  block** (and vice versa). The caret is an element, and bidi treats an empty
  inline as a NEUTRAL, so it resolved against the block's base direction instead
  of the run being typed. Typing across a direction boundary now wraps the run
  and the caret in a `<span dir>` isolate, extending one isolate rather than
  creating one per keystroke. Neutral characters take whichever run they land in.

- **Typing over a selection deleted it and inserted nothing.** A regression from
  the double-click fix: `resetBounds()` derives bounds from `.selected`, which
  lands the caret INSIDE the last selected character, and `deleteSelection()`
  then removed the caret along with the selection — leaving no insertion point,
  so every keystroke was silently swallowed. The caret is now moved out of the
  way before the selected chains are deleted.

- Left-to-right runs inside right-to-left paragraphs — `<code>`, `<kbd>`,
  `<samp>` — inherited the paragraph's base direction, so a URL's slashes or a
  trailing period resolved to the wrong end. They now get their own
  `direction: ltr; unicode-bidi: isolate`, which the new RTL page surfaced.

- Double-clicking left the caret blinking where the click landed instead of at
  the end of the selected word: word and block gestures expanded the marked
  range without moving the `.sel-start`/`.sel-end` elements.
- Clicking in the dead space to the right of a line did nothing, and
  double-clicking there selected a word around stale bounds. Click position now
  resolves to the nearest character on the clicked line.
- `editable.commands` was never consulted — `executeCommand` resolved names
  against the module-level registry, so the documented way to add a custom
  command had no effect. The registry now travels on `EditableContext`.
- README and the component doc comment advertised `<tosi-editable>`, which was
  never the registered tag. It is `<tosijs-styled-editor>`.

### Changed

- The Highlight button now uses Lucide's `highlighter` icon, registered through
  `defineIcons`. The previous `penTool` read as a fountain pen — a different
  tool. Stored following tosijs-ui's own convention: no `xmlns`, `width`,
  `height`, `fill`, `stroke` or `stroke-*`, since the host supplies all of that
  from `--tosi-icon-*` and a hardwired stroke would ignore the current colour.

- **Renamed to one name everywhere: `tosijs-styled-editor`.** The element is now
  `<tosijs-styled-editor>` (was `<tosi-styled-editor>`), the class is
  `TosijsStyledEditor`, the creator is `tosijsStyledEditor()`, and the source is
  `src/tosijs-styled-editor.ts`. Only the repo directory stays `tosijs-editor`.
  Breaking, and free to take now because the package is unpublished.
- Doc pages have distinct titles — "A Rich Text Editor Component" (README) and
  "Editor Component" — so the site nav no longer shows two near-identical entries.
- Site icon, header mark and social image now use `static/tosijs-editor.svg`.
- Chrome restyled around a pen-ink-blue accent (`#27488c`), shared by the
  component and the doc site. The menubar, toolbar and document now read as
  three distinct surfaces, mixed from a single `--editor-ink` custom property so
  a consumer can re-theme the whole thing by setting one value. Toolbar buttons
  are compact 26px squares, styled by the component rather than left to each
  consumer to re-invent. Those styles ship as `lightStyleSpec`, not
  `::slotted()`: slotted content is light DOM, so the host page's own `button`
  rules win the cascade — which had left the buttons as white chips on the
  tinted bars.

- **Build**: replaced the bespoke `dev.ts` with `bin/site.ts`, a thin wrapper
  over tosijs-ui's doc system (`buildSite`/`devServer`). The full build is
  `bun run make` — there is deliberately no `build` script, because `bun build`
  is a Bun builtin and the two would differ.
- Bundling moved out of the long-lived watch process into child processes;
  Bun's bundler never returns its native arena (oven-sh/bun#34053).
- `docs/` is now the generated Pages web root and is committed.
- Peer floors raised to `tosijs ^1.10.1` / `tosijs-ui ^1.13.0`.
- Migrated off `elementCreator({ tag })` and `static styleSpec`, both deprecated
  in the upgrade, to `static preferredTagName` and `static shadowStyleSpec`.

### Security

- `happy-dom` → 20.14.0 (GHSA-w4gp-fjgq-3q4g, GHSA-6q6h-j7hj-3r64) and a minimal
  `ws` override → `^8.21.0` (GHSA-96hv-2xvq-fx4p), both surfaced by the build's
  dependency audit gate.
- `tls/` is gitignored as an allowlist so a dev TLS private key cannot be staged.

### Removed

- The legacy jQuery implementation (`edx-*.js`, `lib/jquery-2.1.4.js`, and the
  orphaned HTML pages) — 336K that nothing in the build referenced. Recover from
  git history if ever needed: `git show 298bf16 -- edx-editable.js`.

## [0.2.0]

### Added

- Touch selection affordances and context menu; component renamed to
  `<tosijs-styled-editor>`.

## [0.1.0]

### Added

- Initial rewrite as a tosijs web component: custom selection via spanification,
  command-based editing, grid tables, and toolbar/menubar factories.

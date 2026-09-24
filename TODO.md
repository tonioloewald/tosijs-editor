[ ] FROM THE FOUR 0.5.0 REMEDIATION RE-REVIEWS (reviews/0.5.0-remediation-rereview\*.md).
Deferred and tracked, not "reviewed and fine".

    THE STRUCTURAL TWIN THAT KEEPS BITING — do this one first:
    - The refuse/override gate now exists in FOUR shapes: backspace(),
      forwardDelete(), the two table commands, and deleteSelection(). They have
      already diverged on arrival, and the same defect ("an overridden refusal
      must apply the WHOLE gesture untracked, and the refusal must be resolved
      BEFORE anything is mutated") was fixed three separate times in three
      separate rounds. Collapse them into one helper that takes the gesture and
      runs it in exactly one mode. Add ONE executable guard asserting the
      property across every reason, rather than per-site tests: only 3 of the 7
      documented reasons are exercised at all today.

    CHANGE TRACKING:
    - A RUN of backspaces should coalesce into one change, the way a run of
      typing coalesces into one insertion. Each keystroke is currently its own
      <tosi-del>, so deleting a word leaves eight rows in the review sidebar.
    - Paste inside a foreign insertion leaves the caret in the HEAD half of the
      split — insertTransfer calls openInsertion() but never moves ip.
    - A caret at a mark's START can leave an empty <tosi-ins> that nothing
      removes (Selectable.normalize only strips whitespace text nodes), which
      surfaces in `changes` as a row with no text.
    - refuseStructural('merge-blocks-selection') fires before the contains()
      and .editor-table guards, so it can refuse when no merge was possible.
    - TrackedChange still omits `session`, though data-session decides
      tracking behaviour.

    COVERAGE (nothing is red; these are absences):
    - No src/commands.test.ts case for the table deletes with tracking OFF —
      both existing tests set trackChanges = true and exercise only the early
      return.
    - M-2's unconditional `wasAnythingDeleted = true` has no test that fails
      without it (three paragraphs, tracking off, exact block boundaries).
    - EditableContext gained THREE required members this release (removeNode,
      tracksChanges, refuseStructural). Any external context construction
      breaks, and nothing in the repo catches it because tsconfig excludes the
      test files from typechecking. Either include them or add a
      type-level test.
    - The blockIsEmpty tosi-footnote case builds bare markup; the shipped
      element adds not-selectable/do-not-spanify in connectedCallback, so the
      test does not exercise the shape that actually reaches the predicate.
    - STILL NOT MEASURED IN A REAL ENGINE. This is unchanged and remains the
      single most important item in this file.

    SMALLER:
    - blockIsEmpty materializes every descendant via Array.from(...
      querySelectorAll('*')) before a loop that usually returns at index 0,
      and deleteSelection runs it per selected block — a block can be a whole
      editor table. Iterate the NodeList directly.
    - blockIsEmpty is now published API (index.ts re-exports dom-utils)
      carrying an undocumented policy list. Either document INLINE_WRAPPERS or
      stop exporting it.

[ ] FROM THE 0.5.0 NINE-LENS REVIEW (reviews/0.5.0-nine-lens.md). Everything the
review found and this release did NOT fix. Nothing here is "reviewed and fine";
it is "reviewed, deferred, tracked".

    CHANGE TRACKING — the gaps the feature ships with:
    - Line-break tracking. A change mark wraps CONTENT and a paragraph break is not
      content, so deletions that would MERGE blocks are currently REFUSED while
      tracking (Backspace at the start of a paragraph, Delete at the end of one,
      Backspace out of a list item). This is the honest behaviour, not the desired
      one. Doing it properly needs a representation for a deleted break.
    - Drag-move within the document should be one delete + one insert pair, so a
      reviewer sees a move rather than an unrelated deletion and insertion.
    - No merge story. Needs an operation log; changes-as-content deliberately is not
      one. See EXTENSIBILITY.md.
    - Pasting content that ALREADY contains tracked marks nests them, and
      acceptChange unwraps only the outer element. Marks are now re-stamped on
      paste (attribution and ids), but nesting is unresolved. The "leaves NO
      residue" tests only cover marks this editor created.
    - trackDeletion receives topSingleParentAncestor(node), which for a text node
      that is the only child of a <tosi-ins> climbs PAST the mark — so the
      "un-typing my own text" test can run against the wrong element.
    - TrackedChange omits `session`, though data-session decides tracking behaviour.

    reviseWith:
    - One serial LLM call per TEXT NODE: no batching, no bounded concurrency, no
      cancellation signal. `<p>the <b>quick</b> brown fox</p>` is five calls, so the
      proofreader cannot fix grammar across an inline run — the feature is weakest
      exactly where formatting exists. Batch by BLOCK and the problem goes away.
      (The half-revised-document-outside-undo part of this IS fixed.)

    SPELL CHECKING:
    - No suggestions ("did you mean"), and no incremental re-check: a word typed
      after a check is not flagged until the next full pass. syncSpellingValidity
      keeps validity honest about the marks that EXIST, but it is not live.
    - markHits' bare `catch {}` means a word straddling the bounds markers — the
      word the caret is in — is systematically never flagged. Possibly right;
      currently undocumented, untested and invisible.

    LEAKS AND CLEANUP:
    - `value` still carries the selection markers (.sel-start/.sel-end). docHTML
      serves BOTH `value` and the undo stack, and undo wants the caret back, so
      splitting them is a real design decision rather than an oversight. A host
      persisting `value` is storing editor chrome today.
    - TosiFootnote.connectedCallback stamps `not-selectable do-not-spanify` onto the
      light-DOM element, so view-state classes leak into `value` — the same leak
      docHTML goes to trouble to prevent for spelling marks. Express the exemption
      by tag instead.
    - docHTML's GETTER mutates the live DOM on every keystroke (via updateUndo) to
      produce a string. Serializing a detached clone would remove both the
      affordance dance and the mark unwrap/restore entirely. Measured 4.2x under
      happy-dom; the risk is running custom-element constructors on every clone.

    DRYNESS (each confirmed, none urgent):
    - "Unwrap an element, keeping its children" is hand-written five times
      (changes.ts, spelling.ts, tosijs-styled-editor.ts, commands.ts, dom-utils.ts)
      and three differ in whether they normalize. Export one `unwrap(el)`.
    - defineChanges / defineMisspelling / defineFootnote are three copies of one
      idempotent registration guard — and EXTENSIBILITY.md teaches the pattern to
      plugin authors. One `defineElement(tag, ctor)`.
    - Three copies of the Intl.Segmenter capability probe, whose fallbacks have
      already drifted.
    - The four global tag names are claimed with a silent customElements.get bail,
      no tag override and no documentation. Warn when the guard bails on a foreign
      constructor; say in README that importing registers these names.

    COVERAGE GAPS (no test is red; these are absences):
    - No src/changes.test.ts. tokenize/diffWords — the release's only non-trivial
      pure algorithm — are covered only by integration tests over one four-word
      ASCII sentence. Table-driven cases plus a lossless round-trip property.
    - Branches that can never execute in the suite: wordsIn's non-Segmenter
      fallback, markHits' catch, and reviseWith's `typeof revised !== 'string'`
      guard — the untrusted-response path.
    - extendSticky and the dragAnchor lifecycle are untested; only the pure
      stickySelectionBounds is covered.
    - The legacy <sup class="footnote-ref"> compatibility path is asserted by no
      test, because insertFootnote emits the new tag WITH THE SAME CLASS so every
      selector matches the new element. Legacy <sup> refs are also never upgraded,
      so they never get lifecycle reconcile.
    - Nothing verifies a <tosi-del> or <tosi-misspelling> inside a table cell
      survives column ops.
    - NOT MEASURED IN A REAL ENGINE. Spelling marks split text nodes across the
      whole document on every check, and tosi-ins/tosi-del are inline elements in
      the text flow. CLAUDE.md records that merely splitting a text node reshapes
      Arabic in WebKit by up to 4px. Every new test is happy-dom, where all rects
      are zero. Drive `bun start` + `hj eval` against the RTL page for reshaping,
      line re-wrap and block-height deltas. THIS IS THE MOST IMPORTANT ITEM HERE.

    DOWNSTREAM RENDERING (both are "the document means something different outside
    the editor", which is the same class as the <tosi-del> styling decision):
    - insertFootnote changed the saved format <sup> -> <tosi-footnote>, and the
      superscript rule lives only in the shadow stylesheet, so markers render as
      full-size baseline digits in any downstream renderer. `.footnote-ref` is
      retained, so one CSS rule repairs every already-written document — ship or
      document it.
    - No CSS ships or is documented for <tosi-ins>/<tosi-del> outside the editor,
      while README advertises that a tracked document "can be read by something
      that has never heard of this component" — where a <tosi-del> reads as live
      prose. Ship or document the six lines.
    - SECURITY.md says nothing about what `value` carries: plugin content elements
      whose meaning depends on styling the consumer may not have, and that a
      downstream sanitizer which UNWRAPS unknown tags inverts a <tosi-del>. One
      sentence there, plus a README note that acceptChanges() is how you hand a
      plain document to such a consumer.

    SMALLER:
    - docs/version.json records the build-time commit, so it can never survive
      `git diff --exit-code` and the Tier-0 stale-docs check has a permanent false
      positive. Exclude it or stamp it from HEAD.
    - Naming: Selectable.textIndexOf returns a struct, not an index. tokenize /
      diffWords / DiffOp / applyRevision are now generic top-level package exports
      with no hint they are word-diff internals.
    - extendSticky rebuilds the block text index and constructs two Segmenters per
      mousemove, re-segmenting an anchor whose bounds cannot change during a drag.
      0.72ms at 40k chars — under budget, but on the one handler already optimized
      once.

[ ] DEV-DEPENDENCY MAJORS HELD BACK DELIBERATELY — release-doctor asks "deliberate, or
stale?" on each, so this is the answer. Neither ships to consumers. - prettier ^2 (latest 3.x): upgrading reformats the whole codebase in one commit,
which buries real diffs. Do it alone, never alongside a release. - typescript ^5 (latest 7.x): a major with real breakage potential across the
selection and command types. Same rule — its own change, its own review.
Revisit when either blocks something concrete rather than on version-number anxiety.

[x] SWITCH TO kilpi — DONE in 0.4.5. The sanitizer is `tosijs-kilpi`, wired in at
src/dom-utils.ts as a re-export so the public API is unchanged, and it is this
package's first runtime dependency (tosijs and tosijs-ui remain peers).
WORTH KEEPING: it publishes as `tosijs-kilpi`, not the bare `kilpi` — npm rejects
that name as too similar to an existing package, and bare `kilpi` is in any case
permanently blocked (unpublished 2025-01-09). The repo is still named kilpi. Do not
re-litigate the prefix.
ALSO: the dependency is `^1.0.0`, and kilpi went 1.0.0 for that reason alone —
`^0.1.0` resolves to `>=0.1.0 <0.2.0`, so a 0.2.0 security fix would have reached no
installed consumer. For a dependency that IS the XSS defence, a range that blocks
propagation is a defect.

[ ] DELIBERATE SCOPE DECISION, not an oversight (from the review filed as reviews/0.4.6-pre-release.md; that work shipped as 0.4.4, B1). Sanitization
covers the two paths by which UNTRUSTED content enters: paste and drop, both through
insertTransfer(). It does NOT cover `editor.value = html` or initial light-DOM content
(tosijs-styled-editor.ts:655, :712) — those are host-supplied and in the host's own
trust domain, and sanitizing them would silently alter content a host deliberately
authored. The realistic stored-XSS chain (attacker pastes -> host stores `value` ->
re-serves) is cut at the paste end.
WHAT IS NOT COVERED: documents stored BEFORE this fix already contain whatever was
pasted into them. A host upgrading needs to sanitize its existing corpus; the component
cannot do that for them. If we ever want to, the seam should be an overridable
`sanitize(html)` hook applied in docHTML's setter, opt-in.

[x] Footnotes maintain themselves — DONE. `<tosi-footnote>` (src/footnote.ts) calls
renumberFootnotes from connected/disconnectedCallback, so deleting a reference removes
its entry and renumbers the survivors with no command run. Verified in Chromium and by
falsification: disabling disconnectedCallback makes the test fail.
WHAT THIS PROVED, for the plugins-by-default question in EXTENSIBILITY.md: - renumberFootnotes was never wrong. It already removed orphans and derived numbers
from document order. The only thing missing was a CALLER. Lifecycle is a better
caller than a global document-changed hook: per node, only for nodes that moved,
and it fires for edits nobody wrote code for. - Undo is the trap. innerHTML replacement disconnects every marker and reconnects
its replacement, so a synchronous reconcile inside disconnectedCallback deletes
entries whose markers are about to return. Coalescing to a microtask fixes it and
makes the work O(1) per edit instead of O(footnotes). - disconnectedCallback runs DETACHED, so `closest()` finds nothing at the one moment
it is needed. Capture the root on connect.
Still ATOMIC only. The container case — editable content inside a plugin element,
surviving Enter, partial deletion and cross-boundary drag — remains untested, and is
what spell-check annotations will actually exercise.

[x] Painted caret — DONE. Overlay lives in the shadow root beside [part="doc"], and its
geometry comes from caretGeometryAt(): a COLLAPSED RANGE AT A TEXT OFFSET beside the
marker, which reports the line box's height and an x the engine resolved for that
logical offset (so bidi needs no direction handling). Two traps found on the way:
collapsed BEFORE the marker element the engine returns an empty rect, and an
absolutely positioned child resolves against the containing block's PADDING box while
getBoundingClientRect() gives the BORDER box. Painted vs computed is now 0,0,0.

[ ] Selection bounds are ELEMENTS in the text, and WebKit does not shape across text node
boundaries — so inserting them splits the text and reshapes Arabic by up to 4px at
about half the positions in a line. This is the last visible artefact in Safari.
Splitting alone does it: `display: contents` and a bare splitText() measure
identically, so no styling fixes it. The fix is to hold the bounds as (node, offset)
pairs and paint the selection, rather than inserting marker elements — a change to the
selection model, and to the commands that read `.selected`. Chromium measures 0.
NOTE: the CSS Custom Highlight API was tried for the painting half and reverted — both
engines expose it, but ::highlight() would not paint for ranges inside a shadow tree
in WebKit, and it does not address the splitting anyway.

[ ] Five spanify sites remain, all transient (spanify then despanify inside one
operation, nothing persists): vertical arrow movement, list-item and table-cell
navigation. They still rewrite the document to measure it, so they carry the same
reshaping cost while they run. groupByLine/closestCharOnLine can be rebuilt on
Range.getClientRects(), which returns one rect per line box already.

[ ] IME composition is unhandled. No compositionstart/update/end listeners exist, so
during composition keypress fires for the raw keystrokes and we would insert
"nihao" as well as the committed 你好. Provisional text is also rendered INSIDE the
focused element, and our caret overlay is 2px wide with transparent text, so the
preview would be invisible. The caret overlay is now positioned AT the caret rather
than parked off-screen, which is what the candidate popup anchors to, so the
remaining work is the events and somewhere to show provisional text.

[ ] Arrow keys are LOGICAL, but Up/Down and the mouse are VISUAL — decide and unify.
`arrowLeft`/`arrowRight` use previousLeafNode/nextLeafNode, i.e. movement by
string order. In LTR that is identical to moving left/right on screen, which is
why it looks fine. In RTL it inverts: Left moves the caret visually RIGHT.
Two independent reasons to prefer visual: - Arrow keys are spatial keys; most RTL users expect Left to go left. macOS's
text system moves visually. (Genuinely contested though — Firefox ships
`bidi.edit.caret_movement_style` 0=logical / 1=visual / 2=hybrid precisely
because there is no consensus; its default is the hybrid.) - We are already inconsistent WITH OURSELVES, independent of bidi: click and
drag select by hit-testing character rects, and Up/Down already use
groupByLine/closestCharOnLine. Only Left/Right go by DOM order. So clicking
a spot and then pressing Left moves opposite to where you pointed.
Cheap to fix: the geometry helpers already exist — pick the nearest character
rect to the left/right on the same line instead of walking DOM order.
Do NOT make these visual: Backspace/Delete must stay logical (delete what you
just typed, whichever way it rendered) and Home/End are logical (start of line
= right edge in RTL). Word movement follows the arrow visually, but word
BOUNDARIES stay logical.
Worth an attribute (`caret-movement="visual|logical"`) defaulting to visual,
since the hybrid case — a direction boundary where two caret positions paint in
the same place — has no obviously right answer.

[ ] Toolbar/menu icon contrast in dark mode. The doc system declares
`button, select, .clickable { --text-color: var(--brand-color); color: var(--text-color) }`,
so our chain `--editor-text -> --tosi-text -> --text-color` RE-RESOLVES on every
button to the brand colour instead of the theme's text colour. `--editor-chrome-text`
is declared on `:host` but inherits as an unresolved token stream, so `var(--editor-text)`
inside it is substituted at the BUTTON, not the host. Measured dark: icon oklab L 0.36 on
a 0.16 bar. Document text is correct (#ddd on #050505). Likely fix: register the tokens
with `@property { syntax: '<color>'; inherits: true }` so they compute eagerly to a real
colour and inherit resolved. Filed upstream as tosijs-ui#150.

[x] Option-shift-left and option-shift-right arrows should extend selection by words. What happens now is chaos.
[ ] Tabbing into an empty table cell makes the entire table shaded as though selected (behavior is fine)

## Fixing the behavior of touch-based text editing

[ ] If a selection is created / updated by a touch event the selection should have extra touch affordances. A touch-target sized target (rounded with sharp corner bottom right, pinned bottom right to selection start) for dragging the selection start, a similar target (sharp corner top-right) for dragging the selection end, and a context menu target (pinned to the center of the selection at its bottom-left, sharp corner bottom-right) which gives you an explicit menu for copy / delete / paste / bold, italic, plain, etc.

So the diagram here is of a selection:

+--+ +--+
|A | |B |
+--+ +--+
| I am selected |
+--+
|C |
+--+

A is an affordance for altering the selection start (but it points to its bottom right), B is an affordance for working on the selection (discoverable, explicit menu), C is an affordance for altering the selection end.

When collapsed it looks like:

+--++--+
|A ||B |
+--++--+
|
+--+
|C |
+--+

Everything is visible, non-overlapping, touch-friendly, explicit and discoverable. No more touching a selection and praying this time you can copy.

## Debugging Notes

[x] OK drag selection isn't working. It just does point selection.

[x] The affordances look great now. I'd use icons.chevronLeft and icons.chevronRight for the start and end selection affordances.

[x] The context menu clips. It should just be positioned in bounds by hook or crook, and have an explicit close widget.

[x] If you extend a selection while the context menu is visible, it stays around and is orphaned.

[x] When I select across a large body of text (including part of a table) and hit backspace, it just deletes the last character in the selection and keeps the selection. Very very odd.

[x] When you use the context menu (very nice look by the way) it disappears immediately, and you lose the selection. Not good. Keep the selection at least. Also if you click near a boundary it can be clipped. And finally it's not shielded from undo so if you undo it reappears but is inoperable.

[x] Let's style the tosi-menu items so they look more like a menu bar and are bigger target (so no borders, fill the bar with more padding and no space around them.

[ ] typing text disables left/right arrow navigation. We thought we fixed it but we haven't.

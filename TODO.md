[ ] Redo the painted caret (reverted once — see below). The GOAL is sound: an <input>
    between characters is a replaced element and breaks the shaping run (measured on
    Arabic, a neighbour's advance moves 6.2 -> 6.7 even with a width-neutral box), and
    paint-without-a-box (box-shadow / outline) measured completely clean.
    WHY THE FIRST ATTEMPT FAILED, so the next one does not repeat it:
      1. The overlay elements were direct children of [part="doc"], which styles
         `> *` as document blocks — `position: relative; padding: 4px 8px` overrode the
         absolute positioning, so the selection edges rendered as large green and red
         RECTANGLES sitting in the text.
      2. Being doc children also puts them in the BLOCK MODEL: selectedBlocks(),
         block(), topLevelAncestor(), deleteSelection() and arrow navigation would all
         have treated them as paragraphs.
      3. syncCaret() ran only from focus(), so the caret froze wherever it last was —
         visible on the first keystroke, in any language.
    Next attempt: put the overlay in the SHADOW ROOT beside [part="doc"], not inside it,
    positioned against the host and offset by doc.scrollTop/Left; and drive repainting
    from every bounds mutation plus updateUndo(). Needs a browser test that types and
    arrows, since none of this is visible to DOM-structure assertions.

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
    Two independent reasons to prefer visual:
      - Arrow keys are spatial keys; most RTL users expect Left to go left. macOS's
        text system moves visually. (Genuinely contested though — Firefox ships
        `bidi.edit.caret_movement_style` 0=logical / 1=visual / 2=hybrid precisely
        because there is no consensus; its default is the hybrid.)
      - We are already inconsistent WITH OURSELVES, independent of bidi: click and
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

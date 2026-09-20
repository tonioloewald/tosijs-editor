# Extensibility and document-engine scope

Scoping notes, not a roadmap. Nothing here is committed, ordered, or promised. The
purpose is to record what each capability would actually cost, what already works in
its favour, and what gates what — so the decisions get made with numbers rather than
vibes.

Measurements in this document were taken in the browser against the live component.
Where something is asserted without a measurement it is marked as untested.

## Where this sits

tosijs-ui's doc system already owns the **outer** scope: the document set, navigation,
site structure, publishing. This component is the **inner** complement — what happens
inside one document. That division is worth holding onto, because a lot of what reads
as "FrameMaker features" is really book-level machinery that does not belong in an
editor at all:

| Concern | Belongs to |
| --- | --- |
| document set, navigation, publishing | doc system |
| cross-document references, shared numbering | doc system (editor emits anchors) |
| condition definitions and their on/off state | doc system |
| master pages, templates | doc system |
| text, selection, editing, in-document structure | editor |
| page breaking and page furniture when rendering | editor |
| condition *application* to content | editor (CSS, see below) |

The split matters most for conditional content: the *definition* of a condition and
whether it is currently on is a property of the document set, while the *marking* of
content is in the document. An editor that tries to own both ends up owning the whole
publishing pipeline.

## What exists today

One extension point: `editor.commands.myCommand = fn`, resolved by `executeCommand`
against the per-instance registry. A command is a **one-shot mutation triggered by a
user action**. That is the entire surface.

The limit is not theoretical. Footnotes are the closest thing to a real feature, and
they are a command that leaves footnote-shaped markup behind. Measured: insert two
footnotes, then delete one reference with Backspace the way a user would —

```
after inserting:  refs [1, 2]   items 2
after deleting:   refs [2]      items 2   <- orphaned text, survivor still numbered 2
```

`renumberFootnotes` runs at insertion time and nothing re-runs it. So today the
question "would the plugin architecture handle footnotes" has the awkward answer that
it does not fully handle the footnotes that are already shipped.

## Web components as the plugin substrate

A plugin defines a custom element and wraps content in it. This turns out to answer
most of the hard questions, and the properties were measured rather than assumed.

**Content survives the supporting component being absent.** An unregistered element in
the document:

```
upgraded:                   HTMLElement (never upgraded)
survives serialization:     yes, attributes intact
text visible to traversal:  ["Before ", "wrapped text", " after."]
inner text measurable:      yes  -> still editable and hit-testable
survives undo:              yes
```

So a document containing plugin markup opened in an editor without that plugin is
still fully editable, and round-trips losslessly. The plugin's markup degrades to
inert inline markup with the content intact. This is a much stronger guarantee than a
JSON-model editor can offer, where an unknown node type is typically dropped or fatal.

**Two plugin shapes fall out of shadow DOM, and the distinction is load-bearing.**

| | shadow DOM | light DOM |
| --- | --- | --- |
| example | footnote marker, variable, cross-reference | sidebar, conditional block, callout |
| editor traversal sees inner text | no (measured) | yes (measured) |
| behaves as | one atomic unit | container of editable content |
| carries own styles | yes, encapsulated | needs styles reachable from the doc |

Atomic widgets should also carry `.not-selectable` / `.do-not-spanify`, the conventions
that already exist for UI chrome.

**Custom element lifecycle replaces the document-changed hook.** Measured: 
`connectedCallback` and `disconnectedCallback` fire on insertion, on removal, and on
`innerHTML` restore. Since `docHTML` is the single choke point for reading and writing
document HTML and it assigns `innerHTML`, **undo rehydrates plugin state for free** —
restoring a snapshot re-runs every plugin's `connectedCallback`.

This matters for the footnote bug above: a `<tosi-footnote>` element would unregister
itself in `disconnectedCallback` when the user deletes it, and renumbering becomes a
local consequence of the element's own lifecycle rather than a global pass someone has
to remember to invoke. Per-node lifecycle is both more precise and cheaper than a
document-wide `onDocumentChanged` hook.

What a plugin registration still needs beyond the element itself: its commands, its
toolbar/menu contributions, and (for light-DOM plugins) a way to get styles into the
doc's shadow root. Those are small and additive.

**Untested:** whether a custom element that itself contains editable light-DOM content
behaves correctly across every editor operation — block splitting on Enter, deletion of
a partially-selected container, drag and drop of a range that straddles the boundary.
This is the main risk in the container-plugin shape and would need real work to
establish.

## Capability areas

### Invariant maintenance — footnotes, endnotes, numbering, cross-references

*Scope:* small-to-moderate. *Gated by:* nothing.

Mostly falls out of the web-component substrate above. Endnotes are footnotes with a
different collection target. Numbering is a derived view over document order.
Cross-references within a document are the same mechanism; across documents they
become an anchor the doc system resolves.

The real work is defining what happens at the awkward edges: a footnote inside a
deleted block, a reference whose target is gone, numbering across a document set.

### Change tracking

*Scope:* large. *Gated by:* the undo model.

Undo is full-HTML snapshots. That is a genuine strength — serialization is free, there
is no model/view desync, `value` just works, and plugin state rehydrates on restore.
But a snapshot records *that* the document changed, never *what* changed or by whom.

Change tracking needs per-edit attribution, which means operations alongside (not
instead of) snapshots. That is the single most expensive architectural decision in this
document, and it is load-bearing for collaborative editing too — one decision gates
both features.

An alternative worth weighing before committing: represent tracked changes *as content*
(`<tosi-ins>` / `<tosi-del>` elements carrying author and timestamp), which fits the
web-component substrate, survives serialization, and degrades gracefully. That gets
visible change marks without an operation log — but it does not give a merge story, so
it does not get collaboration.

### Conditional content

*Scope:* moderate, and unusually well-suited. *Gated by:* nothing technical.

Conditions attach to styles. The content is always present in the DOM and in `value`;
whether it renders is a question the *document set* answers. So the application is pure
CSS — a condition state on the host, rules that hide marked content — and no DOM
mutation is involved.

That has a property worth stating plainly: **hiding content never risks losing it**,
and a document round-trips losslessly regardless of which conditions were active when
it was edited. This is the failure mode that makes conditional text dangerous in
editors that implement it by removing nodes.

The open questions are editorial, not technical: showing authors that hidden content
exists, editing with conditions active, and what a selection that spans a hidden region
means.

### Sidebars and anchored content

*Scope:* moderate. *Gated by:* the container-plugin question above.

A light-DOM custom element anchored to a position in the flow. The editing story is the
container-plugin risk already noted; the layout story is mostly CSS until pagination
exists, at which point anchored content has to participate in page breaking.

### Pagination and page formats

*Scope:* large — a project, not a task. *Gated by:* nothing, surprisingly.

This is the one where the architecture is an asset rather than a liability. Page
breaking is fundamentally a *measuring* problem: where does this content cross a page
boundary. This editor already owns measurement — `Range.getClientRects()` returns one
rect per line box, which is exactly the primitive, and the same measuring-tape
technique already drives hit-testing and caret geometry.

A `contentEditable` editor cannot do this well, because it cannot control where the
browser breaks content it does not own. That is a real differentiator.

What it requires: separating the logical document from its rendered pages, so a
paginated view is a *rendering* of the document rather than its structure. Headers,
footers, mixed orientation, and chapter breaks then become properties of the rendering
layer. Hit-testing would need to work across multiple page containers rather than one
scrolling box — `characterAtPoint` walks from a root, so this is likely tractable, but
it is untested.

The cost is not the page-breaking algorithm, it is that every geometry-dependent
behaviour — vertical arrow movement, drag selection across a page boundary, the touch
affordances — has to learn about page boxes.

### Book-level capability

*Scope:* largely out of scope here. See the table at the top.

Variables, master pages, shared numbering and cross-document references are doc-system
concerns. The editor's part is to emit and preserve the anchors, and to not corrupt
markup it does not understand — which the web-component substrate already guarantees.

## What gates what

```
web-component plugin substrate
  -> invariant maintenance (footnotes, endnotes, numbering)
  -> conditional content        (independent, CSS-applied)
  -> sidebars                   (needs container-plugin editing proven)

operations alongside snapshots
  -> change tracking with attribution
  -> collaborative editing

logical document vs rendered pages
  -> pagination
  -> headers, footers, mixed orientation, chapter breaks
```

Three independent decisions. The first is small and fixes a shipped bug. The second is
expensive and unlocks two features. The third is a project and is where the
measurement-based architecture pays off.

## Open questions

- Does a container plugin survive Enter, partial deletion, and cross-boundary drag?
  PARTLY ANSWERED by `<tosi-misspelling>` (0.4.6): text inside a container plugin is
  visible to the editor's traversal, stays editable, and unwrapping leaves no stray
  text nodes. Enter, partial deletion and cross-boundary drag are still untested —
  those need real key and pointer events, not a unit test.
- Do tracked changes want to be content or an operation log — or both, at different
  layers?
- Does pagination render into multiple page containers, or one container with page
  furniture drawn between blocks? The first is more faithful; the second is far less
  disruptive to every geometry-dependent behaviour.
- Where does the condition state live so that both the doc system and a standalone
  embedded editor can set it?

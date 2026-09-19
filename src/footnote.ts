/**
 * `<tosi-footnote>` — a footnote reference that maintains its own entry.
 *
 * This is the first feature converted to the web-component substrate described
 * in EXTENSIBILITY.md, and it exists because of a shipped bug: `insertFootnote`
 * called `renumberFootnotes` at insertion time and nothing called it again, so
 * deleting a reference with Backspace left its text orphaned in the list and
 * the survivors mis-numbered.
 *
 * `renumberFootnotes` was never wrong — it already removes orphans and derives
 * numbers from document order. What was missing was anything to *call* it when
 * the document changed. Custom element lifecycle is that caller, and it is a
 * better one than a global "document changed" hook would have been: it fires
 * per node, only for the nodes that actually moved, and it fires for edits
 * nobody wrote code for — a deletion, a drag, a paste, an undo.
 */

import { renumberFootnotes } from './commands'

/**
 * Reconcile once per microtask, per document.
 *
 * Undo replaces the whole document via `innerHTML`, which disconnects every
 * footnote and then connects its replacement. Reconciling synchronously inside
 * `disconnectedCallback` would run against a half-replaced DOM and delete
 * entries whose markers are about to come back. Deferring to a microtask means
 * the work happens after the assignment completes, when the document is whole
 * again — and coalescing means one reconcile for a hundred footnotes, not a
 * hundred.
 */
const pending = new WeakSet<HTMLElement>()

function scheduleReconcile(root: HTMLElement | null): void {
  if (!root || pending.has(root)) return
  pending.add(root)
  queueMicrotask(() => {
    pending.delete(root)
    // The document may itself have been torn down in the meantime.
    if (root.isConnected) renumberFootnotes(root)
  })
}

export class TosiFootnote extends HTMLElement {
  /**
   * Captured on connect, because `disconnectedCallback` runs when this element
   * is ALREADY detached — `closest()` would find nothing at the only moment we
   * most need the document.
   */
  private editorRoot: HTMLElement | null = null

  connectedCallback(): void {
    this.editorRoot =
      (this.closest('[part="doc"]') as HTMLElement | null) ??
      (this.parentElement as HTMLElement | null)
    // Selection and hit-testing treat the marker as one opaque thing: the caret
    // has no business between the digits of a footnote number.
    this.classList.add('not-selectable', 'do-not-spanify')
    scheduleReconcile(this.editorRoot)
  }

  disconnectedCallback(): void {
    scheduleReconcile(this.editorRoot)
  }
}

/** The tag name, so callers do not hard-code a string that could drift. */
export const FOOTNOTE_TAG = 'tosi-footnote'

/**
 * Register the element.
 *
 * Idempotent, and safe to call in a non-browser environment — the editor's
 * tests run under happy-dom, and a plugin should never be the reason an import
 * throws somewhere it was not designed for.
 */
export function defineFootnote(): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(FOOTNOTE_TAG)) return
  customElements.define(FOOTNOTE_TAG, TosiFootnote)
}

/**
 * Tracked changes — insertions and deletions as CONTENT, with attribution.
 *
 * The alternative was an operation log alongside the undo snapshots.
 * EXTENSIBILITY.md weighs both: an operation log is the only thing that gets you
 * a merge story, and it is the most expensive decision in this codebase.
 * Changes-as-content gets everything except merge, for a fraction of the work,
 * and it fits the web-component substrate that footnotes and spelling already
 * proved.
 *
 * WHAT THIS BUYS THAT AN OPERATION LOG DOES NOT: a tracked document is still a
 * document. It serializes, round-trips, pastes into another editor, and can be
 * read by something that has never heard of this component.
 *
 * ONE ASYMMETRY TO KNOW ABOUT. A footnote plugin that fails to load is benign —
 * you see a stray marker. A `<tosi-del>` that fails to load renders deleted text
 * as ordinary prose, which reads as the opposite of what the document means. So
 * the strikethrough is load-bearing for CORRECTNESS, not decoration, and those
 * styles belong in the core stylesheet even though the behaviour is a plugin.
 */

/** Who made a change, and when. */
export interface ChangeAuthor {
  /** Stable id — a user id, or a model name for an LLM pass. */
  id: string
  /** What to show a reviewer. */
  name?: string
}

export interface TrackedChange {
  id: string
  kind: 'insert' | 'delete'
  author: string
  authorName: string
  time: string
  text: string
  element: HTMLElement
}

export const INS_TAG = 'tosi-ins'
export const DEL_TAG = 'tosi-del'

let changeSeq = 0
/**
 * A new change id.
 *
 * The sequence counter is not decoration. `Date.now()` alone collides whenever
 * two marks are produced in one synchronous handler, which is the NORMAL case:
 * typing over a selection and pasting over one both delete and then insert
 * inside a single keydown. Measured at 29% collision without the counter — and
 * a collision means `acceptChanges(deletionId)` silently also accepts the
 * replacement insertion, so a reviewer cannot accept a deletion and reject
 * what replaced it. Exported so there is ONE producer; there used to be three,
 * and only this one had the guard.
 */
export const changeId = (): string =>
  `chg-${Date.now().toString(36)}-${(changeSeq++).toString(36)}`

/**
 * Insertion and deletion marks.
 *
 * Both are CONTAINERS — the text inside stays ordinary editable text, because a
 * reviewer needs to be able to put the caret in a proposed sentence and adjust
 * it before accepting. They hold no state beyond their attributes: what a change
 * is, and who made it, is written in the document, not remembered by an
 * instance that would not survive a round trip.
 */
export class TosiIns extends HTMLElement {}
export class TosiDel extends HTMLElement {}

export function defineChanges(): void {
  if (typeof customElements === 'undefined') return
  if (!customElements.get(INS_TAG)) customElements.define(INS_TAG, TosiIns)
  if (!customElements.get(DEL_TAG)) customElements.define(DEL_TAG, TosiDel)
}

function mark(
  kind: 'insert' | 'delete',
  text: string,
  author: ChangeAuthor
): HTMLElement {
  const el = document.createElement(kind === 'insert' ? INS_TAG : DEL_TAG)
  el.setAttribute('data-change', changeId())
  el.setAttribute('data-author', author.id)
  if (author.name) el.setAttribute('data-author-name', author.name)
  el.setAttribute('data-time', new Date().toISOString())
  el.textContent = text
  return el
}

/** Every tracked change in a root, in document order. */
export function changesIn(root: Element): TrackedChange[] {
  return Array.from(
    root.querySelectorAll(`${INS_TAG}[data-change], ${DEL_TAG}[data-change]`)
  ).map((el) => ({
    id: el.getAttribute('data-change') || '',
    kind: el.tagName.toLowerCase() === INS_TAG ? 'insert' : 'delete',
    author: el.getAttribute('data-author') || '',
    authorName: el.getAttribute('data-author-name') || '',
    time: el.getAttribute('data-time') || '',
    text: el.textContent || '',
    element: el as HTMLElement,
  })) as TrackedChange[]
}

/** Unwrap an element, leaving its children where it was. */
function unwrap(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  el.remove()
}

/**
 * Accept a change: the insertion becomes ordinary text, the deletion goes.
 *
 * Accept and reject are deliberately symmetric and deliberately *dumb* — each
 * one resolves exactly one mark. Anything cleverer (accept all by this author,
 * accept this paragraph) is a filter over `changesIn` plus a loop, which is the
 * caller's policy rather than ours.
 */
export function acceptChange(el: Element): void {
  if (el.tagName.toLowerCase() === DEL_TAG) el.remove()
  else unwrap(el)
}

/** Reject a change: the insertion goes, the deletion becomes ordinary text. */
export function rejectChange(el: Element): void {
  if (el.tagName.toLowerCase() === INS_TAG) el.remove()
  else unwrap(el)
}

/**
 * A word-level diff.
 *
 * Word-level, not character-level, because the unit has to be something a
 * reviewer can meaningfully accept or reject. A character diff turns
 * `teh -> the` into three separate changes and a rewritten sentence into
 * confetti.
 *
 * Longest-common-subsequence over word tokens. Whitespace rides along with the
 * word that follows it so that rejoining is lossless — the output of a diff with
 * no changes is byte-identical to its input.
 */
export function tokenize(text: string): string[] {
  return text.match(/\s*\S+|\s+$/g) || []
}

export type DiffOp =
  | { op: 'same'; text: string }
  | { op: 'insert'; text: string }
  | { op: 'delete'; text: string }

/**
 * Above this many tokens on either side, fall back to replace-the-whole-thing.
 *
 * The LCS table is (n+1)x(m+1) numbers, and one side of this diff is a REMOTE
 * RESPONSE — whatever the proofreader returned. Measured: 8k tokens is 429 ms
 * and +366 MB; 16k (a 78 kB text node) is 1.7 s and +1.2 GB, synchronously on
 * the main thread. The asymmetric case is worse and cheaper to trigger: a
 * 200-word paragraph against a 200k-word response is +226 MB PER TEXT NODE.
 * 4000 tokens is a very long paragraph and costs about 128 MB worst case.
 *
 * Past the cap the change is still correct, just coarser: one deletion and one
 * insertion rather than a word-level diff. Degrading the review experience
 * beats freezing the tab.
 */
export const MAX_DIFF_TOKENS = 4000

export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokenize(before)
  const b = tokenize(after)

  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    const ops: DiffOp[] = []
    if (before) ops.push({ op: 'delete', text: before })
    if (after) ops.push({ op: 'insert', text: after })
    return ops
  }

  // LCS table. Documents proofread a paragraph at a time, so this stays small;
  // anything larger took the bail-out above.
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const ops: DiffOp[] = []
  const push = (op: DiffOp['op'], text: string): void => {
    const last = ops[ops.length - 1]
    if (last && last.op === op) last.text += text
    else ops.push({ op, text } as DiffOp)
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('delete', a[i])
      i++
    } else {
      push('insert', b[j])
      j++
    }
  }
  while (i < n) push('delete', a[i++])
  while (j < m) push('insert', b[j++])
  return ops
}

/**
 * Replace a text node's contents with the tracked result of revising it.
 *
 * Returns the number of changes introduced. Zero means the revision was
 * identical and the document was not touched at all — which matters, because a
 * proofreading pass that changes nothing should not dirty the document or
 * produce an undo step.
 */
export function applyRevision(
  node: Text,
  revised: string,
  author: ChangeAuthor
): number {
  const ops = diffWords(node.data, revised)
  if (!ops.some((o) => o.op !== 'same')) return 0

  defineChanges()
  const fragment = document.createDocumentFragment()
  let changes = 0
  for (const op of ops) {
    if (op.op === 'same') {
      fragment.appendChild(document.createTextNode(op.text))
    } else {
      fragment.appendChild(mark(op.op, op.text, author))
      changes++
    }
  }
  node.parentNode?.replaceChild(fragment, node)
  return changes
}

/**
 * Spell checking — the part the browser will not tell you.
 *
 * Two facts, and the second is the one that is easy to get wrong.
 *
 * A contentEditable editor gets browser spell checking for free and can query
 * **nothing** about it: no count, no list, no way to block a submit on
 * unresolved errors. That is the well-known half.
 *
 * The other half is that THIS editor gets no browser spell checking at all.
 * Browsers only check editing hosts — `<textarea>`, `<input>`, `contenteditable`
 * — and nothing here is one. So replacing contentEditable did not leave us with
 * an unqueryable layer to improve on; it left us with no layer. There is also,
 * for the same reason, no native right-click suggestion menu to inherit.
 *
 * WHAT THIS DOES NOT DO: ship a dictionary. A hunspell dictionary is ~1 MB
 * against a ~24 kB editor, and "which words are real" is a localization problem
 * with a different answer per document. The host supplies the checker:
 *
 * ```js
 * editor.spellChecker = async (words) => {
 *   const res = await fetch('/api/spell', { method: 'POST', body: JSON.stringify(words) })
 *   return new Set(await res.json())   // the words that are WRONG
 * }
 * await editor.checkSpelling()
 * editor.spellingErrors      // -> [{ word, element }, …]  the query browsers refuse
 * ```
 *
 * The checker is asked about DISTINCT words, once per check, so a 10,000-word
 * document with a 2,000-word vocabulary costs one call with 2,000 entries.
 */

/** A word the checker rejected, and the element marking it in the document. */
export interface SpellingError {
  word: string
  element: HTMLElement
}

/**
 * `(distinctWords) => the subset that is misspelled`.
 *
 * Returning a Set of *wrong* words rather than a per-word boolean keeps the
 * common answer ("all of these are fine") cheap to express — an empty Set.
 */
export type SpellChecker = (
  words: string[]
) => Set<string> | Promise<Set<string>>

export const MISSPELLING_TAG = 'tosi-misspelling'

/**
 * Marks one misspelled word.
 *
 * Unlike `<tosi-footnote>` this is a CONTAINER: its text stays in the light DOM
 * and stays editable, because the word underneath a squiggle is ordinary
 * document text that the user is presumably about to fix. That makes it the
 * first real test of the container-plugin case flagged in EXTENSIBILITY.md.
 *
 * It deliberately holds no state. Whether a word is still misspelled is decided
 * by the next check, not by this element remembering — an element that cached
 * its own verdict would go stale the moment someone typed inside it.
 */
export class TosiMisspelling extends HTMLElement {
  connectedCallback(): void {
    // Not `.not-selectable`: the whole point is that you can put the caret in
    // it and fix the word. It only must not be treated as a block.
    this.setAttribute('data-spelling', 'error')
  }
}

export function defineMisspelling(): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(MISSPELLING_TAG)) return
  customElements.define(MISSPELLING_TAG, TosiMisspelling)
}

/** Words as they appear in a root, with the text node and offsets that hold them. */
interface WordHit {
  word: string
  node: Text
  start: number
  end: number
}

function isCheckableText(node: Node): boolean {
  if (node.nodeType !== 3) return false
  const parent = (node as Text).parentElement
  if (!parent) return false
  // Chrome of ours, code, and anything the author excluded.
  return !parent.closest(
    '.not-selectable, .do-not-spanify, code, kbd, samp, pre, [spellcheck="false"]'
  )
}

/**
 * Every word in a root, in document order.
 *
 * Uses `Intl.Segmenter` word segmentation rather than a whitespace split,
 * because "word" is a language question: `l'objet` is two words in French,
 * `don't` is one in English, and neither is what splitting on spaces gives you.
 */
export function wordsIn(root: Element): WordHit[] {
  const hits: WordHit[] = []
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!isCheckableText(node)) continue
    const text = node as Text
    if (Segmenter) {
      const segmenter = new Segmenter(undefined, { granularity: 'word' })
      for (const piece of segmenter.segment(text.data)) {
        if (!piece.isWordLike) continue
        hits.push({
          word: piece.segment,
          node: text,
          start: piece.index,
          end: piece.index + piece.segment.length,
        })
      }
    } else {
      const re = /[^\s.,;:!?()[\]{}"'“”‘’—–]+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text.data))) {
        hits.push({
          word: m[0],
          node: text,
          start: m.index,
          end: m.index + m[0].length,
        })
      }
    }
  }
  return hits
}

/** Remove every marker, leaving the text exactly as it was. */
export function clearMisspellings(root: Element): void {
  for (const el of Array.from(root.querySelectorAll(MISSPELLING_TAG))) {
    const parent = el.parentNode
    if (!parent) continue
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    el.remove()
  }
  root.normalize()
}

/**
 * Wrap the given hits in markers, last-first.
 *
 * Last-first is not a style choice: wrapping splits the text node, which
 * invalidates every offset after the split point. Walking backwards means the
 * offsets still ahead of us are the ones we have not used yet.
 */
function markHits(hits: WordHit[]): HTMLElement[] {
  const marked: HTMLElement[] = []
  for (let i = hits.length - 1; i >= 0; i--) {
    const { node, start, end } = hits[i]
    if (start >= node.data.length) continue
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, Math.min(end, node.data.length))
    const mark = document.createElement(MISSPELLING_TAG)
    try {
      range.surroundContents(mark)
      marked.push(mark)
    } catch {
      // A range that straddles an element boundary cannot be surrounded. Skip
      // it rather than restructuring the document to make a squiggle fit.
    }
  }
  return marked.reverse()
}

/**
 * Check `root` and mark what the checker rejects.
 *
 * Returns the errors in document order. Existing markers are cleared first, so
 * calling this repeatedly converges rather than accumulating.
 */
export async function checkSpelling(
  root: Element,
  checker: SpellChecker,
  ignored: Set<string> = new Set()
): Promise<SpellingError[]> {
  defineMisspelling()
  clearMisspellings(root)

  const hits = wordsIn(root)
  if (hits.length === 0) return []

  // Ask once per DISTINCT word. A long document is mostly repetition, and the
  // checker may be a network call.
  const distinct = [...new Set(hits.map((h) => h.word))].filter(
    (w) => !ignored.has(w)
  )
  if (distinct.length === 0) return []

  const wrong = await checker(distinct)
  if (!wrong || wrong.size === 0) return []

  const bad = hits.filter((h) => wrong.has(h.word) && !ignored.has(h.word))
  if (bad.length === 0) return []

  // Group by text node so the backwards walk is correct within each node.
  const byNode = new Map<Text, WordHit[]>()
  for (const hit of bad) {
    const list = byNode.get(hit.node)
    if (list) list.push(hit)
    else byNode.set(hit.node, [hit])
  }
  for (const list of byNode.values()) {
    markHits(list.sort((a, b) => a.start - b.start))
  }

  // Document order, not text-node order — the caller wants to walk the errors
  // the way a reader would meet them.
  return Array.from(root.querySelectorAll(MISSPELLING_TAG)).map((el) => ({
    word: el.textContent || '',
    element: el as HTMLElement,
  }))
}

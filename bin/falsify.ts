#!/usr/bin/env bun
/**
 * Falsification as a lane: break each guarantee on purpose, and require the
 * suite to notice.
 *
 * CLAUDE.md has said since 0.5.0 that **a passing test is not evidence until
 * you have made it fail**, and every fix in 0.6.0 was verified that way — by
 * hand, once, and then the knowledge evaporated. Which is how the 0.6.0 dx
 * review found two fixes that could be deleted outright with the suite fully
 * green: the RTL sticky parameter and the entire affordance-handle delegation.
 * A test that stops testing its subject does not fail. Nothing notices.
 *
 * So the mutations live here as DATA. Each one names a guarantee, the edit that
 * removes it, and which tests must go red. A mutation that leaves the suite
 * green is reported as a SURVIVOR — meaning the guarantee is unguarded,
 * whatever the test names suggest.
 *
 * This is deliberately not general-purpose mutation testing. Blanket mutation
 * of a 4,000-line component produces hundreds of equivalent mutants and a
 * report nobody reads; these are the specific guarantees this editor has
 * actually broken, which is a list earned the expensive way.
 *
 *   bun run falsify              # every mutation
 *   bun run falsify sticky       # only those whose name matches
 *
 * SAFETY: it edits real source files, so it refuses to run on a dirty tree and
 * restores from an in-memory copy in a `finally`, plus on SIGINT/SIGTERM. The
 * clean-tree check is the actual guard — if the process is killed outright,
 * `git checkout` is the recovery and nothing uncommitted is at risk.
 */
import { $ } from 'bun'
import { readFileSync, writeFileSync } from 'fs'

interface Mutation {
  /** The guarantee, phrased so a survivor reads as a sentence about the code. */
  name: string
  file: string
  /** Must appear EXACTLY once, or the mutation is stale and reported as such. */
  find: string
  replace: string
  /** Substrings of test names that must go red. Empty = any failure will do. */
  expect: string[]
}

const MUTATIONS: Mutation[] = [
  {
    name: 'a touch drag records a drag anchor, so stickiness applies to it',
    file: 'src/selection.ts',
    find: `      this.setDragAnchor(hit)
      this.placeCaretAt(touch.clientX, touch.clientY)`,
    replace: `      this.placeCaretAt(touch.clientX, touch.clientY)`,
    expect: ['per pointer', 'touchstart records an anchor'],
  },
  {
    name: 'the unmergeable-blocks refusal cannot be overridden',
    file: 'src/tosijs-styled-editor.ts',
    find: `    this.refuseMerge()
    return true`,
    replace: `    if (!this.refuseStructural('merge-blocks-not-mergeable')) return false
    return true`,
    expect: ['refusal is final'],
  },
  {
    name: 'the unmergeable refusal is announced with tracking OFF too',
    file: 'src/tosijs-styled-editor.ts',
    find: `    if (unmergeable) this.refuseMerge()`,
    replace: `    if (unmergeable && this.trackChanges) this.refuseMerge()`,
    expect: ['announces the refusal'],
  },
  {
    name: 'one footnote list item per note, however many references',
    file: 'src/commands.ts',
    find: `    if (placed.has(key)) continue
    placed.add(key)`,
    replace: `    placed.add(key)`,
    expect: ['tracked merge over a footnote'],
  },
  {
    name: 'a duplicate footnote key keeps the AUTHORED text, not the placeholder',
    file: 'src/commands.ts',
    find: `    if (isPlaceholder(held) && !isPlaceholder(item)) {`,
    replace: `    if (held.textContent === PLACEHOLDER && item.textContent !== PLACEHOLDER) {`,
    expect: ['keeps authored text'],
  },
  {
    name: 'every change mark carries the session that made it',
    file: 'src/changes.ts',
    find: `  el.setAttribute('data-session', safeAttributeValue(attribution.session))`,
    replace: `  void attribution.session`,
    expect: ['one funnel', 'live change tracking'],
  },
  {
    name: 'resolution finds a nested mark’s owning block',
    file: 'src/tosijs-styled-editor.ts',
    find: `      .map((c) => this.block(c.element))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)`,
    replace: `      .map((c) => c.element.parentElement)
      .filter(
        (el): el is HTMLElement => !!el && el.parentNode === this.parts.doc
      )`,
    expect: ['chain of merges leaves no residue'],
  },
  {
    name: 'a cross-block selection delete keeps the FIRST block',
    file: 'src/tosijs-styled-editor.ts',
    find: `        this.mergeBlocksRaw(firstBlock, lastBlock)`,
    replace: `        const anchor = lastBlock.firstChild
        for (const node of Array.from(firstBlock.childNodes)) {
          lastBlock.insertBefore(node, anchor)
        }
        firstBlock.remove()`,
    expect: ['keeps the FIRST block'],
  },
  {
    name: 'an empty block merges into the previous one',
    file: 'src/tosijs-styled-editor.ts',
    find: `      if (emptyBlock && intoPrevious) {`,
    replace: `      if (false && emptyBlock && intoPrevious) {`,
    expect: ['merges backwards'],
  },
  {
    name: 'a cross-block gesture deletes the break, not a character',
    file: 'src/tosijs-styled-editor.ts',
    find: `      if (crossesBlocks) {
        // Backspace looks BACK, so the deletion target is the earlier block.
        this.mergeBlocksRaw(deletionBlock as Element, caretBlock as Element)
      } else if (node.nodeType === 3 && (node.textContent || '').length > 1) {`,
    replace: `      if (node.nodeType === 3 && (node.textContent || '').length > 1) {
        this.deleteEdgeCharacter(node as Text, 'end')
        if (crossesBlocks)
          this.mergeBlocksRaw(deletionBlock as Element, caretBlock as Element)
      } else if (crossesBlocks) {
        this.mergeBlocksRaw(deletionBlock as Element, caretBlock as Element)
      } else if (node.nodeType === 3 && (node.textContent || '').length > 1) {`,
    expect: ['untracked cross-block gesture'],
  },
  {
    name: 'the affordance handles delegate to Selectable',
    file: 'src/tosijs-styled-editor.ts',
    find: `    this.selectable.beginBoundDrag(which)`,
    replace: `    void which`,
    expect: ['affordance handles delegate'],
  },
  {
    name: 'stickySelection written on the component reaches the Selectable',
    file: 'src/tosijs-styled-editor.ts',
    find: `    this.pendingStickySelection = mode
    if (this.selectable) this.selectable.stickySelection = mode`,
    replace: `    this.pendingStickySelection = mode`,
    expect: ['crosses the component seam'],
  },
  {
    name: 'a cross-block merge is REFUSED unless trackStructuralEdits is on',
    file: 'src/tosijs-styled-editor.ts',
    find: `    if (this.trackStructuralEdits) return true
    this.refuseStructural(reason)
    return false`,
    replace: `    void reason
    return true`,
    expect: ['cross-block merge is refused'],
  },
  {
    name: 'a live handle drag stands the doc’s own touchmove down',
    file: 'src/selection.ts',
    find: `    if (!this.selecting || evt.touches.length !== 1) return
    if (this.boundDrag) return`,
    replace: `    if (!this.selecting || evt.touches.length !== 1) return`,
    expect: ['does not drive the bound'],
  },
  {
    name: 'a live handle drag stands the doc’s own touchend down',
    file: 'src/selection.ts',
    find: `    if (this.boundDrag) return
    if (this.selecting) {`,
    replace: `    if (this.selecting) {`,
    expect: ['does not tear the drag down'],
  },
  {
    name: 'a CANCELLED handle drag runs the same teardown as a finished one',
    file: 'src/tosijs-styled-editor.ts',
    find: `      handle.addEventListener('pointercancel', this.handleAffordanceDragEnd)
      handle.addEventListener(
        'lostpointercapture',
        this.handleAffordanceDragEnd
      )
`,
    replace: ``,
    expect: ['leaving nothing stale'],
  },
  {
    name: 'one pointermove re-marks the selection once',
    file: 'src/tosijs-styled-editor.ts',
    find: `    this.selectable.extendTo(cursorX, cursorY, drag.target)
`,
    replace: `    this.selectable.extendTo(cursorX, cursorY, drag.target)
    this.selectable.markBounds()
`,
    expect: ['once, not twice'],
  },
  {
    name: 'sticky selection measures PER LINE BOX, not the union rect',
    file: 'src/selection.ts',
    find: `    for (const r of Array.from(range.getClientRects())) {`,
    replace: `    for (const r of Array.from([range.getBoundingClientRect()])) {`,
    expect: ['wrapped anchor word'],
  },
]

const filter = process.argv[2]
const chosen = filter
  ? MUTATIONS.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()))
  : MUTATIONS

if (chosen.length === 0) {
  console.error(`no mutation matches ${JSON.stringify(filter)}`)
  process.exit(1)
}

// The tree must be clean: this writes to real source files, and a crash mid-run
// should never be able to take uncommitted work with it.
if ((await $`git status --porcelain`.quiet()).stdout.toString().trim()) {
  console.error(
    '🛑 the tree is not clean. This edits source files in place — commit or stash first.'
  )
  process.exit(1)
}

interface Outcome {
  mutation: Mutation
  verdict: 'caught' | 'SURVIVED' | 'STALE' | 'MISDIRECTED'
  detail: string
}

const outcomes: Outcome[] = []
let active: { file: string; original: string } | null = null

const restore = (): void => {
  if (active) {
    writeFileSync(active.file, active.original)
    active = null
  }
}
process.on('SIGINT', () => {
  restore()
  process.exit(130)
})
process.on('SIGTERM', () => {
  restore()
  process.exit(143)
})

try {
  for (const mutation of chosen) {
    const original = readFileSync(mutation.file, 'utf8')
    const occurrences = original.split(mutation.find).length - 1
    if (occurrences !== 1) {
      outcomes.push({
        mutation,
        verdict: 'STALE',
        detail: `its target appears ${occurrences} times in ${mutation.file} — the code moved, so this mutation is no longer testing what it names`,
      })
      continue
    }

    active = { file: mutation.file, original }
    writeFileSync(
      mutation.file,
      original.replace(mutation.find, mutation.replace)
    )
    const run = await $`bun test`.nothrow().quiet()
    restore()

    const output = run.stdout.toString() + run.stderr.toString()
    const failed = run.exitCode !== 0
    if (!failed) {
      outcomes.push({
        mutation,
        verdict: 'SURVIVED',
        detail: 'the suite stayed GREEN with this guarantee removed',
      })
      continue
    }
    const redNames = output
      .split('\n')
      .filter((l) => l.startsWith('(fail)'))
      .join('\n')
    const expected =
      mutation.expect.length === 0 ||
      mutation.expect.some((e) => redNames.includes(e))
    outcomes.push({
      mutation,
      verdict: expected ? 'caught' : 'MISDIRECTED',
      detail: expected
        ? `caught by: ${redNames.split('\n')[0].slice(0, 90)}`
        : `the suite failed, but none of ${JSON.stringify(
            mutation.expect
          )} is among the red tests — something else is guarding this, and the named tests may be vacuous`,
    })
  }
} finally {
  restore()
}

for (const o of outcomes) {
  const mark =
    o.verdict === 'caught' ? '✅' : o.verdict === 'STALE' ? '⚠️ ' : '❌'
  console.log(`${mark} ${o.mutation.name}`)
  console.log(`   ${o.detail}`)
}

const bad = outcomes.filter((o) => o.verdict !== 'caught')
console.log(
  `\n${outcomes.length - bad.length}/${outcomes.length} guarantees are guarded`
)
if (bad.length) {
  console.log(
    'A SURVIVOR means the guarantee is unguarded. A STALE mutation means the code moved and this file needs updating — not that the guarantee is safe.'
  )
  process.exit(1)
}

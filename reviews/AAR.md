# After-action reports

Three to six bullets per release, newest first. **Facts, not analysis** — what was found,
what it cost, what changed. The analysis happens in one batch at the quarterly pattern
review, which reads this file; per-release entries that editorialize make that pass
harder, not easier.

Required by `practices/releasing.md` step 10, which landed 2026-09-05 — before 0.4.4. The
first two entries below are backfilled from their review reports because this file did not
exist until 0.5.0, which is exactly the failure tosijs-ui hit and recorded when its own
quarterly lens had to reconstruct seven reports by hand.

---

## 0.6.0 — published 2026-10-07

- **Four reviews, all BLOCK, five correctness blockers — three of them introduced by the
  previous round's remediation.** Reports: `0.6.0-pre-release.md`, `0.6.0-remediation-rereview.md`,
  `0.6.0-dx-review.md` (all CLEARED) and `0.6.0-final-rereview.md`, which is filed as
  **RESOLVED BY DE-SCOPING, not fixed**. Same ratio as 0.5.0's four rounds, in the same
  subsystem.
- **Every blocker and major was one shape: one rule, several copies, and nothing that makes a
  divergence fail.** Word stickiness in three copies (mouse, touch, affordance handle); the
  mergeability gate pasted into `backspace()` twice and into `forwardDelete()` not at all;
  `refuseStructural`'s return value read at one of three sites; both resolution sweeps deriving
  a block by `parentElement`; `renumberFootnotes` and `resolvedClone` each handling identity as
  if the other did not exist. The suite was green for all of them. The lens whose job that is —
  `dryness` — sits in the `dx` tier, not in `always-on` or `pre-minor`, so the gate passed twice
  with the twins intact and the tier did not run until round three.
- **The owner de-scoped rather than fix.** `trackStructuralEdits` now defaults false and
  cross-block merges are refused via 0.5.x's reason strings, non-overridable; the remaining
  blocker was verified unreachable by default. The headline feature of the release therefore
  ships behind a flag, and finishing it is #3107 against 0.7.0.
- **A second fix for a cause nobody had demonstrated turned a fixed blocker into a worse one.**
  The footnote corruption was proven to be `renumberFootnotes` keying its map so a second
  reference minted a duplicate item; `resolvedClone` stripping `id` was added on top "for the
  general case", implemented neither coherent model of identity ownership, and permanently
  destroyed every descendant `id` on accept. Reverted rather than patched — all 8 footnote tests
  pass without it, which is what proved it unnecessary. Counter-rule written into CLAUDE.md;
  identity ownership filed as #3090.
- **Documentation asserting the opposite of the code held the tag three times in one release** —
  CLAUDE.md's superseded-proposal rule, CHANGELOG's copy of the same sentence, README's
  sticky-drag claim. The CLAUDE.md one had taught the inverse since 2026-09-26 and was found by
  verifying blockers against code rather than against commit messages. The mechanism that would
  make the fourth FAIL rather than ship — the doc-system ```test fences, this project's only
  layout-capable check — already existed, shipped, and was documented as load-bearing, in **no
  gate**: release-doctor discovers `test`/`test:*` scripts and a fence ran only when a human
  opened the page. `browser-tests/doc-fences.test.ts` runs it now, and found 4 examples across
  three generated pages with exactly **1** carrying tests (#3084).
- **Mutation testing added as a lane** (`bin/falsify.ts`, 14 guarantees as data, verdicts
  `caught`/`SURVIVED`/`MISDIRECTED`/`STALE`). It was prompted by the dx review finding two fixes
  in this release that could be deleted outright with the suite fully green — the RTL sticky
  parameter and the whole affordance-handle delegation. Final run 14/14 guarded. One entry was
  itself vacuous on first write: the empty-block guarantee reported GUARDED while tracked mode
  went unexercised, in the lane built to catch exactly that. Same family as 0.5.0's two wrong
  falsification checks.
- **The harness was wrong at least three times, each time looking like a product defect.** A
  single-line geometry stub could not express two blocks (fixed with per-block y bands);
  hand-placed markers plus `extendSelection()` deleted more than the selected range (fixed by
  driving real mouse events); and leaving `getBoundingClientRect` inconsistent with
  `getClientRects` made a mutation undetectable, since in a real engine the bounding rect *is*
  the union of the client rects. Also recorded: `parts.doc.innerHTML = …` destroys the affordance
  elements, so a describe-style probe reported handles absent.
- **`test:browser` depended on what the operator had running.** It assumed `bun start` was open;
  release-doctor runs every `test*` script, so the same commit reported red or green depending on
  that. `bin/test-browser.ts` now reuses a server already serving this repo and leaves it
  running, starts one if absent and stops only that, and refuses a port held by another directory
  — or by this one without answering. The ~1 GB `bunx playwright install webkit` prerequisite is
  machine-scoped and was undocumented; CLAUDE.md says so now.
- **`git checkout src/selection.ts` during a by-hand falsification destroyed uncommitted work.**
  `bin/falsify.ts` refuses a dirty tree for that reason, restores from an in-memory copy in a
  `finally`, and handles SIGINT/SIGTERM.
- **Two ordering facts about `attestedLanes`, both learned by failing first.** The dry run comes
  **after** the attestation — which inverts `publish.yml`'s own header, because its "Attested
  lanes need an attestation" step fails any run without `release-attestation.json`, dry or not.
  And `tag` takes the **branch** name for a dry run, since `dry_run` checks out `inputs.tag` as a
  ref directly. Both in CLAUDE.md.
- **Published and verified were two separate events, correctly labelled.** Approval landed after
  the 60-minute window, so the stage job timed out at 1h0m28s and `verify` was skipped; the run
  still went green, annotated "staged but was not approved within 60 minutes, so NOTHING has been
  verified." Recovered with `verify_only=true` on the same tag, which is what the annotation
  prescribes — published bytes identical to the staged tarball, `latest → 0.6.0`, consumer smoke
  test green against the registry's own copy. The 0.5.1 practice change (#2495) earning its keep:
  green did not read as verified.
- Final: npm 0.6.0, tag `v0.6.0` on `1809246` ("attest: v0.6.0", the only commit touching
  `release-attestation.json`), repo and registry agree. 48 commits, 44 files, +6992/−691. 381
  unit tests, 11 browser tests, 14 falsifications. release-doctor 0 failed, 0 warnings.
  Deferred and filed: #3083–#3091, #3100, #3104, #3107.

## 0.5.1 — 2026-09-26

- **A security fix that the 0.6.0 branch review found in code shipped four days
  earlier.** A `changeAuthor` display name containing `</style>` broke out of a
  raw-text element and became live HTML in `editor.value`. The writes were
  byte-identical on master, so 0.5.0 was affected; the reviewer proved it end to
  end by assigning the resulting value to a second editor.
- **Split by propagation, not by size.** For 0.x, `^0.5.0` is `>=0.5.0 <0.6.0`,
  so a patch reaches every consumer and a minor reaches none. The security fix
  wanted the first and the structural-tracking feature wanted the second, which
  is what made splitting them obvious rather than a judgement call.
- **First release through OIDC + staged publishing**, adopted the same day the
  practice landed. The `dry_run`-before-tagging step earned its keep immediately:
  it proved the Linux build reproduces and the consumer smoke test passes, so the
  tag was cut once — the pilot moved its tag five times, and 0.5.0 here needed
  tag surgery for a defect a dry run would have caught.
- Adopting it needed two repo changes the workflow itself requires: `.bun-version`,
  and dropping `--incremental` from `tsc` so `dist/tsconfig.tsbuildinfo` can never
  make a second build emit nothing.
- **Approval from a phone, minutes later.** The green run is the "published and
  verified" statement — `latest → 0.5.1`, integrity matched the staged tarball,
  and the consumer smoke test ran against the registry's own copy. Nothing
  polled npm.
- Moved to the virta board the same day: 33 tasks (23 from `TODO.md`, 8 from
  `UPSTREAM.md`, 2 GitHub issues). Worth recording that a straight `virta
onboard` would have imported **zero** TODO items — the file used bare `[ ]`
  lines rather than markdown list items, so the importer found none and said so
  only as a `0 item(s)` line nobody would read twice.

## 0.5.0 — published 2026-09-25 (reviewed 2026-09-21)

- **First full nine-lens pass on this repo.** Lens 8 (practices self-review) was skipped
  at 0.4.5 and at the review filed as `0.4.6-pre-release.md`, so its findings here are
  three releases of backlog surfacing at once: no `reviews/AAR.md`, no `UPSTREAM.md`, and
  KB write-backs proposed by three consecutive reviews that never landed.
- **Gate returned BLOCK, 4 confirmed blockers from 75 findings** (report: `0.5.0-nine-lens.md`, now CLEARED). Three were silent data loss in
  the two headline features: `editor.value` threw and permanently destroyed every spelling
  mark; spell check and `reviseWith` walked text nodes split by the caret, so a
  correctly-spelled word was flagged and the proofreader was sent half-words; and
  `trackChanges` deletion failed OPEN on six of seven destructive paths, including
  collapsed-caret Backspace.
- **The suite was 236 pass / 0 fail throughout, because none of the three had a test.**
  Green was not evidence of anything. The blockers were found by lenses reading the code,
  and two of them were found _because_ coverage flagged an untested shape.
- **Four regression tests written against confirmed, reproduced bugs passed against the
  UNFIXED code** and had to be rewritten — they asserted conditions the bugs did not
  actually violate (e.g. Latin marks separated by a real space never become adjacent; only
  the empty text nodes between CJK segments collapse). Every fix in this release is now
  pinned by a test verified to go red without it. Written into CLAUDE.md.
- **`typecheck` was not a script**, so release-doctor reported it as a skip. Making it one
  immediately caught a filter written against a field that does not exist
  (`c.type === 'deletion'` where `TrackedChange` has `kind: 'insert' | 'delete'`) — code
  added during this remediation, passing vacuously.
- **A `bun run make` was delegated to a running dev server** and reported different bundle
  sizes than a clean build. The trap is documented in this repo's own CLAUDE.md and was
  walked into anyway, while measuring numbers for the CHANGELOG.
- **tosijs-ui had been pinned at 1.13.0 for three releases** while the upstream fix for a
  trap this repo filed (#145) shipped in 1.14.1. The repo taught the failure as
  undetectable while the detector existed.
- **FOUR remediation re-reviews were needed, and the first three each found blockers
  introduced by the previous round's fix**: 4 blockers → 5 (3 mine) → 2 (both mine) →
  1 (mine) → 2 (both mine) → clean. Every one shipped with a fully green suite. The
  subsystem is change tracking, and the recurring shape was a _policy gate_ (refuse a
  structural edit; skip already-deleted text; decide what "empty" means) applied at one
  site while five others kept the old behaviour.
- **The same defect was fixed three times before the fix was right**: "an overridden
  structural refusal must apply the whole gesture untracked, and the refusal must be
  resolved BEFORE anything is mutated" — on the keystroke paths, then the table commands,
  then selection deletes. Each fix was correct for its site and reproduced the bug one
  site over. The gate now exists in four shapes and collapsing them is the top TODO item.
- **Writing a rule down does not apply it.** `blockIsEmpty()` was extracted with a doc
  comment reading _"'No text' is not enough on its own: an image, a rule, a line break or
  a table is content with no text content"_ — and the same commit, 460 lines away, gated a
  tail re-attachment on `tail.textContent` and silently destroyed `<img>` tails. Its
  replacement was then a _denylist_, which answered "empty" for `<svg>`, `<video>` and
  `<canvas>`; and its chrome skip made every `.not-selectable` plugin widget invisible,
  destroying annotations the shipped `annotate` command builds. Three rounds on one
  predicate.
- **Two falsification checks were themselves wrong** — one mutated a doc-comment example
  carrying the same line as the code, one threw on text prettier had reformatted and
  reported "0 fail", which I read as a result rather than as a failed script. A
  falsification check needs the same scepticism as the test it is checking.
- One test failure was a **harness** defect that looked exactly like the product defect
  under test: setting `.selected-block` without `.first-block`/`.last-block` makes every
  block count as interior. Probing rather than reasoning caught it.
- Fixed in-release: B1–B4, M1–M11, M13, plus the paste-attribution and empty-change-id
  hardening, and across four remediation rounds: the dead Backspace key, the caret-
  destroying `acceptChanges` sweep, insertion-splitting, the table-command tracking
  bypass, the `withoutBounds` caret loss, phantom changes, unselectable-widget
  destruction, the half-applied override (×3), and a pre-existing merge that reversed
  the first block's children (`A <b>B</b> C<i>D</i>` + `tail` → `<i>D</i> C<b>B</b>A tail`). Deferred and filed to `TODO.md`: line-break tracking, `reviseWith` batching
  (M6's other half), and the real-engine measurement of what spelling marks and inline
  change marks do to Arabic shaping — which is the most important open item.

- **Two defects were found AFTER the tag, while verifying what would ship** — and both were
  invisible to every gate that had already passed. The tarball carried
  `dist/.metadata_never_index`, a zero-byte macOS artifact: untracked, so absent from a clean
  checkout, from CI and from `git archive v0.5.0`, and publishable only from the one machine
  that had it. `files` listed `dist` wholesale. Fixed with `!dist/.*`; 0.5.0 was unpublished,
  so the tag was amended rather than a 0.5.1 minted (releasing.md: "never fix an unpublished
  tag with a new version number").
- **The tag was cut before the publish**, which is the reverse of the canonical flow — step 8
  exists precisely because an earlier project ended up with a tag naming a version the
  registry had never heard of. Here the publish landed and the tag was amended onto the
  corrected commit, so nothing was lost, but the order was wrong and `release-doctor`'s
  `tag/publish reconciliation` gate was red for four days saying so.
- **A verification script produced a vacuous PASS** while checking the published tarball: a
  regex for external imports assumed no space after `from`, matched nothing, and reported
  "undeclared: none" from an empty set. Caught because an empty result list is implausible,
  not because anything failed. Same family as the four falsification slips during the
  remediation.
- Final: npm 0.5.0, tag v0.5.0, repo all agree. 282 tests. 19 files / 155 kB packed.
  release-doctor 0 failed, 0 warnings.

## 0.4.5 — backfilled

- Sanitizer extracted to `tosijs-kilpi` and published; reached parity with DOMPurify on
  223 vendored fixtures at 18× smaller and 2–3× faster. `test/browser.mjs` is a hard
  prepublish gate.
- Two bypasses were found **in the fix for a bypass**: `java<TAB>script:` (`.trim()` does
  not match what the parser strips) and `<svg><script>` (`tagName` is uppercase only in
  the HTML namespace). A third was fixed in only one of two copies of the URL check.
- One sanitizer test was **vacuous**: happy-dom drops content after `</script>`, so a
  combined fixture meant the `<svg><style>` assertion passed against the pre-fix denylist
  — reading as coverage of a security property that did not exist.
- Lens 8 not run.

## 0.4.4 — backfilled

- Three adversarial review cycles, all filed under `reviews/` and marked CLEARED.
- Caret repaint on scroll/resize via ResizeObserver; both `setTimeout`s removed; an
  `insertionPoint` selector fix that had been silently disabling `insertFootnote`,
  `insertTable`, `insertImage` and `setLink`.
- A ResizeObserver regression was introduced and then measured in the wrong host: the
  "5 callbacks" figure came from a height-constrained page because the site config forces
  `height: 100%`, while the documented default is auto-height.
- The review report for this work is filed as `0.4.6-pre-release.md` — the version was
  chosen before the work settled, and the release shipped as 0.4.4. Lens 8 not run.

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

## 0.5.0 — 2026-09-21

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
- Fixed in-release: B1–B4, M1–M11, M13, plus the paste-attribution and empty-change-id
  hardening. Deferred and filed to `TODO.md`: line-break tracking, `reviseWith` batching
  (M6's other half), and the real-engine measurement of what spelling marks and inline
  change marks do to Arabic shaping — which is the most important open item.

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

# Upstream

**File, don't fix.** An ecosystem finding becomes an issue on the upstream repo; it
never becomes an edit to that repo from here. The one standing exception is
`tosijs-coding-practices`, which is written back to directly.

**The rows moved to the board** on 2026-09-26:
<https://virta.tosijs.net/host/#?virta.scope=tosijs-editor> — 8 items, tagged with
their upstream issue. Track status there, not here.

Still open at the time of the move, and none of them closable by this repo:

| Repo | Finding | Issue |
| --- | --- | --- |
| tosijs-ui | the happy-dom preload should ship an `ElementInternals` shim — without `attachInternals()` every `formAssociated` component in the ecosystem is untestable on validity | [#170](https://github.com/tonioloewald/tosijs-ui/issues/170) |
| tosijs-ui | `IconElement` is the declared return type of every `icons.*` and is exported from no entry point | [#176](https://github.com/tonioloewald/tosijs-ui/issues/176) |
| kilpi | `SECURITY.md` states no supported release lines, for a package this one pins `^1.0.0` specifically so security fixes propagate | [#1](https://github.com/tonioloewald/kilpi/issues/1) |

**Residual on a closed issue, do not lose:** tosijs [#22](https://github.com/tonioloewald/tosijs/issues/22)
is closed but its fix is conditional — a member declared `= null` still gets the
`on*`→event sugar, which is exactly the shape that forced `onWordAccepted` →
`handleWordAccepted` here. Do not rename it back.

The pre-move contents are in git history: `git show v0.5.1 -- UPSTREAM.md`.

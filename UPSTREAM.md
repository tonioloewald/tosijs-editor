# Upstream

Findings this repo sent to the repos it depends on, and what happened to them.

**File, don't fix.** An ecosystem finding becomes an issue on the upstream repo; it never
becomes an edit to that repo from here. The one standing exception is
`tosijs-coding-practices`, which is written back to directly — filing an issue there is a
deferral, not a write-back.

A row here without an issue URL is a graveyard. File first, mirror second.

| Repo | Finding | Issue | Status (checked) |
| --- | --- | --- | --- |
| tosijs-ui | `baseUrl` already carries the project-page path, so setting `basePath` too doubles it in canonical/og/sitemap | [#144](https://github.com/tonioloewald/tosijs-ui/issues/144) | ✅ resolved 2026-09-07 |
| tosijs-ui | `bundleEntry` silently REPLACES `iife.js` rather than extending it — omit the doc system from `demo/index.ts` and nothing registers, with no error | [#145](https://github.com/tonioloewald/tosijs-ui/issues/145) | ✅ resolved 2026-09-07 — shipped a `bundleRegistrations()` detector in 1.14.1 |
| tosijs-ui | Which fence languages EXECUTE in doc comments and markdown is undocumented; `css` and `html` turn illustrative blocks into live page content | [#146](https://github.com/tonioloewald/tosijs-ui/issues/146) | ✅ resolved 2026-09-07 |
| tosijs-ui | Doc-system `button, select, .clickable { --text-color: … }` redefines a token adopters set | [#150](https://github.com/tonioloewald/tosijs-ui/issues/150) | ✅ resolved 2026-09-10 |
| tosijs-ui | The exported happy-dom preload should ship an `ElementInternals` shim: with no `attachInternals()`, **every `formAssociated` component in the ecosystem is untestable on validity**. Also `Touch` is not constructible, and content after `</script>` / `</svg>` is dropped — which makes assertions *vacuous* rather than merely absent | [#170](https://github.com/tonioloewald/tosijs-ui/issues/170#issuecomment-5762498026) | 🔵 open — scoped from here 2026-09-21 |
| tosijs | `elementCreator`'s `on*`→event sugar shadows component METHODS named `onXxx` | [#22](https://github.com/tonioloewald/tosijs/issues/22) | ⚠️ closed 2026-08-21, **residual** — the fix is conditional: a member declared `= null` still gets the sugar, which is exactly the shape that forced `onWordAccepted` → `handleWordAccepted` here. The residual lives only in tosijs's private TODO.md, so a future maintainer seeing "CLOSED" could rename it back and silently create a dead listener slot. Do not rename. |
| kilpi | `SECURITY.md` states no supported release lines — and this package pins `^1.0.0` *specifically* so a security fix propagates, which only works if fixes land where the range can reach | [#1](https://github.com/tonioloewald/kilpi/issues/1) | 🔵 open — filed 2026-09-21 (ordered by the 0.4.5 review; never filed until now) |

## Kept current

`tosijs-ui` is on **1.15.0** as of 2026-09-21. It was pinned at 1.13.0 for three releases,
which meant #145's fix — the `bundleRegistrations()` detector for the exact silent failure
`demo/index.ts`'s `globalThis` hack exists to survive — never ran here, while CLAUDE.md
still taught that failure as undetectable. Upgrading is part of closing an upstream issue,
not a separate chore: a fix you asked for and never installed is still an open problem in
your repo.

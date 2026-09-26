# Security

## Reporting

- **A sanitizer bypass** — pasted or dropped content that reaches the document
  still able to execute — belongs to
  [`tosijs-kilpi`](https://github.com/tonioloewald/kilpi/issues). That is where
  the filtering code lives; this package only calls it.
- **Anything else** — [this repository's
  issues](https://github.com/tonioloewald/tosijs-editor/issues).

If you would rather not disclose publicly first, open an issue with no details
and we will find a private channel.

## What this package is responsible for

- applying sanitization at the **paste and drop choke point**, before any node
  enters the document (`insertTransfer`)
- the `editor.sanitize` hook, so a host can substitute its own sanitizer
- the two URL guards this package owns: `setLink`, and following a link on
  Ctrl/Cmd-click

## What it is NOT responsible for

- **the sanitization policy itself** — that is kilpi's, and
  [kilpi's SECURITY.md](https://github.com/tonioloewald/kilpi/blob/main/SECURITY.md)
  is authoritative. It is deliberately not restated here, because a copy of a
  policy drifts from the policy.
- **content the host supplies**: `editor.value = html` and initial light-DOM
  content are inside your trust boundary and are not filtered.
- **documents stored before 0.4.4**, which may already contain a pasted payload.
  Setting `value` does not filter, so sanitize your corpus as part of upgrading.

## `changeAuthor` is written into the document

`editor.changeAuthor` (`id` and `name`) is serialized verbatim into
`data-author` / `data-author-name` on every change mark, so it reaches
`editor.value`, the form value and every undo snapshot. It is host-supplied and
inside your trust boundary — but "the host wired it to a profile name" is the
ordinary case, so the editor does not trust it: `<` and `>` are stripped at the
seam (fully fixed in 0.5.2 — 0.5.0 is affected, and **0.5.1 is still affected
through `reviseWith()`**, whose write site the first fix missed).

They have to be stripped rather than escaped. HTML attribute serialization
escapes `&` and `"` and **never `<`**, and `style`, `xmp`, `title`, `textarea`,
`noembed`, `noframes` and `plaintext` re-parse their contents as raw text — so a
`</style>` inside an attribute value written into one of those terminates the
element and everything after it parses as markup. Nothing external triggers the
re-parse: `value` is also the undo stack, so a single undo does it in the same
session.

Two consequences worth knowing:

- **A display name is not a place to put markup**, and it comes back with its
  angle brackets removed rather than escaped. There is no escape that survives
  attribute serialization into a raw-text element.
- **Tracked edits inside a raw-text element remain a bad idea.** With no
  attacker at all, a caret marker left inside a `<style>` block round-trips into
  literal CSS text. Keeping the editor's own marks out of those elements is
  tracked as an open item; until it lands, do not point this editor at documents
  whose `<style>`/`<xmp>` content is meant to survive editing.

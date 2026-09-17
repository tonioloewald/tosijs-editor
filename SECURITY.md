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

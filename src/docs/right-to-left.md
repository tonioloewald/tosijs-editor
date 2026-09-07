# Right-to-Left Text

Bidirectional text is where an editor that fakes its own selection either works or
falls over. Selection here is resolved by measuring character spans, so the
interesting question is not "does Arabic render" — the browser does that — but
whether **selection, the caret and arrow keys follow the visual order** when the
visual order disagrees with the logical order.

Try it. Click into the Arabic paragraph, walk the caret with the arrow keys, and
double-click a word in each of the mixed lines.

```html
<tosijs-styled-editor widgets="default">
  <h2>عربي — a right-to-left block</h2>
  <p dir="rtl">
    هذا النص مكتوب من اليمين إلى اليسار. حاول تحديد كلمة بالنقر المزدوج،
    ثم حرّك المؤشر بمفاتيح الأسهم.
  </p>

  <h2>עברית — another right-to-left block</h2>
  <p dir="rtl">
    זהו טקסט מימין לשמאל. נסו לבחור מילה בלחיצה כפולה ולהזיז את הסמן.
  </p>

  <h2>Mixed, in a left-to-right paragraph</h2>
  <p>
    An English sentence containing العربية in the middle, then back to English.
    Numbers embed too: the price is ١٢٣٤ dinars, or 1234 if you prefer.
  </p>

  <h2>Right-to-left block with embedded left-to-right</h2>
  <p dir="rtl">
    جملة عربية تحتوي على English words في المنتصف، ثم تعود إلى العربية.
  </p>
  <p dir="rtl">
    الأمر هو <code>bun run make</code> وعنوان الموقع
    <code>https://tosijs.net</code> — كلاهما يُعرض من اليسار إلى اليمين
    داخل فقرة من اليمين إلى اليسار.
  </p>
  <p dir="rtl">
    الإصدار 1.13.0 صدر في 2026، والسعر 1,234.56 — الأرقام والترقيم
    هي الحالة الأصعب لأن اتجاهها يتغير داخل الجملة.
  </p>
  <ul dir="rtl">
    <li>عنصر عربي عادي</li>
    <li>عنصر يحتوي على <code>setBlockType h1</code> في وسطه</li>
  </ul>

  <h2>A list mixing both</h2>
  <ul>
    <li>Left-to-right item</li>
    <li dir="rtl">عنصر من اليمين إلى اليسار</li>
    <li>Another English item with עברית inside it</li>
  </ul>
</tosijs-styled-editor>
```

## What to look for

| Behaviour | Why it is hard |
|---|---|
| **Double-click a word** in an RTL run | Word boundaries are found by walking spanified characters, which are in *logical* order while the rendering is *visual* |
| **Arrow keys** across a direction boundary | One logical step can move the caret to the other end of a run |
| **Caret position** at the seam between scripts | The seam has two valid positions — the end of the LTR run and the start of the RTL run — that paint at the same place |
| **Selecting across a boundary** | A logically contiguous range is visually discontiguous, so a single highlight rectangle is wrong |
| **An LTR run inside an RTL line** | Code, URLs and version numbers stay left-to-right inside a right-to-left sentence, so one line can change direction twice |
| **Numbers and punctuation** | Digits are left-to-right even in RTL text, and trailing punctuation resolves against the surrounding run, not the number |

`<code>`, `<kbd>` and `<samp>` are given `direction: ltr; unicode-bidi: isolate`
inside the document, because they are left-to-right by nature: without the
isolate, a URL's slashes or a trailing period resolve against the paragraph's
RTL base direction and jump to the wrong end, even though the letters between
them render correctly. An explicit `dir` on the element opts out.

None of this is faked with `contentEditable`'s help — there is no browser
selection to lean on — so this page is the honest test of how far the DOM-only
approach gets. Anything broken here is a real bug worth filing rather than a
known limitation of the approach.

## Typing across a direction boundary

Type Latin into one of the Arabic paragraphs. The run and the caret are wrapped
in a `<span dir="ltr">` isolate as you type, and consecutive characters extend
that one isolate rather than making a new one each keystroke.

That is not cosmetic. The caret is an ELEMENT, and bidi treats an empty inline
as a neutral — so without the isolate it resolves against the *block's* base
direction rather than the run being typed, and jumps to the far side of the
line while your text appears somewhere else. Isolating the run fixes the caret
and renders the run correctly, which is the same fix `<code>` needs.

## Setting direction

`dir` is ordinary markup and is preserved through editing, so a document can mix
directions per block:

```xml
<p dir="rtl">…</p>
```

There is no toolbar command for it yet. `setBlocks` only writes CSS properties,
and `direction` set in CSS does not survive serialization the way the attribute
does.

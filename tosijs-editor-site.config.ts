import { defineSiteConfig } from 'tosijs-ui/site'
import { $ } from 'bun'
import { readFileSync } from 'fs'

/**
 * The one build/dev entry's config. `bin/site.ts` wraps `buildSite`/`devServer`
 * from tosijs-ui's doc system; there is no other build script.
 */
export default defineSiteConfig({
  name: 'tosijs-styled-editor',
  // static/ is copied to the web root, so these resolve at the served root
  favicon: '/tosijs-editor.svg',
  logo: '/tosijs-editor.svg',
  ogImage: '/tosijs-editor.svg',
  // Pen-ink blue; the doc system derives most of its palette from this
  theme: { accent: '#27488c' },

  // Sizing for every live example, in ONE place rather than per doc page.
  // The editor FILLS its preview rather than taking a fixed height: tosi-example
  // is `height: var(--tosi-example-height)` and becomes 100vh when maximized, so
  // a fixed height both overflows the normal case (the EXAMPLE scrolls instead of
  // the document) and ignores the space when maximized.
  headExtra: [
    '<style>',
    'tosijs-styled-editor {',
    '  --editor-surface: var(--tosi-bg, Canvas);',
    '  --editor-text: var(--tosi-text, CanvasText);',
    '  height: 100%;',
    '  border: 1px solid var(--editor-edge);',
    '  border-radius: 6px;',
    '  overflow: hidden;',
    '}',
    '.preview.preview { padding: 0 }',
    '</style>',
  ].join(''),
  // The doc system serves this at /localized-strings.txt and inits localization,
  // so the live examples can switch language. Adopters add a column.
  localizedStrings: readFileSync('localized-strings.tsv', 'utf8'),
  description:
    'Rich text editor web component — no contentEditable, no execCommand, no browser selection APIs',
  baseUrl: 'https://editor.tosijs.net',
  host: 'github-pages',
  // Custom domain: the build writes docs/CNAME, and Pages serves from the root
  // (so basePath stays '/'). Metadata URLs are baseUrl + path, and every
  // functional URL is emitted relative to its page, so nothing else changes.
  domain: 'editor.tosijs.net',

  // Docs are extracted from /*# … */ comments in src, plus the README
  docPaths: ['src', 'README.md'],
  outputDir: 'docs',

  // Registers <tosijs-styled-editor> so live examples in the docs actually run
  bundleEntry: 'demo/index.ts',
  checkExamples: {
    contextKeys: ['tosijs', 'tosijs-ui', 'tosijs-styled-editor'],
  },

  // Historic port for this project (see practices/development.md)
  port: 8789,

  // Remote access to THIS dev server over an SSH reverse tunnel. The ssh target
  // deliberately is NOT here — it comes from PREVIEW_HOST — so a committed
  // config can never redirect at someone else's box. Viewing requires a session
  // by default; this is an edit host, not an audience's.
  preview: {
    tunnel: { localPort: 8790 },
  },

  // Localhost-gated agent channel for real-browser inspection
  haltijaDev: true,

  projectLinks: {
    github: 'https://github.com/tonioloewald/tosijs-editor',
  },

  /** Stamp the version file from package.json before anything reads it */
  async prebuild() {
    const pkg = await Bun.file('package.json').json()
    await Bun.write(
      'src/version.ts',
      `export const version = '${pkg.version}'\n`
    )
  },

  /**
   * Emit the published package: types plus the ESM (peers external) and IIFE
   * (fully bundled) builds. Bundling runs in a CHILD PROCESS — Bun's bundler
   * never returns its native arena, so calling Bun.build() from the long-lived
   * dev server leaks tens of MB per rebuild (oven-sh/bun#34053).
   */
  async libraryBuild({ dist }) {
    try {
      await $`bun tsc --declaration --emitDeclarationOnly --incremental --outDir ${dist}`.quiet()
    } catch {
      // tsc emits declarations even when it reports errors
    }
    // Move ALL the declarations up, not just index.d.ts: it re-exports its
    // siblings (`export * from './dom-utils'` and so on), so moving one and
    // deleting the rest publishes a types entry pointing at files that are not
    // in the package.
    await $`cp -R ${dist}/src/. ${dist}/ || true`.quiet()
    await $`rm -rf ${dist}/src ${dist}/demo ${dist}/bin ${dist}/tosijs-editor-site.config.d.ts || true`.quiet()
    await $`bun build ./src/index.ts --outfile ${dist}/module.js --target browser --format esm --external tosijs --external tosijs-ui`.quiet()
    await $`bun build ./src/index.ts --outfile ${dist}/index.js --target browser --format iife`.quiet()
  },
})

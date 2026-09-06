import { defineSiteConfig } from 'tosijs-ui/site'
import { $ } from 'bun'

/**
 * The one build/dev entry's config. `bin/site.ts` wraps `buildSite`/`devServer`
 * from tosijs-ui's doc system; there is no other build script.
 */
export default defineSiteConfig({
  name: 'tosijs-styled-editor',
  description:
    'Rich text editor web component — no contentEditable, no execCommand, no browser selection APIs',
  // baseUrl already carries the project-page path, so basePath stays '/' (the
  // default). Setting BOTH doubles it: canonical/og/sitemap are built as
  // `baseUrl + withBase(basePath, path)`, which produced
  // https://tonioloewald.github.io/tosijs-editor/tosijs-editor/. Note that
  // llms.txt is built as `baseUrl + path` with no basePath at all, so this is
  // the only combination that makes both correct — see tosijs-ui issue.
  baseUrl: 'https://tonioloewald.github.io/tosijs-editor',
  host: 'github-pages',
  // A project page on github.io, NOT a custom domain. Without this the build
  // derives `domain` from baseUrl's hostname and writes a CNAME claiming
  // `tonioloewald.github.io`, which breaks Pages routing.
  domain: '',

  // Docs are extracted from /*# … */ comments in src, plus the README
  docPaths: ['src', 'README.md'],
  outputDir: 'docs',

  // Registers <tosi-styled-editor> so live examples in the docs actually run
  bundleEntry: 'demo/index.ts',
  checkExamples: {
    contextKeys: ['tosijs', 'tosijs-ui', 'tosijs-styled-editor'],
  },

  // Historic port for this project (see practices/development.md)
  port: 8789,

  // Localhost-gated agent channel for real-browser inspection
  haltijaDev: true,

  projectLinks: {
    github: 'https://github.com/tonioloewald/tosijs-editor',
  },

  /** Stamp the version file from package.json before anything reads it */
  async prebuild() {
    const pkg = await Bun.file('package.json').json()
    await Bun.write('src/version.ts', `export const version = '${pkg.version}'\n`)
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
    await $`mv ${dist}/src/index.d.ts ${dist}/index.d.ts || true`.quiet()
    await $`rm -rf ${dist}/src ${dist}/demo ${dist}/bin ${dist}/tosijs-editor-site.config.d.ts || true`.quiet()
    await $`bun build ./src/index.ts --outfile ${dist}/module.js --target browser --format esm --external tosijs --external tosijs-ui`.quiet()
    await $`bun build ./src/index.ts --outfile ${dist}/index.js --target browser --format iife`.quiet()
  },
})

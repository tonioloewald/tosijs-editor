#!/usr/bin/env bun
/**
 * The ONE build/dev entry for this repo — a thin wrapper over tosijs-ui's doc
 * system. `bun start` runs the dev server; `bun run make --build` builds.
 */
import { buildSite, devServer } from 'tosijs-ui/site'
import { readdir } from 'fs/promises'
import config from '../tosijs-editor-site.config'

/**
 * The site bundle is built with `--sourcemap=linked`, so every .js ends with a
 * `//# sourceMappingURL=` comment. We do NOT commit the maps — they are ~8MB per
 * build of dependency source — so on the deployed site that comment points at a
 * 404 that only ever appears in someone's devtools while they are chasing
 * something else.
 *
 * tosijs-ui guards against this (sourcemapWarning, tosijs-ui#103) but checks the
 * BUILT directory, where the maps do exist. They disappear at the git boundary,
 * which the build cannot see — so drop the reference here instead.
 *
 * Only runs on `--build`. A dev-server rebuild puts the comments back, which is
 * harmless locally (the maps are there) but means `bun run make` has to be the
 * last build before a commit — which the generated-files rule already requires.
 */
async function dropDanglingSourcemapRefs(): Promise<void> {
  const root = config.outputDir ?? 'docs'
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true })
    const found = await Promise.all(
      entries.map(async (entry) => {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) return walk(path)
        return entry.name.endsWith('.js') ? [path] : []
      })
    )
    return found.flat()
  }

  for (const path of await walk(root)) {
    const file = Bun.file(path)
    const js = await file.text()
    const stripped = js.replace(/\n?\/\/# sourceMappingURL=\S*\.map\s*$/, '\n')
    if (stripped !== js) await Bun.write(path, stripped)
  }
}

/**
 * Print what we are about to ask people to download.
 *
 * `libraryBuild` shells out to `bun build` with `.quiet()`, so a build printed
 * no size at all — and three separate committed size claims had drifted by the
 * time anyone checked. A number nobody sees is a number that goes stale.
 * `practices/performance.md` cites this repo as the exemplar for printing it,
 * which is exactly why it had to become true.
 */
async function reportBundleSizes(): Promise<void> {
  const gzip = (bytes: Uint8Array): number => Bun.gzipSync(bytes).length
  const kb = (n: number): string => (n / 1024).toFixed(1).padStart(6)

  // The baseline is committed, so the interesting number — the DELTA — is
  // available without rebuilding the previous release by hand. An absolute
  // size says nothing about a regression: tosijs-virta grew 3.8x across one
  // release with the build printing absolute sizes the whole time.
  const baselineFile = Bun.file('dist-sizes.json')
  const baseline: Record<string, { bytes: number; gzip: number }> =
    (await baselineFile.exists()) ? await baselineFile.json() : {}

  const current: Record<string, { bytes: number; gzip: number }> = {}
  for (const path of ['dist/index.js', 'dist/module.js']) {
    const file = Bun.file(path)
    if (!(await file.exists())) continue
    const bytes = new Uint8Array(await file.arrayBuffer())
    current[path] = { bytes: bytes.length, gzip: gzip(bytes) }

    const was = baseline[path]
    let delta = '(no baseline)'
    if (was) {
      const d = current[path].gzip - was.gzip
      const sign = d > 0 ? '+' : ''
      delta =
        d === 0
          ? '='
          : `${sign}${(d / 1024).toFixed(1)} kB ${sign}${(
              (d / was.gzip) *
              100
            ).toFixed(1)}%`
    }
    console.log(
      `  ${path.padEnd(16)} ${kb(current[path].bytes)} kB  ${kb(
        current[path].gzip
      )} kB gz  ${delta}`
    )
  }

  // `--record-sizes` rewrites the baseline. Deliberately NOT automatic: a
  // baseline that updates itself on every build can never show a regression,
  // which is the entire point of keeping one.
  if (process.argv.includes('--record-sizes')) {
    await Bun.write('dist-sizes.json', JSON.stringify(current, null, 2) + '\n')
    console.log('  baseline recorded in dist-sizes.json')
  }
}

if (process.argv.includes('--build')) {
  const ok = await buildSite(config)
  if (ok) {
    await dropDanglingSourcemapRefs()
    await reportBundleSizes()
  }
  process.exit(ok ? 0 : 1)
}

await devServer(config)

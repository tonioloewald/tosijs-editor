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

if (process.argv.includes('--build')) {
  const ok = await buildSite(config)
  if (ok) await dropDanglingSourcemapRefs()
  process.exit(ok ? 0 : 1)
}

await devServer(config)

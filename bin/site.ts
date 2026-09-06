#!/usr/bin/env bun
/**
 * The ONE build/dev entry for this repo — a thin wrapper over tosijs-ui's doc
 * system. `bun start` runs the dev server; `bun run make --build` builds.
 */
import { buildSite, devServer } from 'tosijs-ui/site'
import config from '../tosijs-editor-site.config'

if (process.argv.includes('--build')) {
  const ok = await buildSite(config)
  process.exit(ok ? 0 : 1)
}

await devServer(config)

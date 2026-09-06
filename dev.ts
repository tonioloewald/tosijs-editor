import * as path from 'path'
import { statSync } from 'fs'
import { gzipSync } from 'zlib'
import { watch } from 'chokidar'
import { $ } from 'bun'

const PORT = 8789
const PROJECT_ROOT = import.meta.dir
const PUBLIC = path.resolve(PROJECT_ROOT, 'docs')
const DIST = path.resolve(PROJECT_ROOT, 'dist')
const buildOnly = process.argv.includes('--build')

async function prebuild() {
  console.time('prebuild')
  const config = JSON.parse(await Bun.file('package.json').text())
  await Bun.write(
    'src/version.ts',
    `export const version = '${config.version}'`,
  )
  console.log(config.version)

  await $`rm -rf ${DIST}`.text()
  await $`mkdir -p ${DIST}`.text()
  console.timeEnd('prebuild')
}

async function build() {
  console.time('build')

  try {
    await $`bun tsc --declaration --emitDeclarationOnly --incremental --outDir dist`
  } catch {
    console.log('types created')
  }
  // Move declarations to expected locations
  await $`mv dist/src/index.d.ts dist/index.d.ts || true`.quiet()
  await $`rm -rf dist/src dist/demo dist/dev.d.ts || true`.quiet()

  // ESM build — externalize peer deps
  let result = await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: DIST,
    target: 'browser',
    format: 'esm',
    naming: 'module.js',
    external: ['tosijs', 'tosijs-ui'],
  })
  if (!result.success) {
    console.error('ESM build failed')
    for (const message of result.logs) {
      console.error(message)
    }
    return
  }

  // IIFE build — bundle everything
  result = await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: DIST,
    target: 'browser',
    format: 'iife',
    naming: 'index.js',
  })
  if (!result.success) {
    console.error('IIFE build failed')
    for (const message of result.logs) {
      console.error(message)
    }
    return
  }

  // Report gzipped sizes
  const esmFile = await Bun.file(`${DIST}/module.js`).arrayBuffer()
  const iifeFile = await Bun.file(`${DIST}/index.js`).arrayBuffer()
  const esmGzip = gzipSync(Buffer.from(esmFile))
  const iifeGzip = gzipSync(Buffer.from(iifeFile))
  console.log(
    `dist/module.js: ${(esmFile.byteLength / 1024).toFixed(1)}kb (${(esmGzip.length / 1024).toFixed(1)}kb gzip)`,
  )
  console.log(
    `dist/index.js: ${(iifeFile.byteLength / 1024).toFixed(1)}kb (${(iifeGzip.length / 1024).toFixed(1)}kb gzip)`,
  )

  // Build demo
  await $`mkdir -p ${PUBLIC}`.text()
  if (
    await Bun.file('./demo/index.html')
      .exists()
      .catch(() => false)
  ) {
    await $`cp ./demo/index.html ${PUBLIC}/`.text()
    if (
      await Bun.file('./demo/index.ts')
        .exists()
        .catch(() => false)
    ) {
      await Bun.build({
        entrypoints: ['./demo/index.ts'],
        outdir: PUBLIC,
        target: 'browser',
        format: 'esm',
        naming: 'index.js',
      })
    }
  }

  console.timeEnd('build')
}

watch('./src').on('change', () => prebuild().then(build))
watch('./demo').on('change', build)

await prebuild()
await build()

if (buildOnly) {
  process.exit(0)
}

function serveFromDir(config: {
  directory: string
  path: string
}): Response | null {
  const basePath = path.join(config.directory, config.path)
  const suffixes = ['', '.html', 'index.html']

  for (const suffix of suffixes) {
    try {
      const pathWithSuffix = path.join(basePath, suffix)
      const stat = statSync(pathWithSuffix)
      if (stat && stat.isFile()) {
        return new Response(Bun.file(pathWithSuffix))
      }
    } catch {}
  }

  return null
}

Bun.serve({
  port: PORT,
  fetch(request: any) {
    let reqPath = new URL(request.url).pathname
    if (reqPath === '/') reqPath = '/index.html'

    const publicResponse = serveFromDir({
      directory: PUBLIC,
      path: reqPath,
    })
    if (publicResponse) return publicResponse

    if (reqPath.startsWith('/dist/')) {
      const distResponse = serveFromDir({
        directory: PROJECT_ROOT,
        path: reqPath,
      })
      if (distResponse) return distResponse
    }

    return new Response('File not found', {
      status: 404,
    })
  },
})

console.log(`Listening on http://localhost:${PORT}`)

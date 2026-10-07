#!/usr/bin/env bun
/**
 * Run the browser lane, bringing up a dev server if there is not one already.
 *
 * The lane needs a real server because it drives a real engine: WebKit via
 * Playwright against `https://localhost:8789/right-to-left/`. It used to assume
 * someone had `bun start` running, which made its result depend on what the
 * operator happened to have open.
 *
 * That is not a convenience problem, it is a release-gate problem.
 * `release-doctor` runs every `test*` script, so it runs this one, and with no
 * server up it reported:
 *
 *     ❌ tests (test:browser) — 0 pass, 1 fail — exited with code 1
 *
 * A red Tier 0 that reads like a product defect and is really "you did not have
 * a server running" — while a releaser who happened to have one saw green. Same
 * repo, same commit, two answers, and nothing said which you were getting.
 *
 * So: reuse a server that is already serving THIS repo, start one if there is
 * none, and stop only a server we started ourselves.
 *
 * **Never stop a server we did not start.** Someone editing with `bun start`
 * open should not have it killed by a test run — and a port held by a DIFFERENT
 * repo is a collision, which this refuses rather than repairs. Same rule as
 * `bin/dev-stop.ts`, for the same reason: `pkill -f "bin/site.ts"` matches the
 * dev server of every repo using the tosijs-ui doc system, and killed
 * tosijs-3d's twice in one session.
 */
import { $ } from 'bun'

const PORT = process.env.PORT ?? '8789'
/** What the lane itself probes, so readiness means "ready for the tests". */
const READY_URL =
  process.env.RTL_URL ?? `https://localhost:${PORT}/right-to-left/`
const STARTUP_TIMEOUT_MS = 180_000

/** The working directory of whatever is listening on PORT, or null if nothing is. */
async function listenerCwd(): Promise<string | null> {
  const pids = (await $`lsof -ti:${PORT} -sTCP:LISTEN`.nothrow().quiet()).stdout
    .toString()
    .split('\n')
    .filter(Boolean)
  if (pids.length === 0) return null
  const out = (
    await $`lsof -a -p ${pids[0]} -d cwd -Fn`.nothrow().quiet()
  ).stdout.toString()
  return (
    out
      .split('\n')
      .find((l) => l.startsWith('n'))
      ?.slice(1) ?? 'an unknown directory'
  )
}

/**
 * Any HTTP answer means the server is listening AND routing. Status is not
 * checked on purpose: the dev-auth gate answers 401 to an unauthorised request,
 * which is a working server, and the tests carry their own session handling.
 */
async function responds(): Promise<boolean> {
  try {
    await fetch(READY_URL, { tls: { rejectUnauthorized: false } })
    return true
  } catch {
    return false
  }
}

const existing = await listenerCwd()
if (existing !== null && existing !== process.cwd()) {
  console.error(
    `refusing: :${PORT} is served by ${existing}, not ${process.cwd()}.\n` +
      `That is a port collision, not a server to reuse — free the port, or set PORT.`
  )
  process.exit(1)
}

let server: Bun.Subprocess | null = null

if (existing === process.cwd()) {
  // Listening is not the same as serving. A process in this directory holding
  // the port without answering is not a dev server to reuse, and reusing it
  // runs the whole lane against a dead socket: measured, that is 22 seconds of
  // Playwright timeouts reported as a test failure, which reads like a product
  // defect. Say what it actually is.
  if (!(await responds())) {
    console.error(
      `refusing: something in ${process.cwd()} holds :${PORT} but does not serve ${READY_URL}.\n` +
        `That is not a dev server — stop it (bun run dev:stop) and try again.`
    )
    process.exit(1)
  }
  console.log(`• reusing the dev server already on :${PORT}`)
} else {
  console.log(`• no dev server on :${PORT} — starting one`)
  // Spawned directly rather than through `bun run start`, so the process we
  // hold is the one to signal, with no shell or runner in between.
  // A local binding as well as the outer one: the outer `server` is what the
  // teardown below reads, the local is what this block can prove is non-null.
  const proc = Bun.spawn(['bun', 'bin/site.ts'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  server = proc

  // Kept rather than streamed: a healthy startup is noise in the test output,
  // and a failed one is the only thing that explains the failure.
  const log: string[] = []
  // A reader loop rather than `for await`: the DOM ReadableStream type this
  // project compiles against declares no async iterator, though Bun's does one
  // at runtime. Reading explicitly needs no cast to use.
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) log.push(decoder.decode(value))
    }
  }
  void drain(proc.stdout as ReadableStream<Uint8Array>)
  void drain(proc.stderr as ReadableStream<Uint8Array>)

  const stop = (): void => {
    if (proc.exitCode === null) proc.kill()
  }
  // A test run interrupted half way should not leave a server behind.
  process.on('SIGINT', () => {
    stop()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    stop()
    process.exit(143)
  })

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  let ready = false
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break
    if (await responds()) {
      ready = true
      break
    }
    await Bun.sleep(1000)
  }

  if (!ready) {
    console.error(
      proc.exitCode !== null
        ? `the dev server exited with code ${proc.exitCode} before serving ${READY_URL}`
        : `the dev server did not serve ${READY_URL} within ${
            STARTUP_TIMEOUT_MS / 1000
          }s`
    )
    if (log.length > 0) {
      console.error('\n--- dev server output ---')
      console.error(log.join('').trimEnd())
    }
    stop()
    process.exit(1)
  }
  console.log(`• dev server up on :${PORT}`)
}

// REBUILD BEFORE TESTING, and this is not belt and braces.
//
// `docs/` is the generated web root and it is COMMITTED, so the dev server has
// something to serve the instant it binds — which means readiness proves the
// server answers, not that what it answers with is this working tree. The lane
// therefore ran happily against a `docs/` built for the previous release.
//
// Measured, 0.7.0: every affordance was redesigned in `src/`, the whole lane
// went GREEN, and the bundle it tested still contained `touch-context-menu` —
// an element the source no longer creates. Eleven tests passed against the
// shipped 0.6.0 build. It surfaced only because one new test carried a
// precondition asserting the thing it was about to measure exists; without
// that, "0 fail" was the report.
//
// Same family as the defect this file was written to fix — a result that
// depends on state the lane does not control — but worse, because that one
// failed loudly and this one passes. ~2.5s against a 38s lane.
//
// A delegated build is fine here: CLAUDE.md warns that a `--build` handed to a
// running dev server reports different bundle SIZES than a clean build, and
// this lane measures layout, not sizes.
console.log('• rebuilding docs/ so the lane tests THIS tree')
const built = Bun.spawn(['bun', 'bin/site.ts', '--build'], {
  stdout: 'pipe',
  stderr: 'pipe',
})
if ((await built.exited) !== 0) {
  console.error(
    'refusing: the build failed, so the lane would test stale code.'
  )
  console.error(await new Response(built.stderr).text())
  console.error(await new Response(built.stdout).text())
  // Same teardown as the end of the run: stop only a server we started.
  if (server && server.exitCode === null) server.kill()
  process.exit(1)
}

// Extra arguments pass through, so `bun run test:browser -t "<name>"` works and
// ENGINE=chromium still selects the control engine.
const tests = Bun.spawn(
  ['bun', 'test', './browser-tests/', ...process.argv.slice(2)],
  {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  }
)
const code = await tests.exited

if (server) {
  console.log('• stopping the dev server this run started')
  if (server.exitCode === null) server.kill()
  await server.exited
}

process.exit(code)

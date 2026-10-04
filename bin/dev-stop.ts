#!/usr/bin/env bun
/**
 * Stop THIS repo's dev server, and nothing else.
 *
 * Exists because `pkill -f "bin/site.ts"` matches the dev server of every repo
 * using the tosijs-ui doc system — tosijs, tosijs-3d and tosijs-virta all have
 * the same entry point. It killed tosijs-3d's server twice in one session, the
 * second time one command after the agent doing it had written a practices note
 * telling agents not to. Guidance did not survive habit; a named command has a
 * chance, because it is the thing you reach for.
 *
 * The server's identity is its PORT. Verify the listener's cwd is this repo
 * before signalling it, and REFUSE otherwise: a port held by someone else means
 * a collision, and killing it is the wrong repair.
 */
import { $ } from 'bun'

const port = process.argv[2] ?? '8789'

const pids = (await $`lsof -ti:${port} -sTCP:LISTEN`.nothrow().quiet()).stdout
  .toString()
  .split('\n')
  .filter(Boolean)

if (pids.length === 0) {
  console.log(`nothing listening on :${port}`)
  process.exit(0)
}

for (const pid of pids) {
  const out = (
    await $`lsof -a -p ${pid} -d cwd -Fn`.nothrow().quiet()
  ).stdout.toString()
  const cwd = out
    .split('\n')
    .find((l) => l.startsWith('n'))
    ?.slice(1)
  if (cwd !== process.cwd()) {
    console.error(
      `refusing: :${port} is served by ${
        cwd ?? 'an unknown directory'
      }, not ${process.cwd()}`
    )
    process.exit(1)
  }
  process.kill(Number(pid))
  console.log(`stopped ${pid} (:${port})`)
}

import { tick } from "../src/server/pipeline"

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000)
const once = process.argv.includes("--once")

async function main() {
  do {
    const started = Date.now()
    try {
      await tick()
    } catch (err) {
      console.error(new Date().toISOString(), "tick failed", err)
    }
    if (once) break
    await new Promise((r) => setTimeout(r, Math.max(5_000, INTERVAL_MS - (Date.now() - started))))
  } while (true)
}

main()

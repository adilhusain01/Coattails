import { ingestTick, tradeTick } from "../src/server/pipeline"

const once = process.argv.includes("--once")

/** Runs `fn` every `intervalMs`, never overlapping itself. */
async function loop(name: string, fn: () => Promise<void>, intervalMs: number) {
  do {
    const started = Date.now()
    try {
      await fn()
    } catch (err) {
      console.error(new Date().toISOString(), `${name} failed`, err)
    }
    if (once) break
    await new Promise((r) => setTimeout(r, Math.max(2_000, intervalMs - (Date.now() - started))))
  } while (true)
}

loop("ingest", ingestTick, Number(process.env.INGEST_INTERVAL_MS ?? 60_000))
loop("trade", tradeTick, Number(process.env.TRADE_INTERVAL_MS ?? 20_000))

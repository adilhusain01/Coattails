/**
 * End-to-end check against the running app (devnet): a fresh wallet takes test USDC, follows a
 * member through the gasless follow flow, receives a mirrored buy, allows selling, and is sold
 * out by its trailing stop. Signs the way a browser wallet would: server builds, wallet signs,
 * server co-signs.
 *
 * Usage: npx tsx --env-file=.env scripts/e2e.ts [slug] [baseUrl]
 */
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
} from "@solana/kit"
import { and, eq } from "drizzle-orm"
import { db, schema } from "../src/server/db"

const slug = process.argv[2] ?? "nancy-pelosi"
const base = process.argv[3] ?? "http://127.0.0.1:3000"

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(`${path}: ${data.error ?? res.status}`)
  return data
}

const until = async (what: string, check: () => Promise<boolean>, timeoutMs = 240_000) => {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 8000))
  }
  console.log(`  ok: ${what} (${Math.round((Date.now() - start) / 1000)}s)`)
}

const user = await generateKeyPairSigner()
const wallet = user.address
console.log(`wallet ${wallet}`)

async function signAndSubmit(buildPath: string, buildBody: object, intent: object) {
  const { tx } = await api<{ tx: string }>(buildPath, { wallet, ...buildBody })
  const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(tx))
  const signed = await partiallySignTransaction([user.keyPair], decoded)
  return (await api<{ sig: string }>("/api/follow/submit", { wallet, signed: getBase64EncodedWireTransaction(signed), intent })).sig
}

type Me = {
  usdc: { balance: number; allowance: number }
  positions: { tokenSymbol: string; status: string; sellAllowed: boolean | null; closeReason: string | null }[]
  executions: { side: string; status: string; tokenSymbol: string; reason: string | null; sig: string | null }[]
}
const me = () => api<Me>(`/api/me?wallet=${wallet}`)

console.log("1. faucet")
await api("/api/faucet", { wallet })
await until("100 test USDC arrives", async () => (await me()).usdc.balance >= 100)

console.log("2. gasless follow (approve $50, $10 per trade, 15% trailing stop)")
const followSig = await signAndSubmit(
  "/api/follow/build",
  { slug, perTradeUsd: 10, budgetUsd: 50 },
  { type: "follow", slug, perTradeUsd: 10, trailingStopPct: 0.15, maxHoldDays: 90 },
)
console.log(`  follow tx ${followSig}`)
await until("allowance of $50 is on-chain", async () => (await me()).usdc.allowance >= 49.99)

console.log("3. replay the member's latest filing")
const source = await db.query.sources.findFirst({ where: eq(schema.sources.slug, slug) })
const { execSync } = await import("node:child_process")
execSync(`npx tsx --env-file=.env scripts/replay.ts ${slug}`, { stdio: "inherit" })
const filing = await db.query.filings.findFirst({
  where: and(eq(schema.filings.sourceId, source!.id)),
  orderBy: (f, { desc }) => desc(f.filedAt),
})
await until(
  "every trade on the filing is mirrored",
  async () => {
    const pending = await db.query.trades.findMany({
      where: and(eq(schema.trades.filingId, filing!.id), eq(schema.trades.mirrorStatus, "pending")),
    })
    return pending.length === 0
  },
  240_000,
)
const state = await me()
for (const e of state.executions) console.log(`  ${e.side} ${e.tokenSymbol} ${e.status} ${e.reason ?? ""} ${e.sig ?? ""}`)

console.log("4. allow selling")
const allowSig = await signAndSubmit("/api/autosell/build", {}, { type: "autosell" })
console.log(`  allow tx ${allowSig}`)
await until("positions report selling allowed", async () => (await me()).positions.filter((p) => p.status === "open").every((p) => p.sellAllowed))

console.log("5. trailing stop: pretend the stock peaked 40% higher, so the live price sits below the stop")
const follow = await db.query.follows.findFirst({ where: and(eq(schema.follows.wallet, wallet), eq(schema.follows.sourceId, source!.id)) })
const open = await db.query.positions.findMany({ where: and(eq(schema.positions.followId, follow!.id), eq(schema.positions.status, "open")) })
const target = open[0]
await db.update(schema.positions).set({ peakPx: target.peakPx * 1.4 }).where(eq(schema.positions.id, target.id))
await until(
  `${target.tokenSymbol} is sold by the trailing stop`,
  async () => (await me()).positions.some((p) => p.tokenSymbol === target.tokenSymbol && p.closeReason === "trailing_stop"),
  180_000,
)
const done = await me()
for (const e of done.executions.filter((x) => x.side === "sell")) console.log(`  sell ${e.tokenSymbol} ${e.status}: ${e.reason} ${e.sig}`)
console.log(`USDC now ${done.usdc.balance.toFixed(2)}, allowance ${done.usdc.allowance.toFixed(2)}`)
console.log("e2e passed")
process.exit(0)

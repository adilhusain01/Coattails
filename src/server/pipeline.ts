/**
 * The loop the worker runs: read new filings, write their receipts, mirror their trades.
 * Each step is idempotent and picks up where the last run stopped.
 */
import { address } from "@solana/kit"
import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm"
import { db, schema } from "./db"
import { readHouseFiling, syncHouseIndex } from "./ingest/house"
import { syncForm4 } from "./ingest/sec"
import { livePrice } from "./prices"
import { tokenBySymbol } from "./registry"
import { fillBuy, fillSell, stockBalance, stockMint, usdcAllowance, writeReceipt } from "./solana/agent"

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

/** Largest gap allowed between the live Pyth/Jupiter price and a fill, as a fraction. */
const MAX_PRICE_AGE_S = 15 * 60

let lastForm4 = 0
const FORM4_EVERY_MS = 10 * 60_000

export async function ingest() {
  const added = await syncHouseIndex(Number(process.env.HOUSE_INDEX_WINDOW ?? 1000))
  if (added) log(`index: ${added} new filings`)
  if (Date.now() - lastForm4 > FORM4_EVERY_MS) {
    lastForm4 = Date.now()
    const r = await syncForm4(1, 150)
    if (r.trades) log(`form4: ${r.trades} insider purchases from ${r.candidates} filings`)
  }
}

/** Members read first: the names people already search for. */
const WATCHLIST = (process.env.HOUSE_WATCHLIST ?? "pelosi,khanna,gottheimer,mccaul,greene,crenshaw,tuberville")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export async function readFilings(limit = 5) {
  const pending = await db
    .select({ filing: schema.filings, name: schema.sources.name })
    .from(schema.filings)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.filings.sourceId))
    .where(eq(schema.filings.status, "new"))
    .orderBy(desc(schema.filings.filedAt))
  const watched = (n: string) => WATCHLIST.some((w) => n.toLowerCase().includes(w))
  const queue = [...pending.filter((p) => watched(p.name)), ...pending.filter((p) => !watched(p.name))]
    .slice(0, limit)
    .map((p) => p.filing)
  await Promise.all(
    queue.map(async (f) => {
      try {
        const n = await readHouseFiling(f)
        log(`read ${f.docId}: ${n} trades`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log(`read ${f.docId} failed: ${message}`)
        await db.update(schema.filings).set({ status: "failed", error: message }).where(eq(schema.filings.id, f.id))
      }
    }),
  )
}

export async function writeReceipts(limit = 5) {
  const queue = await db.query.filings.findMany({
    where: and(eq(schema.filings.status, "parsed"), isNull(schema.filings.receiptSig)),
    orderBy: asc(schema.filings.filedAt),
    limit,
  })
  for (const f of queue) {
    const trades = await db.query.trades.findMany({ where: eq(schema.trades.filingId, f.id) })
    const mirrored = trades.filter((t) => t.tokenSymbol).length
    const memo = `coattails:v1|${f.kind}|${f.docId}|sha256:${f.sha256}|trades:${trades.length}|mirrorable:${mirrored}`
    try {
      const sig = await writeReceipt(memo)
      await db.update(schema.filings).set({ receiptSig: sig, status: "receipted" }).where(eq(schema.filings.id, f.id))
      log(`receipt ${f.docId}: ${sig}`)
    } catch (err) {
      log(`receipt ${f.docId} failed: ${err instanceof Error ? err.message : err}`)
      return
    }
  }
}

async function recordExecution(row: typeof schema.executions.$inferInsert) {
  await db.insert(schema.executions).values(row).onConflictDoNothing()
}

/** Mirrors one trade into every follower who followed before the trade arrived. */
async function mirrorTrade(trade: schema.Trade, filing: schema.Filing) {
  const token = trade.tokenSymbol ? tokenBySymbol(trade.tokenSymbol) : null
  if (!token || !trade.ticker) {
    await db.update(schema.trades).set({ mirrorStatus: "skipped" }).where(eq(schema.trades.id, trade.id))
    return
  }
  const followers = await db.query.follows.findMany({
    where: and(
      eq(schema.follows.sourceId, trade.sourceId),
      eq(schema.follows.active, true),
      lte(schema.follows.createdAt, trade.createdAt),
    ),
  })
  if (followers.length === 0) {
    await db.update(schema.trades).set({ mirrorStatus: "done" }).where(eq(schema.trades.id, trade.id))
    return
  }

  const quote = await livePrice(trade.ticker)
  const age = Date.now() / 1000 - quote.publishTime
  const stock = await stockMint(token.symbol, token.name, token.mint)
  const base = {
    tradeId: trade.id,
    side: trade.side,
    tokenSymbol: token.symbol,
    pythPx: quote.price,
    createdAt: new Date(),
  } as const

  await Promise.all(
    followers.map(async (f) => {
      const owner = address(f.wallet)
      const memo = `coattails:v1|fill|${filing.docId}|${trade.side}|${token.symbol}|px:${quote.price.toFixed(4)}|src:${quote.source}|receipt:${filing.receiptSig}`
      try {
        if (age > MAX_PRICE_AGE_S && quote.source !== "jupiter") {
          await recordExecution({ ...base, followId: f.id, wallet: f.wallet, status: "rejected", reason: `Price is ${Math.round(age / 60)} min old` })
          return
        }
        if (trade.side === "buy") {
          const { allowance, balance } = await usdcAllowance(owner)
          const usd = Math.min(f.perTradeUsd, allowance, balance)
          if (usd < 1) {
            await recordExecution({
              ...base,
              followId: f.id,
              wallet: f.wallet,
              status: "rejected",
              reason: allowance < 1 ? "Budget used up. Top up your allowance to keep mirroring." : "Not enough USDC in wallet",
            })
            return
          }
          const fill = await fillBuy({ owner, usd, price: quote.price, stock, memo, multiplier: token.multiplier })
          await recordExecution({ ...base, followId: f.id, wallet: f.wallet, usdcAmount: fill.usdc, tokenAmount: fill.tokens, fillPx: quote.price, sig: fill.sig, status: "confirmed" })
        } else {
          const held = await stockBalance(owner, stock)
          const tokens = Math.min(held.tokens, held.delegatedToAgent)
          if (held.tokens <= 0) {
            await recordExecution({ ...base, followId: f.id, wallet: f.wallet, status: "rejected", reason: `No ${token.symbol} to sell` })
            return
          }
          if (!f.autoSell || tokens <= 0) {
            await recordExecution({ ...base, followId: f.id, wallet: f.wallet, status: "rejected", reason: "Auto-sell is off for this position. Sell it from your portfolio." })
            return
          }
          const fill = await fillSell({ owner, tokens, price: quote.price, stock, memo })
          await recordExecution({ ...base, followId: f.id, wallet: f.wallet, usdcAmount: fill.usdc, tokenAmount: fill.tokens, fillPx: quote.price, sig: fill.sig, status: "confirmed" })
        }
      } catch (err) {
        await recordExecution({ ...base, followId: f.id, wallet: f.wallet, status: "failed", reason: err instanceof Error ? err.message.slice(0, 300) : String(err) })
      }
    }),
  )
  await db.update(schema.trades).set({ mirrorStatus: "done" }).where(eq(schema.trades.id, trade.id))
  log(`mirrored ${trade.side} ${token.symbol} for ${followers.length} followers`)
}

export async function mirror(limit = 10) {
  const filings = await db.query.filings.findMany({ where: eq(schema.filings.status, "receipted") })
  if (!filings.length) return
  const byId = new Map(filings.map((f) => [f.id, f]))
  const queue = await db.query.trades.findMany({
    where: and(eq(schema.trades.mirrorStatus, "pending"), inArray(schema.trades.filingId, [...byId.keys()])),
    orderBy: asc(schema.trades.createdAt),
    limit,
  })
  for (const trade of queue) {
    try {
      await mirrorTrade(trade, byId.get(trade.filingId)!)
    } catch (err) {
      log(`mirror trade ${trade.id} failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

export async function tick() {
  await ingest().catch((e) => log("ingest failed", e))
  if (process.env.SARVAM_API_KEY) await readFilings()
  await writeReceipts()
  await mirror()
}

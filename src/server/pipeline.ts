/**
 * The loop the worker runs: read new filings, write their receipts, mirror their trades.
 * Each step is idempotent and picks up where the last run stopped.
 */
import { address } from "@solana/kit"
import { and, asc, desc, eq, inArray, isNull, lt, lte } from "drizzle-orm"
import { db, schema } from "./db"
import { readHouseFiling, syncHouseIndex } from "./ingest/house"
import { syncForm4 } from "./ingest/sec"
import { livePrice, livePrices } from "./prices"
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

let readsPausedUntil = 0

export async function readFilings(limit = 5) {
  if (Date.now() < readsPausedUntil) return
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
        if (/credit|quota|402|429|rate limit/i.test(message)) {
          // Out of Sarvam credits or rate limited: keep the filing queued and back off.
          readsPausedUntil = Date.now() + 30 * 60_000
          log(`read ${f.docId} deferred: ${message.split("\n")[0]}; pausing reads for 30 min`)
          return
        }
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

export async function recordExecution(row: typeof schema.executions.$inferInsert) {
  await db.insert(schema.executions).values(row).onConflictDoNothing()
}

/** Mirrors one trade into every follower who followed before the trade arrived. */
async function mirrorTrade(trade: schema.Trade, filing: schema.Filing) {
  const token = trade.tokenSymbol ? tokenBySymbol(trade.tokenSymbol) : null
  if (!token || !trade.ticker) {
    await db.update(schema.trades).set({ mirrorStatus: "skipped" }).where(eq(schema.trades.id, trade.id))
    return
  }
  // A filing often lists several lots of the same stock (shares and calls, several dates).
  // Followers get one mirror per stock and direction per filing: the lowest-id lot carries it.
  const sibling = await db.query.trades.findFirst({
    where: and(
      eq(schema.trades.filingId, trade.filingId),
      eq(schema.trades.tokenSymbol, token.symbol),
      eq(schema.trades.side, trade.side),
      lt(schema.trades.id, trade.id),
    ),
  })
  if (sibling) {
    await db.update(schema.trades).set({ mirrorStatus: "done" }).where(eq(schema.trades.id, trade.id))
    return
  }
  const followers = await db.query.follows.findMany({
    where: and(
      eq(schema.follows.sourceId, trade.sourceId),
      eq(schema.follows.active, true),
      eq(schema.follows.demo, false),
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
          await openPosition({ follow: f, trade, symbol: token.symbol, tokens: fill.tokens, usd: fill.usdc, price: quote.price })
        } else {
          // Sell only what was bought by mirroring this member.
          const open = await db.query.positions.findMany({
            where: and(eq(schema.positions.followId, f.id), eq(schema.positions.tokenSymbol, token.symbol), eq(schema.positions.status, "open")),
          })
          const owned = open.reduce((a, p) => a + p.tokens, 0)
          if (owned <= 0) {
            await recordExecution({ ...base, followId: f.id, wallet: f.wallet, status: "rejected", reason: `No ${token.symbol} bought from this member to sell` })
            return
          }
          const held = await stockBalance(owner, stock)
          const tokens = Math.min(owned, held.tokens, held.delegatedToAgent)
          if (tokens <= 0) {
            for (const p of open) await markExitDue(p, `${trade.side === "sell" ? "The member sold" : "Exit"}: allow Coattails to sell`)
            await recordExecution({ ...base, followId: f.id, wallet: f.wallet, status: "rejected", reason: "Selling is not allowed yet. Allow it from your portfolio." })
            return
          }
          const fill = await fillSell({ owner, tokens, price: quote.price, stock, memo })
          await recordExecution({ ...base, followId: f.id, wallet: f.wallet, usdcAmount: fill.usdc, tokenAmount: fill.tokens, fillPx: quote.price, sig: fill.sig, status: "confirmed" })
          for (const p of open) await closePosition(p, "member_sold", quote.price, fill.sig)
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

// ---------------------------------------------------------------------------------------------
// Positions and exit rules. Disclosures arrive late, so a member's sale may come after the drop.
// Each position carries its own exits, checked against live prices every tick: a trailing stop
// from the highest price seen, and a maximum holding period.

export async function openPosition(opts: { follow: schema.Follow; trade: schema.Trade; symbol: string; tokens: number; usd: number; price: number }) {
  const existing = await db.query.positions.findFirst({
    where: and(eq(schema.positions.followId, opts.follow.id), eq(schema.positions.tokenSymbol, opts.symbol), eq(schema.positions.status, "open")),
  })
  if (existing) {
    const tokens = existing.tokens + opts.tokens
    const cost = existing.costUsd + opts.usd
    await db
      .update(schema.positions)
      .set({ tokens, costUsd: cost, entryPx: cost / tokens, peakPx: Math.max(existing.peakPx, opts.price), lastPx: opts.price })
      .where(eq(schema.positions.id, existing.id))
    return
  }
  await db.insert(schema.positions).values({
    wallet: opts.follow.wallet,
    followId: opts.follow.id,
    tradeId: opts.trade.id,
    tokenSymbol: opts.symbol,
    ticker: opts.trade.ticker!,
    tokens: opts.tokens,
    costUsd: opts.usd,
    entryPx: opts.price,
    peakPx: opts.price,
    lastPx: opts.price,
    openedAt: new Date(),
  })
}

export async function closePosition(p: schema.Position, reason: NonNullable<schema.Position["closeReason"]>, price: number, sig: string) {
  await db
    .update(schema.positions)
    .set({ status: "closed", closeReason: reason, closePx: price, closeSig: sig, closedAt: new Date(), exitDue: null, lastPx: price })
    .where(eq(schema.positions.id, p.id))
}

async function markExitDue(p: schema.Position, why: string) {
  if (p.exitDue !== why) await db.update(schema.positions).set({ exitDue: why }).where(eq(schema.positions.id, p.id))
}

export function exitReason(p: schema.Position, f: schema.Follow, price: number) {
  if (f.trailingStopPct && price <= p.peakPx * (1 - f.trailingStopPct)) {
    return { rule: "trailing_stop" as const, text: `Trailing stop: ${(((p.peakPx - price) / p.peakPx) * 100).toFixed(1)}% below the $${p.peakPx.toFixed(2)} peak` }
  }
  const days = (Date.now() - p.openedAt.getTime()) / 86_400_000
  if (f.maxHoldDays && days >= f.maxHoldDays) {
    return { rule: "max_hold" as const, text: `Held ${Math.floor(days)} days, the limit you set` }
  }
  return null
}

export async function guardExits() {
  const open = await db.query.positions.findMany({ where: eq(schema.positions.status, "open") })
  if (!open.length) return
  const prices = await livePrices(open.map((p) => p.ticker))
  const follows = await db.query.follows.findMany({
    where: and(inArray(schema.follows.id, [...new Set(open.map((p) => p.followId))]), eq(schema.follows.demo, false)),
  })
  const followById = new Map(follows.map((f) => [f.id, f]))

  for (const p of open) {
    const quote = prices.get(p.ticker)
    const f = followById.get(p.followId)
    if (!quote || !f) continue
    const peak = Math.max(p.peakPx, quote.price)
    if (peak !== p.peakPx || quote.price !== p.lastPx) {
      await db.update(schema.positions).set({ peakPx: peak, lastPx: quote.price }).where(eq(schema.positions.id, p.id))
    }
    const exit = exitReason({ ...p, peakPx: peak }, f, quote.price)
    if (!exit) continue

    const token = tokenBySymbol(p.tokenSymbol)
    if (!token) continue
    try {
      const owner = address(p.wallet)
      const stock = await stockMint(token.symbol, token.name, token.mint)
      const held = await stockBalance(owner, stock)
      const tokens = Math.min(p.tokens, held.tokens, held.delegatedToAgent)
      if (held.tokens <= 0) {
        await closePosition(p, "manual", quote.price, "")
        continue
      }
      if (tokens <= 0) {
        await markExitDue(p, exit.text)
        continue
      }
      const memo = `coattails:v1|exit|${exit.rule}|${token.symbol}|px:${quote.price.toFixed(4)}|src:${quote.source}`
      const fill = await fillSell({ owner, tokens, price: quote.price, stock, memo })
      await recordExecution({
        tradeId: p.tradeId,
        followId: p.followId,
        wallet: p.wallet,
        side: "sell",
        tokenSymbol: token.symbol,
        usdcAmount: fill.usdc,
        tokenAmount: fill.tokens,
        pythPx: quote.price,
        fillPx: quote.price,
        sig: fill.sig,
        status: "confirmed",
        reason: exit.text,
        createdAt: new Date(),
      })
      await closePosition(p, exit.rule, quote.price, fill.sig)
      log(`exit ${exit.rule} ${token.symbol} for ${p.wallet}`)
    } catch (err) {
      log(`exit ${p.tokenSymbol} for ${p.wallet} failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

/** Slow loop: pull new filings and read them. EDGAR and the House index are polled politely. */
export async function ingestTick() {
  await ingest().catch((e) => log("ingest failed", e))
  if (process.env.OPENROUTER_API_KEY || process.env.SARVAM_API_KEY) await readFilings()
}

/** Fast loop: receipts, mirrors and exits. Kept separate so a slow ingest never delays an exit. */
export async function tradeTick() {
  await writeReceipts().catch((e) => log("receipts failed", e))
  await mirror().catch((e) => log("mirror failed", e))
  await guardExits().catch((e) => log("exits failed", e))
}

export async function tick() {
  await ingestTick()
  await tradeTick()
}

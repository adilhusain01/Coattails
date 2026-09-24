import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, schema } from "./db"
import { livePrices } from "./prices"

export type TradeView = {
  id: number
  ticker: string | null
  assetName: string
  side: "buy" | "sell"
  amountLow: number | null
  amountHigh: number | null
  tradedAt: string
  disclosedAt: string
  tokenSymbol: string | null
  pxTraded: number | null
  pxDisclosed: number | null
  pxNow: number | null
  priceSource: string | null
}

export type SourceView = {
  slug: string
  kind: "house" | "insider"
  name: string
  seat: string | null
  affiliation: string | null
  photoUrl: string | null
}

export type FilingView = {
  id: number
  docId: string
  kind: "house_ptr" | "form4"
  url: string
  sha256: string | null
  filedAt: string
  status: string
  receiptSig: string | null
  source: SourceView
  trades: TradeView[]
  mirrors: number
}

function sourceView(s: schema.Source): SourceView {
  return { slug: s.slug, kind: s.kind, name: s.name, seat: s.seat, affiliation: s.affiliation, photoUrl: s.photoUrl }
}

async function tradeViews(trades: schema.Trade[]): Promise<TradeView[]> {
  const prices = await livePrices(trades.filter((t) => t.tokenSymbol && t.ticker).map((t) => t.ticker!))
  return trades.map((t) => {
    const q = t.ticker ? prices.get(t.ticker) : undefined
    return {
      id: t.id,
      ticker: t.ticker,
      assetName: t.assetName,
      side: t.side,
      amountLow: t.amountLow,
      amountHigh: t.amountHigh,
      tradedAt: t.tradedAt.toISOString(),
      disclosedAt: t.disclosedAt.toISOString(),
      tokenSymbol: t.tokenSymbol,
      pxTraded: t.pxTraded,
      pxDisclosed: t.pxDisclosed,
      pxNow: q?.price ?? null,
      priceSource: q?.source ?? null,
    }
  })
}

async function filingViews(filings: schema.Filing[]): Promise<FilingView[]> {
  if (!filings.length) return []
  const ids = filings.map((f) => f.id)
  const [sources, trades, mirrorCounts] = await Promise.all([
    db.query.sources.findMany({ where: inArray(schema.sources.id, [...new Set(filings.map((f) => f.sourceId))]) }),
    db.query.trades.findMany({ where: inArray(schema.trades.filingId, ids) }),
    db
      .select({ filingId: schema.trades.filingId, n: sql<number>`count(${schema.executions.id})` })
      .from(schema.executions)
      .innerJoin(schema.trades, eq(schema.trades.id, schema.executions.tradeId))
      .where(and(inArray(schema.trades.filingId, ids), eq(schema.executions.status, "confirmed")))
      .groupBy(schema.trades.filingId),
  ])
  const views = await tradeViews(trades)
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const mirrorsBy = new Map(mirrorCounts.map((m) => [m.filingId, Number(m.n)]))
  return filings.map((f) => ({
    id: f.id,
    docId: f.docId,
    kind: f.kind,
    url: f.url,
    sha256: f.sha256,
    filedAt: f.filedAt.toISOString(),
    status: f.status,
    receiptSig: f.receiptSig,
    source: sourceView(sourceById.get(f.sourceId)!),
    trades: views.filter((_, i) => trades[i].filingId === f.id),
    mirrors: mirrorsBy.get(f.id) ?? 0,
  }))
}

/** Filings Claude has read, newest first. */
export async function latestFilings(limit = 20) {
  const filings = await db.query.filings.findMany({
    where: inArray(schema.filings.status, ["parsed", "receipted"]),
    orderBy: desc(schema.filings.filedAt),
    limit,
  })
  return filingViews(filings)
}

export type LeaderRow = SourceView & {
  filings: number
  trades: number
  mirrorable: number
  lastFiledAt: string | null
  /** Mean move of tokenized buys from disclosure day to now: what a copier would have made. */
  copyReturn: number | null
  /** Mean move from trade day to disclosure day: what the filing delay cost a copier. */
  lagCost: number | null
  followers: number
}

export async function leaderboard(): Promise<LeaderRow[]> {
  const [sources, filings, trades, follows] = await Promise.all([
    db.query.sources.findMany(),
    db.query.filings.findMany({ where: inArray(schema.filings.status, ["parsed", "receipted"]) }),
    db.query.trades.findMany(),
    db.query.follows.findMany({ where: eq(schema.follows.active, true) }),
  ])
  const prices = await livePrices(trades.filter((t) => t.tokenSymbol && t.ticker).map((t) => t.ticker!))
  const rows: LeaderRow[] = []
  for (const s of sources) {
    const fs = filings.filter((f) => f.sourceId === s.id)
    if (!fs.length) continue
    const ts = trades.filter((t) => t.sourceId === s.id)
    const buys = ts.filter((t) => t.side === "buy" && t.tokenSymbol && t.ticker)
    const copy = buys
      .map((t) => {
        const now = prices.get(t.ticker!)?.price
        return now && t.pxDisclosed ? now / t.pxDisclosed - 1 : null
      })
      .filter((x): x is number => x != null)
    const lag = buys
      .map((t) => (t.pxTraded && t.pxDisclosed ? t.pxDisclosed / t.pxTraded - 1 : null))
      .filter((x): x is number => x != null)
    rows.push({
      ...sourceView(s),
      filings: fs.length,
      trades: ts.length,
      mirrorable: ts.filter((t) => t.tokenSymbol).length,
      lastFiledAt: fs.reduce<Date | null>((m, f) => (!m || f.filedAt > m ? f.filedAt : m), null)?.toISOString() ?? null,
      copyReturn: copy.length ? copy.reduce((a, b) => a + b, 0) / copy.length : null,
      lagCost: lag.length ? lag.reduce((a, b) => a + b, 0) / lag.length : null,
      followers: follows.filter((f) => f.sourceId === s.id).length,
    })
  }
  return rows.sort((a, b) => b.mirrorable - a.mirrorable || (b.lastFiledAt ?? "").localeCompare(a.lastFiledAt ?? ""))
}

export async function sourceProfile(slug: string) {
  const s = await db.query.sources.findFirst({ where: eq(schema.sources.slug, slug) })
  if (!s) return null
  const filings = await db.query.filings.findMany({
    where: and(eq(schema.filings.sourceId, s.id), inArray(schema.filings.status, ["parsed", "receipted"])),
    orderBy: desc(schema.filings.filedAt),
  })
  const followers = await db.$count(schema.follows, and(eq(schema.follows.sourceId, s.id), eq(schema.follows.active, true)))
  return { source: sourceView(s), filings: await filingViews(filings), followers }
}

export type ExecutionView = {
  id: number
  wallet: string
  side: "buy" | "sell"
  tokenSymbol: string
  usdcAmount: number | null
  tokenAmount: number | null
  fillPx: number | null
  sig: string | null
  status: string
  reason: string | null
  createdAt: string
  sourceName: string
  sourceSlug: string
  docId: string
  receiptSig: string | null
}

async function executionViews(rows: schema.Execution[]): Promise<ExecutionView[]> {
  if (!rows.length) return []
  const trades = await db.query.trades.findMany({ where: inArray(schema.trades.id, [...new Set(rows.map((r) => r.tradeId))]) })
  const tradeById = new Map(trades.map((t) => [t.id, t]))
  const [filings, sources] = await Promise.all([
    db.query.filings.findMany({ where: inArray(schema.filings.id, [...new Set(trades.map((t) => t.filingId))]) }),
    db.query.sources.findMany({ where: inArray(schema.sources.id, [...new Set(trades.map((t) => t.sourceId))]) }),
  ])
  const filingById = new Map(filings.map((f) => [f.id, f]))
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  return rows.map((r) => {
    const t = tradeById.get(r.tradeId)!
    const f = filingById.get(t.filingId)!
    const s = sourceById.get(t.sourceId)!
    return {
      id: r.id,
      wallet: r.wallet,
      side: r.side,
      tokenSymbol: r.tokenSymbol,
      usdcAmount: r.usdcAmount,
      tokenAmount: r.tokenAmount,
      fillPx: r.fillPx,
      sig: r.sig,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      sourceName: s.name,
      sourceSlug: s.slug,
      docId: f.docId,
      receiptSig: f.receiptSig,
    }
  })
}

/** Public log: every receipt and every fill, newest first. */
export async function receiptsLog(limit = 50) {
  const [filings, executions] = await Promise.all([
    db.query.filings.findMany({ where: isNotNull(schema.filings.receiptSig), orderBy: desc(schema.filings.filedAt), limit }),
    db.query.executions.findMany({ orderBy: desc(schema.executions.createdAt), limit }),
  ])
  return { filings: await filingViews(filings), executions: await executionViews(executions) }
}

export async function walletState(wallet: string) {
  const follows = await db.query.follows.findMany({ where: eq(schema.follows.wallet, wallet) })
  const sources = follows.length
    ? await db.query.sources.findMany({ where: inArray(schema.sources.id, follows.map((f) => f.sourceId)) })
    : []
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const executions = await db.query.executions.findMany({
    where: eq(schema.executions.wallet, wallet),
    orderBy: desc(schema.executions.createdAt),
    limit: 100,
  })
  return {
    follows: follows.map((f) => ({
      id: f.id,
      perTradeUsd: f.perTradeUsd,
      autoSell: f.autoSell,
      active: f.active,
      createdAt: f.createdAt.toISOString(),
      source: sourceView(sourceById.get(f.sourceId)!),
    })),
    executions: await executionViews(executions),
  }
}

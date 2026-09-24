/**
 * The /demo engine. Each run creates a fresh follower wallet and walks one scenario end to end
 * with real devnet transactions: test USDC, a gasless follow, mirrored buys, the sell permission
 * and the exit. Filings are real; prices are the stock's real daily closes from the disclosure
 * date on, replayed one trading day per tick so a month of market plays out in seconds.
 */
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
} from "@solana/kit"
import { and, desc, eq, isNotNull } from "drizzle-orm"
import { db, schema } from "./db"
import { closePosition, openPosition, recordExecution } from "./pipeline"
import { dailyCloses, type DailyClose } from "./prices"
import { tokenBySymbol } from "./registry"
import {
  buildApproveTx,
  buildStockApproveTx,
  confirm,
  cosignAndSend,
  faucet,
  fillBuy,
  fillSell,
  stockMint,
  usdcAllowance,
} from "./solana/agent"

export type ScenarioKey = "reported_sale" | "trailing_stop" | "time_limit" | "budget"

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped"

export type DemoStep = {
  key: string
  title: string
  detail?: string
  status: StepStatus
  sig?: string
  /** A non-transaction link, e.g. the filing PDF. */
  href?: string
  hrefLabel?: string
  at?: string
}

/** `after` marks closes plotted once the position was sold, to show what the exit avoided. */
export type DemoPoint = { date: string; price: number; stop: number | null; after?: boolean }
export type DemoMarker = { date: string; price: number; kind: "buy" | "sell"; label: string }

export type DemoRun = {
  id: string
  scenario: ScenarioKey
  status: "running" | "done" | "failed"
  startedAt: string
  wallet?: string
  source?: { slug: string; name: string; kind: string; seat: string | null; affiliation: string | null; photoUrl: string | null }
  ticker?: string
  tokenSymbol?: string
  rules?: { perTradeUsd: number; budgetUsd: number; trailingStopPct: number | null; maxHoldDays: number | null }
  steps: DemoStep[]
  series: DemoPoint[]
  markers: DemoMarker[]
  summary?: { lines: string[]; pnlUsd?: number; pnlPct?: number }
  error?: string
}

type Plan = {
  source: schema.Source
  buyFiling: schema.Filing
  buys: schema.Trade[]
  sellFiling?: schema.Filing
  sell?: schema.Trade
  closes?: DailyClose[]
}

export type ScenarioInfo = {
  key: ScenarioKey
  title: string
  summary: string
  available: boolean
  source?: DemoRun["source"]
  ticker?: string
  setup?: string
}

type DemoState = {
  runs: Map<string, DemoRun>
  active: string | null
  plans?: { at: number; plans: Partial<Record<ScenarioKey, Plan>> }
}
const g = globalThis as unknown as { coattailsDemo?: DemoState }
const state: DemoState = (g.coattailsDemo ??= { runs: new Map(), active: null })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TICK_MS = 450

function sourceInfo(s: schema.Source): NonNullable<DemoRun["source"]> {
  return { slug: s.slug, name: s.name, kind: s.kind, seat: s.seat, affiliation: s.affiliation, photoUrl: s.photoUrl }
}

// ---------------------------------------------------------------------------------------------
// Choosing real data for each scenario

async function tokenizedBuys() {
  const rows = await db
    .select({ trade: schema.trades, filing: schema.filings, source: schema.sources })
    .from(schema.trades)
    .innerJoin(schema.filings, eq(schema.filings.id, schema.trades.filingId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.trades.sourceId))
    .where(and(eq(schema.trades.side, "buy"), isNotNull(schema.trades.tokenSymbol), isNotNull(schema.filings.receiptSig)))
    .orderBy(desc(schema.filings.filedAt))
  // House members first: they are who people come to copy.
  return rows.sort((a, b) => Number(b.source.kind === "house") - Number(a.source.kind === "house"))
}

function stopTriggerIndex(closes: DailyClose[], pct: number) {
  let peak = closes[0]?.close ?? 0
  for (let i = 1; i < closes.length; i++) {
    peak = Math.max(peak, closes[i].close)
    if (closes[i].close <= peak * (1 - pct)) return i
  }
  return -1
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

async function findPlans(): Promise<Partial<Record<ScenarioKey, Plan>>> {
  const plans: Partial<Record<ScenarioKey, Plan>> = {}
  const buys = await tokenizedBuys()

  // Reported sale: a tokenized buy and a later reported sale of the same stock by the same person.
  // Prefer the sale on a later filing; fall back to a sale on the same report.
  const sells = await db
    .select({ trade: schema.trades, filing: schema.filings })
    .from(schema.trades)
    .innerJoin(schema.filings, eq(schema.filings.id, schema.trades.filingId))
    .where(and(eq(schema.trades.side, "sell"), isNotNull(schema.trades.tokenSymbol), isNotNull(schema.filings.receiptSig)))
  let best: { plan: Plan; score: number } | null = null
  for (const b of buys) {
    for (const s of sells) {
      if (s.trade.sourceId !== b.trade.sourceId || s.trade.tokenSymbol !== b.trade.tokenSymbol) continue
      if (s.filing.filedAt < b.filing.filedAt) continue
      const score = (s.filing.id !== b.filing.id ? 10 : 0) + (b.source.kind === "house" ? 5 : 0)
      if (!best || score > best.score) {
        best = { plan: { source: b.source, buyFiling: b.filing, buys: [b.trade], sellFiling: s.filing, sell: s.trade }, score }
      }
    }
  }
  if (best) plans.reported_sale = best.plan

  // Trailing stop and time limit: replay real closes after a disclosed buy.
  // For the stop, prefer a case where the stock kept falling after the stop sold: the exit a
  // follower would be glad of. Any case where the stop fires is the fallback.
  const seen = new Set<string>()
  let stopBest: { plan: Plan; saved: number } | null = null
  for (const b of buys.slice(0, 30)) {
    const key = `${b.source.id}:${b.trade.ticker}`
    if (seen.has(key) || !b.trade.ticker) continue
    seen.add(key)
    let closes: DailyClose[]
    try {
      closes = await dailyCloses(b.trade.ticker, b.filing.filedAt)
    } catch {
      continue
    }
    if (closes.length < 5) continue
    const hit = stopTriggerIndex(closes, 0.1)
    if (hit > 0) {
      // How much further the stock fell after the stop sold: the drop the follower avoided.
      const after = closes.slice(hit + 1).map((c) => c.close)
      const saved = after.length ? 1 - Math.min(...after) / closes[hit].close : 0
      if (!stopBest || saved > stopBest.saved) stopBest = { plan: { source: b.source, buyFiling: b.filing, buys: [b.trade], closes }, saved }
    } else if (!plans.time_limit && daysBetween(closes[0].date, closes.at(-1)!.date) >= 30) {
      plans.time_limit = { source: b.source, buyFiling: b.filing, buys: [b.trade], closes }
    }
  }
  if (stopBest) plans.trailing_stop = stopBest.plan

  // Budget: one filing with several tokenized buys of different stocks.
  const byFiling = new Map<number, typeof buys>()
  for (const b of buys) byFiling.set(b.filing.id, [...(byFiling.get(b.filing.id) ?? []), b])
  for (const rows of byFiling.values()) {
    const distinct = [...new Map(rows.map((r) => [r.trade.tokenSymbol, r])).values()]
    if (distinct.length >= 3) {
      plans.budget = { source: distinct[0].source, buyFiling: distinct[0].filing, buys: distinct.slice(0, 4).map((r) => r.trade) }
      break
    }
  }
  return plans
}

async function getPlans() {
  if (!state.plans || Date.now() - state.plans.at > 10 * 60_000) {
    state.plans = { at: Date.now(), plans: await findPlans() }
  }
  return state.plans.plans
}

const TITLES: Record<ScenarioKey, { title: string; summary: string }> = {
  reported_sale: {
    title: "The member reports a sale",
    summary: "You copy a purchase. When a later report shows the member sold the same stock, Coattails sells your position.",
  },
  trailing_stop: {
    title: "The price drops",
    summary: "You copy a purchase with a 10% trailing stop. The stock's real closes play back until it falls through the stop, and Coattails sells.",
  },
  time_limit: {
    title: "The time limit runs out",
    summary: "You copy a purchase with a 30-day limit and no stop. No sale is reported, so Coattails sells on day 30.",
  },
  budget: {
    title: "The budget runs out",
    summary: "One report lists several purchases. You approved $25 at $10 a trade, so Coattails buys until the budget is spent and skips the rest.",
  },
}

export async function scenarios(): Promise<ScenarioInfo[]> {
  const plans = await getPlans()
  return (Object.keys(TITLES) as ScenarioKey[]).map((key) => {
    const p = plans[key]
    return {
      key,
      ...TITLES[key],
      available: !!p,
      source: p ? sourceInfo(p.source) : undefined,
      ticker: p?.buys[0]?.ticker ?? undefined,
      setup: p
        ? key === "budget"
          ? `${p.source.name}, report of ${p.buyFiling.filedAt.toISOString().slice(0, 10)}: ${p.buys.map((b) => b.ticker).join(", ")}`
          : `${p.source.name} bought ${p.buys[0].ticker}, reported ${p.buyFiling.filedAt.toISOString().slice(0, 10)}`
        : undefined,
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Running

function newRun(scenario: ScenarioKey): DemoRun {
  const run: DemoRun = {
    id: crypto.randomUUID(),
    scenario,
    status: "running",
    startedAt: new Date().toISOString(),
    steps: [],
    series: [],
    markers: [],
  }
  state.runs.set(run.id, run)
  // Keep the last 20 runs.
  for (const id of [...state.runs.keys()].slice(0, Math.max(0, state.runs.size - 20))) state.runs.delete(id)
  return run
}

async function step<T>(run: DemoRun, key: string, title: string, fn: (s: DemoStep) => Promise<T>): Promise<T> {
  const s: DemoStep = { key, title, status: "running", at: new Date().toISOString() }
  run.steps.push(s)
  try {
    const out = await fn(s)
    if (s.status === "running") s.status = "done"
    return out
  } catch (err) {
    s.status = "failed"
    s.detail = err instanceof Error ? err.message : String(err)
    throw err
  }
}

/** Signs a server-built transaction as the demo follower, then Coattails co-signs and sends it. */
async function signAsFollower(follower: KeyPairSigner, wire: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
  const signed = await partiallySignTransaction([follower.keyPair], tx)
  const sig = await cosignAndSend(follower.address, getBase64EncodedWireTransaction(signed))
  await confirm(sig)
  return sig
}

async function prelude(run: DemoRun, plan: Plan, rules: NonNullable<DemoRun["rules"]>) {
  run.source = sourceInfo(plan.source)
  run.rules = rules
  const follower = await step(run, "wallet", "Create a follower wallet", async (s) => {
    const signer = await generateKeyPairSigner()
    run.wallet = signer.address
    s.detail = `A brand-new Solana wallet with no SOL. It stands in for you.`
    return signer
  })
  await step(run, "faucet", "Get 100 test USDC", async (s) => {
    s.sig = await faucet(follower.address, 100)
    await confirm(s.sig)
    s.detail = "Devnet USDC from the Coattails faucet."
  })
  const follow = await step(run, "follow", `Mirror ${plan.source.name}`, async (s) => {
    const wire = await buildApproveTx(follower.address, rules.budgetUsd, `coattails:v1|demo|follow|${plan.source.slug}|${rules.perTradeUsd}`)
    s.sig = await signAsFollower(follower, wire)
    const parts = [`$${rules.perTradeUsd} per trade`, `$${rules.budgetUsd} budget`]
    parts.push(rules.trailingStopPct ? `${Math.round(rules.trailingStopPct * 100)}% trailing stop` : "no trailing stop")
    parts.push(rules.maxHoldDays ? `${rules.maxHoldDays}-day limit` : "no time limit")
    s.detail = `One signature approves the budget: ${parts.join(", ")}. Coattails paid the fee.`
    const [row] = await db
      .insert(schema.follows)
      .values({
        wallet: follower.address,
        sourceId: plan.source.id,
        perTradeUsd: rules.perTradeUsd,
        trailingStopPct: rules.trailingStopPct,
        maxHoldDays: rules.maxHoldDays,
        approveSig: s.sig,
        demo: true,
        active: true,
        createdAt: new Date(),
      })
      .returning()
    return row
  })
  return { follower, follow }
}

async function filingStep(run: DemoRun, key: string, filing: schema.Filing, trades: schema.Trade[], lead: string) {
  await step(run, key, lead, async (s) => {
    const all = await db.query.trades.findMany({ where: eq(schema.trades.filingId, filing.id) })
    const tokenized = all.filter((t) => t.tokenSymbol).length
    s.detail = `${filing.kind === "form4" ? "SEC Form 4" : `PTR ${filing.docId}`}, filed ${filing.filedAt.toISOString().slice(0, 10)}. ${all.length} trades read, ${tokenized} in tokenized stocks. Copying: ${trades.map((t) => `${t.side} ${t.ticker}`).join(", ")}.`
    s.href = filing.url
    s.hrefLabel = "Filing"
    s.sig = filing.receiptSig ?? undefined
  })
}

async function buyStep(run: DemoRun, ctx: { follower: KeyPairSigner; follow: schema.Follow }, filing: schema.Filing, trade: schema.Trade, price: number, date: string) {
  const token = tokenBySymbol(trade.tokenSymbol!)!
  const stock = await stockMint(token.symbol, token.name, token.mint)
  return step(run, `buy-${trade.id}`, `Buy ${token.symbol}`, async (s) => {
    const { allowance, balance } = await usdcAllowance(ctx.follower.address)
    const usd = Math.min(ctx.follow.perTradeUsd, allowance, balance)
    if (usd < 1) {
      s.status = "skipped"
      s.detail = `Skipped: the $${run.rules!.budgetUsd} budget is used up. Coattails cannot spend more than you approved.`
      await recordExecution({ tradeId: trade.id, followId: ctx.follow.id, wallet: ctx.follow.wallet, side: "buy", tokenSymbol: token.symbol, pythPx: price, status: "rejected", reason: "Budget used up", createdAt: new Date() })
      return null
    }
    const memo = `coattails:v1|demo|fill|${filing.docId}|buy|${token.symbol}|px:${price.toFixed(4)}|close:${date}|receipt:${filing.receiptSig}`
    const fill = await fillBuy({ owner: ctx.follower.address, usd, price, stock, memo })
    s.sig = fill.sig
    s.detail = `$${usd.toFixed(2)} of USDC bought ${fill.tokens.toFixed(6)} ${token.symbol} at $${price.toFixed(2)}, the ${date} close. The stock went straight to the follower's wallet.${usd < ctx.follow.perTradeUsd ? ` Only $${usd.toFixed(2)} of the budget was left.` : ""}`
    await recordExecution({ tradeId: trade.id, followId: ctx.follow.id, wallet: ctx.follow.wallet, side: "buy", tokenSymbol: token.symbol, usdcAmount: fill.usdc, tokenAmount: fill.tokens, pythPx: price, fillPx: price, sig: fill.sig, status: "confirmed", createdAt: new Date() })
    await openPosition({ follow: ctx.follow, trade, symbol: token.symbol, tokens: fill.tokens, usd: fill.usdc, price })
    run.markers.push({ date, price, kind: "buy", label: `Bought at $${price.toFixed(2)}` })
    return { fill, stock, token }
  })
}

async function allowSellStep(run: DemoRun, follower: KeyPairSigner, stock: Address, symbol: string) {
  await step(run, "allow-sell", `Allow selling ${symbol}`, async (s) => {
    const wire = await buildStockApproveTx(follower.address, [{ mint: stock }])
    s.sig = await signAsFollower(follower, wire)
    s.detail = `One more signature lets Coattails sell this stock for the follower, and nothing else. Coattails paid the fee.`
  })
}

async function sellStep(
  run: DemoRun,
  ctx: { follower: KeyPairSigner; follow: schema.Follow },
  symbol: string,
  stock: Address,
  price: number,
  date: string,
  reason: "member_sold" | "trailing_stop" | "max_hold",
  why: string,
  memoTag: string,
) {
  return step(run, "sell", `Sell ${symbol}`, async (s) => {
    const position = await db.query.positions.findFirst({
      where: and(eq(schema.positions.followId, ctx.follow.id), eq(schema.positions.tokenSymbol, symbol), eq(schema.positions.status, "open")),
    })
    if (!position) throw new Error("No open position to sell")
    const memo = `coattails:v1|demo|exit|${memoTag}|${symbol}|px:${price.toFixed(4)}|close:${date}`
    const fill = await fillSell({ owner: ctx.follower.address, tokens: position.tokens, price, stock, memo })
    s.sig = fill.sig
    const pnl = fill.usdc - position.costUsd
    s.detail = `${why} Sold ${position.tokens.toFixed(6)} ${symbol} at $${price.toFixed(2)} for $${fill.usdc.toFixed(2)} of USDC.`
    await recordExecution({ tradeId: position.tradeId, followId: ctx.follow.id, wallet: ctx.follow.wallet, side: "sell", tokenSymbol: symbol, usdcAmount: fill.usdc, tokenAmount: fill.tokens, pythPx: price, fillPx: price, sig: fill.sig, status: "confirmed", reason: why, createdAt: new Date() })
    await closePosition(position, reason, price, fill.sig)
    run.markers.push({ date, price, kind: "sell", label: `Sold at $${price.toFixed(2)}` })
    return { pnl, pct: pnl / position.costUsd, cost: position.costUsd, proceeds: fill.usdc }
  })
}

/** Plays daily closes into the run's chart; returns the index where `exit` fires, or -1. */
async function replay(run: DemoRun, closes: DailyClose[], stopPct: number | null, exit: (i: number, peak: number) => boolean) {
  let peak = closes[0].close
  for (let i = 0; i < closes.length; i++) {
    peak = Math.max(peak, closes[i].close)
    run.series.push({ date: closes[i].date, price: closes[i].close, stop: stopPct ? peak * (1 - stopPct) : null })
    if (i > 0 && exit(i, peak)) return i
    await sleep(TICK_MS)
  }
  return -1
}

/** After an exit, keep plotting the real closes (quickly and marked `after`) up to today. */
async function playAfter(run: DemoRun, closes: DailyClose[], from: number) {
  for (let i = from + 1; i < closes.length; i++) {
    run.series.push({ date: closes[i].date, price: closes[i].close, stop: null, after: true })
    await sleep(TICK_MS / 3)
  }
}

async function runReportedSale(run: DemoRun, plan: Plan) {
  const rules = { perTradeUsd: 10, budgetUsd: 50, trailingStopPct: null, maxHoldDays: null }
  const ctx = await prelude(run, plan, rules)
  const buy = plan.buys[0]
  const sell = plan.sell!
  const sellFiling = plan.sellFiling!
  run.ticker = buy.ticker!
  run.tokenSymbol = buy.tokenSymbol!
  const closes = await dailyCloses(buy.ticker!, plan.buyFiling.filedAt, sellFiling.filedAt)
  if (!closes.length) throw new Error("No price history for this stock")

  await filingStep(run, "filing-buy", plan.buyFiling, [buy], `${plan.source.name} reports a purchase`)
  const bought = await buyStep(run, ctx, plan.buyFiling, buy, closes[0].close, closes[0].date)
  if (!bought) throw new Error("The buy was skipped")
  await allowSellStep(run, ctx.follower, bought.stock, bought.token.symbol)
  await step(run, "hold", "Hold until the next report", async (s) => {
    await replay(run, closes, null, () => false)
    s.detail =
      sellFiling.id === plan.buyFiling.id
        ? "The same report also lists a sale of this stock, so Coattails sells right after buying."
        : `No exit rule is set, so the position is held until ${plan.source.name} reports a sale.`
  })
  await filingStep(run, "filing-sell", sellFiling, [sell], `${plan.source.name} reports a sale`)
  const last = closes.at(-1)!
  const out = await sellStep(run, ctx, bought.token.symbol, bought.stock, last.close, last.date, "member_sold", `${plan.source.name} reported selling ${buy.ticker}.`, "member_sold")
  run.summary = {
    pnlUsd: out.pnl,
    pnlPct: out.pct,
    lines: [
      `Bought $${out.cost.toFixed(2)} of ${bought.token.symbol} on ${closes[0].date}, sold on ${last.date} after the reported sale.`,
      `Result: ${out.pnl >= 0 ? "+" : "-"}$${Math.abs(out.pnl).toFixed(2)} (${(out.pct * 100).toFixed(1)}%).`,
    ],
  }
}

async function runTrailingStop(run: DemoRun, plan: Plan) {
  const rules = { perTradeUsd: 10, budgetUsd: 50, trailingStopPct: 0.1, maxHoldDays: null }
  const ctx = await prelude(run, plan, rules)
  const buy = plan.buys[0]
  const closes = plan.closes!
  run.ticker = buy.ticker!
  run.tokenSymbol = buy.tokenSymbol!
  await filingStep(run, "filing-buy", plan.buyFiling, [buy], `${plan.source.name} reports a purchase`)
  const bought = await buyStep(run, ctx, plan.buyFiling, buy, closes[0].close, closes[0].date)
  if (!bought) throw new Error("The buy was skipped")
  await allowSellStep(run, ctx.follower, bought.stock, bought.token.symbol)
  let hit = -1
  let peakAtHit = 0
  await step(run, "watch", `Watch ${buy.ticker} every day`, async (s) => {
    s.detail = `Replaying ${buy.ticker}'s real daily closes from ${closes[0].date}. The stop trails 10% under the highest close.`
    hit = await replay(run, closes, 0.1, (i, peak) => {
      peakAtHit = peak
      return closes[i].close <= peak * 0.9
    })
    if (hit < 0) throw new Error("The stop never triggered in the available history")
    s.detail = `The high was $${peakAtHit.toFixed(2)}. On ${closes[hit].date} ${buy.ticker} closed at $${closes[hit].close.toFixed(2)}, ${(((peakAtHit - closes[hit].close) / peakAtHit) * 100).toFixed(1)}% below it.`
  })
  const exitPx = closes[hit].close
  const out = await sellStep(run, ctx, bought.token.symbol, bought.stock, exitPx, closes[hit].date, "trailing_stop", "The trailing stop fired.", "trailing_stop")
  await playAfter(run, closes, hit)
  const today = closes.at(-1)!
  const heldPct = today.close / closes[0].close - 1
  const rest = closes.slice(hit + 1)
  const low = rest.length ? rest.reduce((m, c) => (c.close < m.close ? c : m)) : null
  run.summary = {
    pnlUsd: out.pnl,
    pnlPct: out.pct,
    lines: [
      `Sold on ${closes[hit].date} for ${out.pnl >= 0 ? "+" : "-"}$${Math.abs(out.pnl).toFixed(2)} (${(out.pct * 100).toFixed(1)}%), without waiting for a report.`,
      ...(low && low.close < exitPx
        ? [`After the sale ${buy.ticker} fell as low as $${low.close.toFixed(2)} on ${low.date}, ${(((exitPx - low.close) / exitPx) * 100).toFixed(1)}% under the exit.`]
        : []),
      `Holding to ${today.date} instead would have returned ${(heldPct * 100).toFixed(1)}%.`,
    ],
  }
}

async function runTimeLimit(run: DemoRun, plan: Plan) {
  const rules = { perTradeUsd: 10, budgetUsd: 50, trailingStopPct: null, maxHoldDays: 30 }
  const ctx = await prelude(run, plan, rules)
  const buy = plan.buys[0]
  const closes = plan.closes!
  run.ticker = buy.ticker!
  run.tokenSymbol = buy.tokenSymbol!
  await filingStep(run, "filing-buy", plan.buyFiling, [buy], `${plan.source.name} reports a purchase`)
  const bought = await buyStep(run, ctx, plan.buyFiling, buy, closes[0].close, closes[0].date)
  if (!bought) throw new Error("The buy was skipped")
  await allowSellStep(run, ctx.follower, bought.stock, bought.token.symbol)
  let hit = -1
  await step(run, "watch", "Count down 30 days", async (s) => {
    s.detail = `Replaying ${buy.ticker}'s real daily closes from ${closes[0].date}. No sale has been reported.`
    hit = await replay(run, closes, null, (i) => daysBetween(closes[0].date, closes[i].date) >= 30)
    if (hit < 0) throw new Error("Not enough history for a 30-day hold")
    s.detail = `${closes[hit].date} is 30 days after the purchase and no sale was reported.`
  })
  const out = await sellStep(run, ctx, bought.token.symbol, bought.stock, closes[hit].close, closes[hit].date, "max_hold", "The 30-day limit was reached.", "max_hold")
  await playAfter(run, closes, hit)
  run.summary = {
    pnlUsd: out.pnl,
    pnlPct: out.pct,
    lines: [
      `Held ${bought.token.symbol} from ${closes[0].date} to ${closes[hit].date}.`,
      `Result: ${out.pnl >= 0 ? "+" : "-"}$${Math.abs(out.pnl).toFixed(2)} (${(out.pct * 100).toFixed(1)}%).`,
    ],
  }
}

async function runBudget(run: DemoRun, plan: Plan) {
  const rules = { perTradeUsd: 10, budgetUsd: 25, trailingStopPct: 0.15, maxHoldDays: 90 }
  const ctx = await prelude(run, plan, rules)
  run.ticker = plan.buys[0].ticker!
  run.tokenSymbol = plan.buys[0].tokenSymbol!
  await filingStep(run, "filing-buy", plan.buyFiling, plan.buys, `${plan.source.name} reports ${plan.buys.length} purchases`)
  const date = plan.buyFiling.filedAt
  let spent = 0
  let skipped = 0
  for (const t of plan.buys) {
    const closes = await dailyCloses(t.ticker!, date, new Date(date.getTime() + 5 * 86_400_000))
    if (!closes.length) continue
    const r = await buyStep(run, ctx, plan.buyFiling, t, closes[0].close, closes[0].date)
    if (r) spent += r.fill.usdc
    else skipped++
  }
  const { allowance } = await usdcAllowance(ctx.follower.address)
  run.summary = {
    lines: [
      `Spent $${spent.toFixed(2)} of the $${rules.budgetUsd} budget; $${allowance.toFixed(2)} left.`,
      skipped ? `${skipped} purchase${skipped === 1 ? " was" : "s were"} skipped because the budget was used up.` : "Every purchase fit in the budget.",
    ],
  }
}

export async function startRun(scenario: ScenarioKey): Promise<{ run: DemoRun; joined: boolean }> {
  if (state.active) {
    const active = state.runs.get(state.active)
    if (active?.status === "running") return { run: active, joined: true }
  }
  const plans = await getPlans()
  const plan = plans[scenario]
  if (!plan) throw new Error("No filing in the data fits this scenario yet")
  const run = newRun(scenario)
  state.active = run.id
  const runner = { reported_sale: runReportedSale, trailing_stop: runTrailingStop, time_limit: runTimeLimit, budget: runBudget }[scenario]
  runner(run, plan)
    .then(() => {
      run.status = "done"
    })
    .catch((err) => {
      run.status = "failed"
      run.error = err instanceof Error ? err.message : String(err)
    })
    .finally(() => {
      if (state.active === run.id) state.active = null
    })
  return { run, joined: false }
}

export function getRun(id: string) {
  return state.runs.get(id) ?? null
}

export function activeRun() {
  return state.active ? (state.runs.get(state.active) ?? null) : null
}

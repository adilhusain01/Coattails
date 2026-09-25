/**
 * Prices. Pyth is the source of truth when PYTH_API_KEY is set (Hermes for live, Benchmarks for
 * history). Without a key, live prices come from Jupiter's price API and history from Yahoo's
 * chart API, and every quote says which source it came from.
 */
import { tokenForTicker } from "./registry"

const HERMES = "https://hermes.pyth.network"
const PYTH_PRO_HISTORY = "https://pyth.dourolabs.app/v1"
const JUP = "https://api.jup.ag"

export type Quote = {
  /** USD per share of the underlying. */
  price: number
  /** Unix seconds of the observation. */
  publishTime: number
  source: "pyth:equity" | "pyth:xstock" | "jupiter"
  /** Pyth confidence interval, USD. */
  conf?: number
}

const pythKey = () => process.env.PYTH_API_KEY || null

/**
 * Equity feeds the Pyth plan grants, e.g. the Demo trial's TSLA,QQQ,VOO. Unset means "try every
 * ticker"; any feed Pyth refuses is remembered and not asked for again.
 */
const PYTH_EQUITIES = (process.env.PYTH_EQUITY_TICKERS ?? "")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean)
const deniedFeeds = new Set<string>()

export function pythCovers(ticker: string) {
  if (!pythKey()) return false
  return PYTH_EQUITIES.length === 0 || PYTH_EQUITIES.includes(ticker.toUpperCase())
}

function pythHeaders(): HeadersInit {
  const key = pythKey()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

// Feed lookup is keyless. Cache resolved IDs for the life of the process.
const feedIds = new Map<string, string | null>()

async function feedId(symbol: string, assetType: "equity" | "crypto"): Promise<string | null> {
  const key = `${assetType}:${symbol}`
  if (feedIds.has(key)) return feedIds.get(key)!
  const base = symbol.split("/")[0].split(".").pop()!
  const res = await fetch(`${HERMES}/v2/price_feeds?query=${encodeURIComponent(base)}&asset_type=${assetType}`)
  if (!res.ok) return null
  const feeds = (await res.json()) as { id: string; attributes: { symbol: string } }[]
  const id = feeds.find((f) => f.attributes.symbol === symbol)?.id ?? null
  feedIds.set(key, id)
  return id
}

type HermesParsed = { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }

async function hermesLatest(id: string) {
  if (deniedFeeds.has(id)) throw new Error("Pyth plan does not include this feed")
  const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${id}&parsed=true`, { headers: pythHeaders() })
  if (res.status === 401 || res.status === 403) deniedFeeds.add(id)
  if (!res.ok) throw new Error(`Hermes ${res.status}`)
  const body = (await res.json()) as { parsed: HermesParsed[] }
  const p = body.parsed[0].price
  const scale = 10 ** p.expo
  return { price: Number(p.price) * scale, conf: Number(p.conf) * scale, publishTime: p.publish_time }
}

/**
 * Live price of the underlying, in USD per share.
 * Equity feeds publish only during NYSE hours, so outside them the 24/7 xStock feed is used
 * (xStock price per token divided by its multiplier is the share-equivalent price).
 */
export async function livePrice(ticker: string): Promise<Quote> {
  const token = tokenForTicker(ticker)
  if (pythKey()) {
    // A key may not be entitled to every feed; any Pyth failure falls through to Jupiter.
    try {
      const now = Math.floor(Date.now() / 1000)
      const eqId = pythCovers(ticker) ? await feedId(`Equity.US.${ticker}/USD`, "equity") : null
      if (eqId) {
        const q = await hermesLatest(eqId).catch(() => null)
        if (q && now - q.publishTime < 120) return { ...q, source: "pyth:equity" }
      }
      if (token) {
        const xId = await feedId(`Crypto.${token.symbol.toUpperCase()}/USD`, "crypto")
        if (xId) {
          const q = await hermesLatest(xId)
          const m = token.multiplier || 1
          return { price: q.price / m, conf: q.conf / m, publishTime: q.publishTime, source: "pyth:xstock" }
        }
      }
    } catch {
      /* not entitled or unavailable */
    }
  }
  if (!token) throw new Error(`No price source for ${ticker}`)
  return jupiterPrice(token.mint)
}

async function jupiterPrice(mint: string): Promise<Quote> {
  const res = await fetch(`${JUP}/price/v3?ids=${mint}`)
  if (!res.ok) throw new Error(`Jupiter price ${res.status}`)
  const body = (await res.json()) as Record<
    string,
    { usdPrice: number; stockData?: { price: number; updatedAt: string } } | undefined
  >
  const row = body[mint]
  if (!row) throw new Error(`Jupiter has no price for ${mint}`)
  if (row.stockData) {
    return { price: row.stockData.price, publishTime: Math.floor(Date.parse(row.stockData.updatedAt) / 1000), source: "jupiter" }
  }
  return { price: row.usdPrice, publishTime: Math.floor(Date.now() / 1000), source: "jupiter" }
}

const cache = new Map<string, { quote: Quote; at: number }>()
const CACHE_MS = 30_000

/**
 * Live prices for many tickers in as few requests as possible (display only; the fill guard
 * calls livePrice). Pyth: one Hermes call across the 24/7 xStock feeds. Keyless: one Jupiter
 * call per 50 mints. Tickers with no price are left out.
 */
export async function livePrices(tickers: string[]) {
  const out = new Map<string, Quote>()
  const now = Date.now()
  const want: { ticker: string; mint: string; symbol: string; multiplier: number }[] = []
  for (const t of new Set(tickers)) {
    const hit = cache.get(t)
    if (hit && now - hit.at < CACHE_MS) {
      out.set(t, hit.quote)
      continue
    }
    const token = tokenForTicker(t)
    if (token) want.push({ ticker: t, mint: token.mint, symbol: token.symbol, multiplier: token.multiplier || 1 })
  }
  if (!want.length) return out

  const put = (ticker: string, quote: Quote) => {
    out.set(ticker, quote)
    cache.set(ticker, { quote, at: now })
  }

  // Pyth equity feeds for the tickers the plan covers; only fresh prints count (market hours).
  const covered = want.filter((w) => pythCovers(w.ticker) && PYTH_EQUITIES.length > 0)
  await Promise.all(
    covered.map(async (w) => {
      try {
        const id = await feedId(`Equity.US.${w.ticker}/USD`, "equity")
        if (!id) return
        const q = await hermesLatest(id)
        if (Date.now() / 1000 - q.publishTime < 120) put(w.ticker, { ...q, source: "pyth:equity" })
      } catch {
        /* not covered or not published right now */
      }
    }),
  )

  if (pythKey() && PYTH_EQUITIES.length === 0) {
    try {
      const ids = await Promise.all(want.map((w) => feedId(`Crypto.${w.symbol.toUpperCase()}/USD`, "crypto")))
      const pairs = want.map((w, i) => [w, ids[i]] as const).filter(([, id]) => id)
      if (pairs.length) {
        const q = pairs.map(([, id]) => `ids[]=${id}`).join("&")
        const res = await fetch(`${HERMES}/v2/updates/price/latest?${q}&parsed=true`, { headers: pythHeaders() })
        if (res.ok) {
          const body = (await res.json()) as { parsed: HermesParsed[] }
          const byId = new Map(body.parsed.map((p) => [p.id, p.price]))
          for (const [w, id] of pairs) {
            const p = byId.get(id!.replace(/^0x/, ""))
            if (!p) continue
            const scale = 10 ** p.expo
            put(w.ticker, {
              price: (Number(p.price) * scale) / w.multiplier,
              conf: (Number(p.conf) * scale) / w.multiplier,
              publishTime: p.publish_time,
              source: "pyth:xstock",
            })
          }
        }
      }
    } catch {
      /* fall through to Jupiter for anything missing */
    }
  }

  const missing = want.filter((w) => !out.has(w.ticker))
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50)
    try {
      const res = await fetch(`${JUP}/price/v3?ids=${chunk.map((c) => c.mint).join(",")}`)
      if (!res.ok) continue
      const body = (await res.json()) as Record<string, { usdPrice: number; stockData?: { price: number; updatedAt: string } } | undefined>
      for (const c of chunk) {
        const row = body[c.mint]
        if (!row) continue
        put(c.ticker, row.stockData
          ? { price: row.stockData.price, publishTime: Math.floor(Date.parse(row.stockData.updatedAt) / 1000), source: "jupiter" }
          : { price: row.usdPrice / c.multiplier, publishTime: Math.floor(now / 1000), source: "jupiter" })
      }
    } catch {
      /* leave these out */
    }
  }
  return out
}

/** Official close of the underlying on a date (the trade date or the disclosure date). */
export async function closeOn(ticker: string, date: Date): Promise<number | null> {
  // Look back five days so weekends and holidays resolve to the prior session.
  const pyth = await pythDailyCloses(ticker, new Date(date.getTime() - 5 * 86_400_000), date).catch(() => null)
  if (pyth?.length && pyth.at(-1)!.date >= new Date(date.getTime() - 5 * 86_400_000).toISOString().slice(0, 10)) {
    return pyth.at(-1)!.close
  }
  return yahooClose(ticker, date)
}

async function yahooClose(ticker: string, date: Date): Promise<number | null> {
  const day = new Date(date)
  day.setUTCHours(0, 0, 0, 0)
  // Look back up to 5 days so weekends and holidays resolve to the prior session.
  const from = Math.floor(day.getTime() / 1000) - 5 * 86400
  const to = Math.floor(day.getTime() / 1000) + 86400
  const symbol = ticker.replace(".", "-")
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${from}&period2=${to}&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0 (Coattails)" } },
  )
  if (!res.ok) return null
  const body = (await res.json()) as {
    chart: { result?: { timestamp?: number[]; indicators: { quote: { close: (number | null)[] }[] } }[] }
  }
  const r = body.chart.result?.[0]
  const closes = r?.indicators.quote[0]?.close ?? []
  for (let i = closes.length - 1; i >= 0; i--) if (closes[i] != null) return closes[i]
  return null
}

export type DailyClose = { date: string; close: number; source: "pyth" | "yahoo" }

/**
 * Daily candles from the Pyth Pro history API for tickers the plan covers, or null. The trial keeps
 * history from 2026-05-22, so a window that starts earlier comes back short and the caller uses Yahoo.
 */
async function pythDailyCloses(ticker: string, from: Date, to: Date): Promise<DailyClose[] | null> {
  if (!pythCovers(ticker) || PYTH_EQUITIES.length === 0) return null
  const qs = new URLSearchParams({
    symbol: `Equity.US.${ticker}/USD`,
    resolution: "D",
    from: String(Math.floor(from.getTime() / 1000) - 86_400),
    to: String(Math.floor(to.getTime() / 1000) + 86_400),
  })
  const res = await fetch(`${PYTH_PRO_HISTORY}/fixed_rate@200ms/history?${qs}`, { headers: pythHeaders() })
  if (!res.ok) return null
  const body = (await res.json()) as { s: string; t: number[]; c: number[] }
  if (body.s !== "ok") return null
  const toDay = to.toISOString().slice(0, 10)
  return body.t
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: body.c[i], source: "pyth" as const }))
    .filter((d) => d.date <= toDay)
}

/** Daily closes of the underlying from `from` to `to`, oldest first: Pyth Pro when it covers the whole window, else Yahoo. */
export async function dailyCloses(ticker: string, from: Date, to = new Date()): Promise<DailyClose[]> {
  const pyth = await pythDailyCloses(ticker, from, to).catch(() => null)
  const firstNeeded = new Date(from.getTime() + 4 * 86_400_000).toISOString().slice(0, 10)
  if (pyth?.length && pyth[0].date <= firstNeeded) return pyth.filter((d) => d.date >= from.toISOString().slice(0, 10))
  return yahooDailyCloses(ticker, from, to)
}

async function yahooDailyCloses(ticker: string, from: Date, to: Date): Promise<DailyClose[]> {
  const start = new Date(from)
  start.setUTCHours(0, 0, 0, 0)
  const p1 = Math.floor(start.getTime() / 1000)
  const p2 = Math.floor(to.getTime() / 1000) + 86400
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.replace(".", "-")}?period1=${p1}&period2=${p2}&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0 (Coattails)" } },
  )
  if (!res.ok) throw new Error(`Price history ${res.status} for ${ticker}`)
  const body = (await res.json()) as {
    chart: { result?: { timestamp?: number[]; indicators: { quote: { close: (number | null)[] }[] } }[] }
  }
  const r = body.chart.result?.[0]
  const ts = r?.timestamp ?? []
  const closes = r?.indicators.quote[0]?.close ?? []
  const out: DailyClose[] = []
  ts.forEach((t, i) => {
    const c = closes[i]
    if (c != null) out.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: c, source: "yahoo" })
  })
  return out
}

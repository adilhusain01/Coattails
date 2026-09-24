/**
 * Prices. Pyth is the source of truth when PYTH_API_KEY is set (Hermes for live, Benchmarks for
 * history). Without a key, live prices come from Jupiter's price API and history from Yahoo's
 * chart API, and every quote says which source it came from.
 */
import { tokenForTicker } from "./registry"

const HERMES = "https://hermes.pyth.network"
const BENCHMARKS = "https://benchmarks.pyth.network"
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
  const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${id}&parsed=true`, { headers: pythHeaders() })
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
    const now = Math.floor(Date.now() / 1000)
    const eqId = await feedId(`Equity.US.${ticker}/USD`, "equity")
    if (eqId) {
      const q = await hermesLatest(eqId)
      if (now - q.publishTime < 120) return { ...q, source: "pyth:equity" }
    }
    if (token) {
      const xId = await feedId(`Crypto.${token.symbol.toUpperCase()}/USD`, "crypto")
      if (xId) {
        const q = await hermesLatest(xId)
        const m = token.multiplier || 1
        return { price: q.price / m, conf: q.conf / m, publishTime: q.publishTime, source: "pyth:xstock" }
      }
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

  if (pythKey()) {
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
  if (pythKey()) {
    const id = await feedId(`Equity.US.${ticker}/USD`, "equity")
    if (id) {
      // 20:00 UTC is the 16:00 ET close (EDT); Benchmarks returns the last update at or before it.
      const close = new Date(date)
      close.setUTCHours(20, 0, 0, 0)
      const ts = Math.floor(close.getTime() / 1000)
      const res = await fetch(`${BENCHMARKS}/v1/updates/price/${ts}?ids=${id}&parsed=true`, { headers: pythHeaders() })
      if (res.ok) {
        const body = (await res.json()) as { parsed: HermesParsed[] }
        const p = body.parsed?.[0]?.price
        if (p) return Number(p.price) * 10 ** p.expo
      }
    }
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

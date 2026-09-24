import xstocks from "./data/xstocks.json"

export type StockToken = {
  /** Tokenized symbol, e.g. "NVDAx". */
  symbol: string
  /** US ticker of the underlying, e.g. "NVDA". */
  underlying: string
  name: string
  /** Mainnet mint. On devnet the stand-in mint is looked up by symbol in the devnet config. */
  mint: string
  decimals: number
  multiplier: number
}

type Row = (typeof xstocks)[number]

/** Share classes are written several ways on filings: BRK.B, BRK/B, BRK-B, BRKB. */
function normalize(ticker: string) {
  return ticker.trim().toUpperCase().replace(/[./\s]/g, "-")
}

const byTicker = new Map<string, StockToken>()
for (const row of xstocks as Row[]) {
  // House and SEC filings name US tickers; LSE and HKEX listings reuse the same letters.
  if (row.listingCountry !== "US" || row.isTradingHalted) continue
  const token: StockToken = {
    symbol: row.symbol,
    underlying: row.underlying.toUpperCase(),
    name: row.name.replace(/ xStock$/, ""),
    mint: row.mint,
    decimals: row.decimals,
    multiplier: row.multiplier,
  }
  byTicker.set(normalize(token.underlying), token)
}

export function tokenForTicker(ticker: string | null | undefined): StockToken | null {
  if (!ticker) return null
  const t = normalize(ticker)
  return byTicker.get(t) ?? byTicker.get(t.replace(/-/g, "")) ?? null
}

export function tokenBySymbol(symbol: string): StockToken | null {
  for (const token of byTicker.values()) if (token.symbol === symbol) return token
  return null
}

export function tokenCount() {
  return byTicker.size
}

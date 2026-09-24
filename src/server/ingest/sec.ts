/**
 * SEC Form 4: company insiders buying their own stock on the open market (transaction code P).
 * Filed within two business days of the trade, so it is the fast feed next to House PTRs.
 * Form 4 is structured XML, so no model is needed to read it.
 */
import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { XMLParser } from "fast-xml-parser"
import { db, schema } from "../db"
import { closeOn } from "../prices"
import { tokenForTicker } from "../registry"

const UA = process.env.SEC_USER_AGENT || "Coattails contact@example.com"

let lastRequest = 0
/** EDGAR allows 10 requests a second; stay well under it. */
async function sec(url: string) {
  const wait = lastRequest + 150 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequest = Date.now()
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } })
  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`)
  return res
}

let tickerByCik: Map<number, string> | null = null

async function cikTickers() {
  if (tickerByCik) return tickerByCik
  const res = await sec("https://www.sec.gov/files/company_tickers.json")
  const rows = Object.values((await res.json()) as Record<string, { cik_str: number; ticker: string }>)
  tickerByCik = new Map()
  // The file lists a company's primary ticker first; keep the first one seen.
  for (const r of rows) if (!tickerByCik.has(r.cik_str)) tickerByCik.set(r.cik_str, r.ticker)
  return tickerByCik
}

type Candidate = { accession: string; issuerCik: number; ticker: string; filedAt: Date }

/** Form 4 filings in a date range whose issuer has a tokenized stock on Solana. */
export async function form4Candidates(from: string, to: string): Promise<Candidate[]> {
  const tickers = await cikTickers()
  const out = new Map<string, Candidate>()
  for (let offset = 0; offset < 2000; offset += 100) {
    const res = await sec(
      `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=${from}&enddt=${to}&from=${offset}`,
    )
    const body = (await res.json()) as {
      hits: { total: { value: number }; hits: { _source: { adsh: string; ciks: string[]; file_date: string } }[] }
    }
    for (const h of body.hits.hits) {
      const s = h._source
      for (const c of s.ciks) {
        const cik = Number(c)
        const ticker = tickers.get(cik)
        if (ticker && tokenForTicker(ticker)) {
          out.set(s.adsh, { accession: s.adsh, issuerCik: cik, ticker, filedAt: new Date(`${s.file_date}T00:00:00Z`) })
          break
        }
      }
    }
    if (offset + 100 >= body.hits.total.value) break
  }
  return [...out.values()]
}

type Val<T = string> = { value?: T } | T | undefined
const v = (x: Val<string | number>) => (x && typeof x === "object" ? (x as { value?: string | number }).value : x)

type Form4 = {
  ownershipDocument: {
    issuer: { issuerTradingSymbol: string; issuerName: string }
    reportingOwner:
      | ReportingOwner
      | ReportingOwner[]
    aff10b5One?: string | number
    nonDerivativeTable?: { nonDerivativeTransaction?: NonDerivative | NonDerivative[] }
  }
}
type ReportingOwner = {
  reportingOwnerId: { rptOwnerName: string; rptOwnerCik: string | number }
  reportingOwnerRelationship: {
    isDirector?: string | number
    isOfficer?: string | number
    isTenPercentOwner?: string | number
    officerTitle?: string
  }
}
type NonDerivative = {
  transactionDate: Val
  transactionCoding: { transactionCode: string }
  transactionAmounts: {
    transactionShares: Val<number>
    transactionPricePerShare?: Val<number>
    transactionAcquiredDisposedCode: Val
  }
}

function truthy(x: unknown) {
  return x === 1 || x === "1" || x === "true" || x === true
}

/** "HUANG JEN HSUN" -> "Jen Hsun Huang": EDGAR writes names last-first in capitals. */
const ENTITY = /\b(LLC|L\.?P\.?|INC|CORP|FUND|TRUST|MANAGEMENT|CAPITAL|PARTNERS|HOLDINGS|GROUP|LTD|ADVISORS|INVESTMENTS?|CO|COMPANY|INSURANCE|BANK|ASSOCIATION|FOUNDATION|PARTNERSHIP|PLC|AG|SA|NV|LIFE)\b/i

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/^(llc|lp|l\.p\.|inc|ltd|ii|iii|iv|ceo|cfo|coo|cto|evp|svp)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
}

function personName(raw: string) {
  const parts = raw.trim().split(/\s+/)
  if (parts.length < 2 || ENTITY.test(raw)) return titleCase(raw)
  // "VON HEYNITZ HARALD": the particle belongs to the surname.
  const particle = /^(von|van|de|del|della|di|da|la|le|st\.?)$/i.test(parts[0]) ? 2 : 1
  const last = parts.slice(0, particle)
  const rest = parts.slice(particle)
  return titleCase([...rest, ...last].join(" "))
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Reads one Form 4. Stores it only if it contains an open-market purchase. */
export async function readForm4(c: Candidate) {
  const seen = await db.query.filings.findFirst({
    where: and(eq(schema.filings.kind, "form4"), eq(schema.filings.docId, c.accession)),
  })
  if (seen) return 0
  const skipKey = `form4:skip:${c.accession}`
  if (await db.query.kv.findFirst({ where: eq(schema.kv.key, skipKey) })) return 0

  const dir = `https://www.sec.gov/Archives/edgar/data/${c.issuerCik}/${c.accession.replace(/-/g, "")}`
  const index = (await (await sec(`${dir}/index.json`)).json()) as { directory: { item: { name: string }[] } }
  const xmlName = index.directory.item.map((i) => i.name).find((n) => n.endsWith(".xml") && !n.startsWith("xsl"))
  if (!xmlName) throw new Error(`No XML in ${c.accession}`)
  const xml = await (await sec(`${dir}/${xmlName}`)).text()
  const doc = (new XMLParser({ parseTagValue: true }).parse(xml) as Form4).ownershipDocument

  const rows = [doc.nonDerivativeTable?.nonDerivativeTransaction ?? []].flat()
  const buys = rows.filter(
    (r) => r.transactionCoding?.transactionCode === "P" && v(r.transactionAmounts.transactionAcquiredDisposedCode) === "A",
  )
  // Token purchases (a few shares) carry no signal; keep real open-market buys only.
  const MIN_VALUE = 10_000
  const value = (r: NonDerivative) =>
    Number(v(r.transactionAmounts.transactionShares) ?? 0) * Number(v(r.transactionAmounts.transactionPricePerShare) ?? 0)
  if (buys.reduce((a, b) => a + value(b), 0) < MIN_VALUE) buys.length = 0
  if (!buys.length) {
    await db.insert(schema.kv).values({ key: skipKey, value: "no open-market purchase" }).onConflictDoNothing()
    return 0
  }

  const owner = [doc.reportingOwner].flat()[0]
  const rel = owner.reportingOwnerRelationship
  const role = rel.officerTitle
    ? titleCase(String(rel.officerTitle))
    : truthy(rel.isDirector)
      ? "Director"
      : truthy(rel.isTenPercentOwner)
        ? "10% owner"
        : "Insider"
  const name = personName(String(owner.reportingOwnerId.rptOwnerName))
  const ticker = String(doc.issuer.issuerTradingSymbol || c.ticker).toUpperCase()
  const slug = slugify(`${name} ${ticker}`)

  let source = await db.query.sources.findFirst({ where: eq(schema.sources.slug, slug) })
  if (!source) {
    ;[source] = await db
      .insert(schema.sources)
      .values({ slug, kind: "insider", name, seat: ticker, affiliation: role, createdAt: new Date() })
      .returning()
  }

  const [filing] = await db
    .insert(schema.filings)
    .values({
      sourceId: source.id,
      kind: "form4",
      docId: c.accession,
      url: `${dir}/${c.accession}-index.htm`,
      sha256: createHash("sha256").update(xml).digest("hex"),
      filedAt: c.filedAt,
      status: "parsed",
      readBy: "xml",
      createdAt: new Date(),
    })
    .returning()

  const token = tokenForTicker(ticker)
  const pxDisclosed = token ? await closeOn(ticker, c.filedAt) : null
  const planned = truthy(doc.aff10b5One)
  await db.insert(schema.trades).values(
    buys.map((b) => {
      const shares = Number(v(b.transactionAmounts.transactionShares) ?? 0)
      const px = Number(v(b.transactionAmounts.transactionPricePerShare) ?? 0) || null
      const value = px ? shares * px : null
      return {
        filingId: filing.id,
        sourceId: source.id,
        ticker,
        assetName: `${doc.issuer.issuerName}${planned ? " (10b5-1 plan)" : ""}`,
        side: "buy" as const,
        amountLow: value,
        amountHigh: value,
        tradedAt: new Date(`${String(v(b.transactionDate)).slice(0, 10)}T00:00:00Z`),
        disclosedAt: c.filedAt,
        tokenSymbol: token?.symbol ?? null,
        pxTraded: px,
        pxDisclosed,
        mirrorStatus: token ? ("pending" as const) : ("skipped" as const),
        createdAt: new Date(),
      }
    }),
  )
  return buys.length
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Reads insider purchases filed in the last `days` days. */
export async function syncForm4(days = 2, limit = 200) {
  const to = new Date()
  const from = new Date(Date.now() - days * 86400_000)
  const candidates = (await form4Candidates(ymd(from), ymd(to))).slice(0, limit)
  let trades = 0
  for (const c of candidates) {
    try {
      trades += await readForm4(c)
    } catch (err) {
      console.error(`form4 ${c.accession}:`, err instanceof Error ? err.message : err)
    }
  }
  return { candidates: candidates.length, trades }
}

import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { XMLParser } from "fast-xml-parser"
import { unzipSync, strFromU8 } from "fflate"
import { readPtr, type PtrExtraction } from "../agent/read-ptr"
import { db, schema } from "../db"
import { closeOn } from "../prices"
import { tokenForTicker } from "../registry"
import { houseMembers } from "./legislators"

const CLERK = "https://disclosures-clerk.house.gov/public_disc"

type IndexRow = { First: string; Last: string; FilingType: string; StateDst: string; FilingDate: string; DocID: string | number }

export type PtrIndexEntry = { docId: string; first: string; last: string; seat: string; filedAt: Date; year: number }

/** All PTRs in a year's index, newest first. */
export async function ptrIndex(year = new Date().getUTCFullYear()): Promise<PtrIndexEntry[]> {
  const res = await fetch(`${CLERK}/financial-pdfs/${year}FD.zip`)
  if (!res.ok) throw new Error(`House index ${res.status}`)
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
  const xmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".xml"))
  if (!xmlName) throw new Error("House index zip has no XML")
  const parsed = new XMLParser({ parseTagValue: false }).parse(strFromU8(files[xmlName])) as {
    FinancialDisclosure: { Member: IndexRow | IndexRow[] }
  }
  const rows = [parsed.FinancialDisclosure.Member].flat()
  return rows
    .filter((r) => r.FilingType === "P")
    .map((r) => {
      const [m, d, y] = r.FilingDate.split("/").map(Number)
      return {
        docId: String(r.DocID),
        first: String(r.First).trim(),
        last: String(r.Last).trim(),
        seat: String(r.StateDst).trim().replace(/AL$/, "00"),
        filedAt: new Date(Date.UTC(y, m - 1, d)),
        year,
      }
    })
    .sort((a, b) => b.filedAt.getTime() - a.filedAt.getTime())
}

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

async function upsertMember(entry: PtrIndexEntry) {
  const members = await houseMembers()
  const m = members.get(entry.seat)
  const matches = m && m.name.toLowerCase().includes(entry.last.toLowerCase())
  const name = matches ? m.name : `${entry.first} ${entry.last}`
  const slug = slugify(name)
  const existing = await db.query.sources.findFirst({ where: eq(schema.sources.slug, slug) })
  if (existing) return existing
  const [row] = await db
    .insert(schema.sources)
    .values({
      slug,
      kind: "house",
      name,
      seat: entry.seat,
      affiliation: matches ? m.party : null,
      photoUrl: matches ? m.photoUrl : null,
      createdAt: new Date(),
    })
    .returning()
  return row
}

/** Records index entries we have not seen. Returns how many were new. */
export async function syncHouseIndex(limit = 40) {
  const entries = (await ptrIndex()).slice(0, limit)
  let added = 0
  for (const entry of entries) {
    const seen = await db.query.filings.findFirst({
      where: and(eq(schema.filings.kind, "house_ptr"), eq(schema.filings.docId, entry.docId)),
    })
    if (seen) continue
    const source = await upsertMember(entry)
    await db.insert(schema.filings).values({
      sourceId: source.id,
      kind: "house_ptr",
      docId: entry.docId,
      url: `${CLERK}/ptr-pdfs/${entry.year}/${entry.docId}.pdf`,
      filedAt: entry.filedAt,
      createdAt: new Date(),
    })
    added++
  }
  return added
}

function isoDate(s: string | null) {
  if (!s) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Which trades Coattails mirrors: stock trades, and call options read as a view on the stock. */
function mirrorable(line: PtrExtraction["transactions"][number]) {
  if (line.side === "exchange") return false
  if (line.assetType === "ST") return true
  if (line.assetType === "OP") return !/\bput/i.test(line.description ?? "")
  return false
}

/** Downloads a filing, has the agent read it, and stores its trades. */
export async function readHouseFiling(filing: schema.Filing) {
  const res = await fetch(filing.url)
  if (!res.ok) throw new Error(`PDF ${res.status}`)
  const pdf = Buffer.from(await res.arrayBuffer())
  const sha256 = createHash("sha256").update(pdf).digest("hex")
  const doc = await readPtr(pdf)

  const rows: (typeof schema.trades.$inferInsert)[] = []
  for (const line of doc.transactions) {
    if (line.side === "exchange") continue
    const tradedAt = isoDate(line.tradeDate)
    if (!tradedAt) continue
    const token = mirrorable(line) ? tokenForTicker(line.ticker) : null
    rows.push({
      filingId: filing.id,
      sourceId: filing.sourceId,
      ticker: line.ticker,
      assetName: line.assetType === "OP" && line.description ? `${line.assetName} (${line.description})` : line.assetName,
      side: line.side,
      amountLow: line.amountLow,
      amountHigh: line.amountHigh,
      tradedAt,
      disclosedAt: filing.filedAt,
      tokenSymbol: token?.symbol ?? null,
      mirrorStatus: token ? "pending" : "skipped",
      createdAt: new Date(),
    })
  }

  // Price the disclosure lag: underlying close on the trade date vs on the filing date.
  await Promise.all(
    rows.map(async (r) => {
      if (!r.ticker || !r.tokenSymbol) return
      const [a, b] = await Promise.all([closeOn(r.ticker, r.tradedAt), closeOn(r.ticker, r.disclosedAt)])
      r.pxTraded = a
      r.pxDisclosed = b
    }),
  )

  if (rows.length) await db.insert(schema.trades).values(rows)
  await db
    .update(schema.filings)
    .set({ sha256, status: "parsed", readBy: doc.readBy, error: doc.legible ? null : "Partly illegible scan" })
    .where(eq(schema.filings.id, filing.id))
  return rows.length
}

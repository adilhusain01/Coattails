/**
 * Demo: re-mirror a person's latest receipted filing to everyone who follows them now.
 * Usage: npx tsx --env-file=.env scripts/replay.ts <slug>
 * The worker picks the trades up on its next tick (within a minute).
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { db, schema } from "../src/server/db"

const slug = process.argv[2]
if (!slug) throw new Error("Usage: replay.ts <slug>")

const source = await db.query.sources.findFirst({ where: eq(schema.sources.slug, slug) })
if (!source) throw new Error(`No source ${slug}`)
const filing = await db.query.filings.findFirst({
  where: and(eq(schema.filings.sourceId, source.id), isNotNull(schema.filings.receiptSig)),
  orderBy: desc(schema.filings.filedAt),
})
if (!filing) throw new Error(`${source.name} has no receipted filing yet`)

const trades = await db.query.trades.findMany({
  where: and(eq(schema.trades.filingId, filing.id), isNotNull(schema.trades.tokenSymbol)),
})
if (!trades.length) throw new Error("That filing has no tokenized trades")
const ids = trades.map((t) => t.id)
await db.delete(schema.executions).where(inArray(schema.executions.tradeId, ids))
await db.update(schema.trades).set({ mirrorStatus: "pending", createdAt: new Date() }).where(inArray(schema.trades.id, ids))

const followers = await db.$count(schema.follows, and(eq(schema.follows.sourceId, source.id), eq(schema.follows.active, true)))
console.log(`Replaying ${filing.kind} ${filing.docId} (${trades.length} trades) to ${followers} followers of ${source.name}`)

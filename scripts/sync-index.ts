import { syncHouseIndex } from "../src/server/ingest/house"
import { db, schema } from "../src/server/db"

const added = await syncHouseIndex(Number(process.argv[2] ?? 40))
const sources = await db.select().from(schema.sources)
console.log(`added ${added} filings; ${sources.length} members`)
for (const s of sources.slice(0, 12)) console.log(s.slug, s.seat, s.affiliation, s.photoUrl ? "photo" : "-")

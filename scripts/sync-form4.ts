import { syncForm4 } from "../src/server/ingest/sec"

const days = Number(process.argv[2] ?? 2)
const limit = Number(process.argv[3] ?? 200)
console.log(await syncForm4(days, limit))

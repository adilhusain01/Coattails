import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import * as schema from "./schema"

const url = process.env.DATABASE_URL ?? `file:${process.cwd()}/data/coattails.db`

const globalForDb = globalThis as unknown as { coattailsDb?: ReturnType<typeof drizzle<typeof schema>> }

/** One connection per process; Next dev reloads modules, so cache it on globalThis. */
export const db = globalForDb.coattailsDb ?? drizzle(createClient({ url }), { schema })
globalForDb.coattailsDb = db

export { schema }

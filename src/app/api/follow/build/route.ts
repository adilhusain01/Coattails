import { address } from "@solana/kit"
import { eq } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { fail, handle, isWallet, ok } from "@/server/http"
import { buildApproveTx } from "@/server/solana/agent"

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as {
      wallet?: string
      slug?: string
      perTradeUsd?: number
      budgetUsd?: number
    }
    if (!isWallet(body.wallet)) return fail("Connect a wallet first")
    const per = Number(body.perTradeUsd)
    const budget = Number(body.budgetUsd)
    if (!(per >= 1 && per <= 1000)) return fail("Per-trade amount must be between $1 and $1,000")
    if (!(budget >= per && budget <= 100_000)) return fail("Budget must be at least the per-trade amount")
    const source = await db.query.sources.findFirst({ where: eq(schema.sources.slug, String(body.slug)) })
    if (!source) return fail("Unknown member", 404)
    const tx = await buildApproveTx(address(body.wallet), budget, `coattails:follow|${source.slug}|${per}`)
    return ok({ tx })
  })
}

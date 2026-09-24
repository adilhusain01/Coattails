import { address } from "@solana/kit"
import { and, eq } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { fail, handle, isWallet, ok } from "@/server/http"
import { cosignAndSend } from "@/server/solana/agent"

type Intent =
  | { type: "follow"; slug: string; perTradeUsd: number; trailingStopPct?: number | null; maxHoldDays?: number | null }
  | { type: "revoke" }
  | { type: "autosell" }

function clampOrNull(v: unknown, min: number, max: number) {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null
}

/** Co-signs a wallet-signed transaction the server built, then records what it did. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as { wallet?: string; signed?: string; intent?: Intent }
    if (!isWallet(body.wallet) || typeof body.signed !== "string" || !body.intent) return fail("Bad request")
    const wallet = body.wallet
    const sig = await cosignAndSend(address(wallet), body.signed)
    const intent = body.intent

    if (intent.type === "follow") {
      const trailingStopPct = clampOrNull(intent.trailingStopPct, 0.02, 0.9)
      const maxHoldDays = clampOrNull(intent.maxHoldDays, 1, 3650)
      const source = await db.query.sources.findFirst({ where: eq(schema.sources.slug, intent.slug) })
      if (!source) return fail("Unknown member", 404)
      await db
        .insert(schema.follows)
        .values({
          wallet,
          sourceId: source.id,
          perTradeUsd: intent.perTradeUsd,
          trailingStopPct,
          maxHoldDays,
          approveSig: sig,
          active: true,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.follows.wallet, schema.follows.sourceId],
          set: { perTradeUsd: intent.perTradeUsd, trailingStopPct, maxHoldDays, approveSig: sig, active: true, createdAt: new Date() },
        })
    } else if (intent.type === "revoke") {
      await db.update(schema.follows).set({ active: false }).where(eq(schema.follows.wallet, wallet))
    } else if (intent.type === "autosell") {
      await db
        .update(schema.follows)
        .set({ autoSell: true })
        .where(and(eq(schema.follows.wallet, wallet), eq(schema.follows.active, true)))
    }
    return ok({ sig })
  })
}

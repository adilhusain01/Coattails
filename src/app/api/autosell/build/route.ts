import { address } from "@solana/kit"
import { and, eq } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { fail, handle, isWallet, ok } from "@/server/http"
import { tokenBySymbol } from "@/server/registry"
import { buildStockApproveTx, stockBalance, stockMint } from "@/server/solana/agent"

/** Builds the one signature that lets exit rules and disclosed sales sell the follower's positions. */
export async function POST(req: Request) {
  return handle(async () => {
    const { wallet } = (await req.json()) as { wallet?: string }
    if (!isWallet(wallet)) return fail("Connect a wallet first")
    const owner = address(wallet)
    const open = await db.query.positions.findMany({
      where: and(eq(schema.positions.wallet, wallet), eq(schema.positions.status, "open")),
    })
    const mints: ReturnType<typeof address>[] = []
    for (const symbol of new Set(open.map((p) => p.tokenSymbol))) {
      const token = tokenBySymbol(symbol)
      if (!token) continue
      const mint = await stockMint(token.symbol, token.name, token.mint)
      const held = await stockBalance(owner, mint)
      if (held.tokens > 0 && held.delegatedToAgent < held.tokens) mints.push(mint)
    }
    if (!mints.length) return fail("Selling is already allowed on all your positions")
    return ok({ tx: await buildStockApproveTx(owner, mints.slice(0, 8).map((mint) => ({ mint }))) })
  })
}

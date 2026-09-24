import { address } from "@solana/kit"
import { eq } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { fail, handle, isWallet, ok } from "@/server/http"
import { tokenBySymbol } from "@/server/registry"
import { buildStockApproveTx, stockBalance, stockMint } from "@/server/solana/agent"

export async function POST(req: Request) {
  return handle(async () => {
    const { wallet } = (await req.json()) as { wallet?: string }
    if (!isWallet(wallet)) return fail("Connect a wallet first")
    const owner = address(wallet)
    const rows = await db.query.executions.findMany({ where: eq(schema.executions.wallet, wallet) })
    const symbols = [...new Set(rows.map((r) => r.tokenSymbol))]
    const stocks: { mint: ReturnType<typeof address>; tokens: number }[] = []
    for (const symbol of symbols) {
      const token = tokenBySymbol(symbol)
      if (!token) continue
      const mint = await stockMint(token.symbol, token.name, token.mint)
      const held = await stockBalance(owner, mint)
      if (held.tokens > 0) stocks.push({ mint, tokens: held.tokens })
    }
    if (!stocks.length) return fail("You have no mirrored positions yet")
    return ok({ tx: await buildStockApproveTx(owner, stocks.slice(0, 8)) })
  })
}

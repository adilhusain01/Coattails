import { address } from "@solana/kit"
import type { NextRequest } from "next/server"
import { fail, handle, isWallet, ok } from "@/server/http"
import { walletState } from "@/server/queries"
import { tokenBySymbol } from "@/server/registry"
import { cluster, stockBalance, stockMint, usdcAllowance, usdcMint } from "@/server/solana/agent"

export async function GET(req: NextRequest) {
  return handle(async () => {
    const wallet = req.nextUrl.searchParams.get("wallet")
    if (!isWallet(wallet)) return fail("Missing or invalid wallet")
    const owner = address(wallet)
    const [state, usdc, mint] = await Promise.all([walletState(wallet), usdcAllowance(owner), usdcMint()])

    // Whether exits can run: the follower must have allowed Coattails to sell each open position.
    const allowed = new Map<string, boolean>()
    await Promise.all(
      [...new Set(state.positions.filter((p) => p.status === "open").map((p) => p.tokenSymbol))].map(async (symbol) => {
        const token = tokenBySymbol(symbol)
        if (!token) return
        const held = await stockBalance(owner, await stockMint(token.symbol, token.name, token.mint))
        allowed.set(symbol, held.tokens > 0 && held.delegatedToAgent >= held.tokens - 1e-9)
      }),
    )
    const positions = state.positions.map((p) => ({ ...p, sellAllowed: p.status === "open" ? (allowed.get(p.tokenSymbol) ?? false) : null }))
    return ok({ ...state, positions, usdc: { ...usdc, mint, cluster } })
  })
}

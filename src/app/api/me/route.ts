import { address } from "@solana/kit"
import type { NextRequest } from "next/server"
import { fail, handle, isWallet, ok } from "@/server/http"
import { walletState } from "@/server/queries"
import { cluster, usdcAllowance, usdcMint } from "@/server/solana/agent"

export async function GET(req: NextRequest) {
  return handle(async () => {
    const wallet = req.nextUrl.searchParams.get("wallet")
    if (!isWallet(wallet)) return fail("Missing or invalid wallet")
    const [state, usdc, mint] = await Promise.all([walletState(wallet), usdcAllowance(address(wallet)), usdcMint()])
    return ok({ ...state, usdc: { ...usdc, mint, cluster } })
  })
}

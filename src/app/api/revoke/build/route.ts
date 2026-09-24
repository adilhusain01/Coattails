import { address } from "@solana/kit"
import { fail, handle, isWallet, ok } from "@/server/http"
import { buildRevokeTx } from "@/server/solana/agent"

export async function POST(req: Request) {
  return handle(async () => {
    const { wallet } = (await req.json()) as { wallet?: string }
    if (!isWallet(wallet)) return fail("Connect a wallet first")
    return ok({ tx: await buildRevokeTx(address(wallet)) })
  })
}

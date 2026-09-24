import { address } from "@solana/kit"
import { fail, handle, isWallet, ok } from "@/server/http"
import { faucet } from "@/server/solana/agent"

const AMOUNT = 100
const lastDrip = new Map<string, number>()

export async function POST(req: Request) {
  return handle(async () => {
    const { wallet } = (await req.json()) as { wallet?: string }
    if (!isWallet(wallet)) return fail("Missing or invalid wallet")
    const last = lastDrip.get(wallet) ?? 0
    if (Date.now() - last < 60_000) return fail("One faucet drip per minute. Try again shortly.", 429)
    lastDrip.set(wallet, Date.now())
    const sig = await faucet(address(wallet), AMOUNT)
    return ok({ sig, amount: AMOUNT })
  })
}

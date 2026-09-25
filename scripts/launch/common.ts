/**
 * Shared pieces for launching the Coattails agent token on mainnet. This is the only mainnet code
 * in the repo; the app itself runs on devnet. The launch wallet (keys/launch.json) is separate from
 * the devnet agent key.
 */
import { readFileSync, writeFileSync } from "node:fs"
import {
  createClient,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from "@solana/kit"
import { solanaRpc } from "@solana/kit-plugin-rpc"
import { signer } from "@solana/kit-plugin-signer"

export const RECORD_PATH = "src/server/data/agent-token.json"
export const MAINNET_RPC = process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com"
export const SOL_MINT = "So11111111111111111111111111111111111111112"

export type AgentTokenRecord = {
  name: string
  symbol: string
  mint?: string
  wallet: string
  pair: { symbol: string; mint: string; decimals: number }
  clawpump?: { agentId: string; launchTx: string; paymentTx: string; pumpUrl?: string; dashboard?: string; at: string }
  meteora?: { pool: string; createTx: string | null; position?: string; liquidityTx?: string | null; vaultA?: string; vaultB?: string; at: string }
}

export function readRecord(): AgentTokenRecord | null {
  try {
    return JSON.parse(readFileSync(RECORD_PATH, "utf8")) as AgentTokenRecord
  } catch {
    return null
  }
}

export function writeRecord(record: AgentTokenRecord) {
  writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2) + "\n")
}

export async function launchSigner(): Promise<KeyPairSigner> {
  const path = process.env.LAUNCH_KEYPAIR_PATH ?? "keys/launch.json"
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, "utf8")) as number[]))
}

export async function launchClient() {
  return createClient()
    .use(signer(await launchSigner()))
    .use(solanaRpc({ rpcUrl: MAINNET_RPC, transactionConfig: { version: 0 } }))
}

export function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

export const flag = (name: string) => process.argv.includes(`--${name}`)

// Clawpump partner API --------------------------------------------------------------------------

export async function clawpump<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const key = process.env.CLAWPUMP_API_KEY
  if (!key) throw new Error("Set CLAWPUMP_API_KEY in .env (cpk_..., from clawpump.tech/developers)")
  const res = await fetch(`https://clawpump.tech/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T }
}

// Jupiter swaps from the launch wallet ----------------------------------------------------------

type Order = { transaction: string | null; requestId: string; outAmount: string; inAmount: string; errorMessage?: string; error?: string }

/** Swap through Jupiter Swap V2 order/execute, signed by the launch wallet. Returns the signature. */
export async function jupiterSwap(opts: { inputMint: string; outputMint: string; amount: bigint; dry?: boolean }) {
  const s = await launchSigner()
  const headers: HeadersInit = process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {}
  const q = new URLSearchParams({
    inputMint: opts.inputMint,
    outputMint: opts.outputMint,
    amount: opts.amount.toString(),
    taker: s.address,
    slippageBps: "150",
  })
  const order = (await (await fetch(`https://api.jup.ag/swap/v2/order?${q}`, { headers })).json()) as Order
  if (!order.transaction) throw new Error(`Jupiter order failed: ${order.errorMessage ?? order.error ?? JSON.stringify(order).slice(0, 200)}`)
  console.log(`  quote: ${order.inAmount} in -> ${order.outAmount} out`)
  if (opts.dry) return { sig: null, outAmount: BigInt(order.outAmount) }
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(order.transaction))
  const signed = await partiallySignTransaction([s.keyPair], tx)
  const exec = (await (
    await fetch("https://api.jup.ag/swap/v2/execute", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ signedTransaction: getBase64EncodedWireTransaction(signed), requestId: order.requestId }),
    })
  ).json()) as { status: string; signature?: string; error?: string; outputAmountResult?: string }
  if (exec.status !== "Success" || !exec.signature) throw new Error(`Jupiter execute failed: ${exec.error ?? JSON.stringify(exec).slice(0, 200)}`)
  return { sig: exec.signature, outAmount: BigInt(exec.outputAmountResult ?? order.outAmount) }
}

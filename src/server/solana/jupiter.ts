/**
 * Mainnet fills through Jupiter Swap V2 (/swap/v2/build). One atomic transaction, paid by the agent:
 * pull the follower's funds through their allowance, create their output account, swap with the
 * follower's account as the destination, and write the memo. The agent never ends up holding the
 * output.
 */
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Address,
  type Instruction,
} from "@solana/kit"
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget"
import { getAddMemoInstruction } from "@solana-program/memo"
import { TOKEN_PROGRAM_ADDRESS, getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction } from "@solana-program/token"
import * as t22 from "@solana-program/token-2022"
import type { AgentClient } from "./agent"

const JUP = "https://api.jup.ag"

type JupIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }
type BuildResponse = {
  inAmount: string
  outAmount: string
  priceImpactPct: string
  setupInstructions: JupIx[]
  swapInstruction: JupIx
  cleanupInstruction?: JupIx | null
  otherInstructions?: JupIx[]
  addressesByLookupTableAddress?: Record<string, string[]>
  routePlan: { swapInfo: { label: string } }[]
}

function toInstruction(ix: JupIx): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((a) => ({
      address: address(a.pubkey),
      role: a.isSigner
        ? a.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : a.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: new Uint8Array(Buffer.from(ix.data, "base64")),
  }
}

export async function jupiterBuild(params: {
  inputMint: Address
  outputMint: Address
  amount: bigint
  taker: Address
  destinationTokenAccount: Address
  slippageBps?: number
}) {
  const q = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    taker: params.taker,
    destinationTokenAccount: params.destinationTokenAccount,
    slippageBps: String(params.slippageBps ?? 50),
    maxAccounts: "40",
  })
  const headers: HeadersInit = process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {}
  const res = await fetch(`${JUP}/swap/v2/build?${q}`, { headers })
  if (!res.ok) throw new Error(`Jupiter build ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as BuildResponse
}

/**
 * Buys `outputMint` for the follower with `amountRaw` of their USDC. Rejects the route if its
 * implied price per share is more than `maxDeviation` away from the guard price.
 */
export async function jupiterMirrorBuy(opts: {
  client: AgentClient
  owner: Address
  usdcMint: Address
  userUsdcAta: Address
  agentUsdcAta: Address
  stockMint: Address
  userStockAta: Address
  amountRaw: bigint
  guardPrice: number
  multiplier: number
  maxDeviation: number
  memo: string
}) {
  const agent = opts.client.payer
  const route = await jupiterBuild({
    inputMint: opts.usdcMint,
    outputMint: opts.stockMint,
    amount: opts.amountRaw,
    taker: agent.address,
    destinationTokenAccount: opts.userStockAta,
  })
  const usd = Number(route.inAmount) / 1e6
  const shares = (Number(route.outAmount) / 1e8) * opts.multiplier
  const implied = usd / shares
  if (Math.abs(implied / opts.guardPrice - 1) > opts.maxDeviation) {
    throw new Error(`Route price ${implied.toFixed(2)} is outside the Pyth guard ${opts.guardPrice.toFixed(2)}`)
  }

  const instructions: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: 600_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 20_000n }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: agent,
      ata: opts.agentUsdcAta,
      owner: agent.address,
      mint: opts.usdcMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    getTransferCheckedInstruction({
      source: opts.userUsdcAta,
      mint: opts.usdcMint,
      destination: opts.agentUsdcAta,
      authority: agent,
      amount: opts.amountRaw,
      decimals: 6,
    }),
    t22.getCreateAssociatedTokenIdempotentInstruction({
      payer: agent,
      ata: opts.userStockAta,
      owner: opts.owner,
      mint: opts.stockMint,
      tokenProgram: t22.TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...route.setupInstructions.map(toInstruction),
    toInstruction(route.swapInstruction),
    ...(route.cleanupInstruction ? [toInstruction(route.cleanupInstruction)] : []),
    ...(route.otherInstructions ?? []).map(toInstruction),
    getAddMemoInstruction({ memo: opts.memo }),
  ]

  const { value: blockhash } = await opts.client.rpc.getLatestBlockhash().send()
  const lookup = Object.fromEntries(
    Object.entries(route.addressesByLookupTableAddress ?? {}).map(([alt, keys]) => [address(alt), keys.map((k) => address(k))]),
  )
  const message = compressTransactionMessageUsingAddressLookupTables(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(agent.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    ),
    lookup,
  )
  const signed = await signTransaction([agent.keyPair], compileTransaction(message))
  const sig = await opts.client.rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" })
    .send()
  return { sig: sig as string, usd, shares, implied, route: route.routePlan.map((r) => r.swapInfo.label).join(" > ") }
}

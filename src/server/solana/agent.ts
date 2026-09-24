/**
 * The Coattails agent's on-chain actions. The agent key pays every fee, writes filing receipts,
 * and moves follower funds only through the SPL allowance each follower approved.
 */
import { readFileSync } from "node:fs"
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createClient,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit"
import { solanaRpc } from "@solana/kit-plugin-rpc"
import { signer } from "@solana/kit-plugin-signer"
import { getAddMemoInstruction } from "@solana-program/memo"
import { getCreateAccountInstruction } from "@solana-program/system"
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getApproveCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToCheckedInstruction,
  getRevokeInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token"
import * as t22 from "@solana-program/token-2022"
import { eq } from "drizzle-orm"
import { db, schema } from "../db"
import { jupiterMirrorBuy } from "./jupiter"

export const USDC_DECIMALS = 6
export const STOCK_DECIMALS = 8

const cluster = process.env.NEXT_PUBLIC_CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet"
const rpcUrl =
  process.env.SOLANA_RPC_URL ||
  (cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com")

async function loadAgent(): Promise<KeyPairSigner> {
  const path = process.env.AGENT_KEYPAIR_PATH ?? "keys/agent.json"
  const bytes = new Uint8Array(JSON.parse(readFileSync(/* turbopackIgnore: true */ path, "utf8")) as number[])
  return createKeyPairSignerFromBytes(bytes)
}

export type AgentClient = Awaited<ReturnType<typeof buildClient>>

async function buildClient() {
  const agent = await loadAgent()
  return createClient()
    .use(signer(agent))
    .use(solanaRpc({ rpcUrl, transactionConfig: { version: 0 } }))
}

const g = globalThis as unknown as { coattailsAgent?: Promise<AgentClient> }
export function agentClient() {
  g.coattailsAgent ??= buildClient()
  return g.coattailsAgent
}

export async function agentAddress() {
  return (await agentClient()).payer.address
}

/** Public RPC endpoints throttle (HTTP 429). Retry those with backoff; rethrow everything else. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (err) {
      const text = `${err instanceof Error ? err.message : err} ${JSON.stringify((err as { context?: unknown })?.context ?? "")} ${String((err as { cause?: unknown })?.cause ?? "")}`
      if (i >= attempts - 1 || !/429|Too Many Requests|rate limit/i.test(text)) throw err
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i))
    }
  }
}

async function send(instructions: Instruction[]) {
  const client = await agentClient()
  const result = await withRetry(() => client.sendTransaction(instructions))
  return result.context.signature as string
}

// ---------------------------------------------------------------------------------------------
// Mints. On mainnet these are Circle USDC and the real xStocks. On devnet the agent creates a
// test USDC mint and one Token-2022 stand-in per tokenized stock, and is their mint authority.

const MAINNET_USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")

async function kvGet(key: string) {
  const row = await db.query.kv.findFirst({ where: eq(schema.kv.key, key) })
  return row?.value ?? null
}

async function kvSet(key: string, value: string) {
  await db.insert(schema.kv).values({ key, value }).onConflictDoUpdate({ target: schema.kv.key, set: { value } })
}

export async function usdcMint(): Promise<Address> {
  if (cluster === "mainnet-beta") return MAINNET_USDC
  const saved = await kvGet("devnet:usdc")
  if (saved) return address(saved)

  const client = await agentClient()
  const mint = await generateKeyPairSigner()
  const space = BigInt(getMintSize())
  const rent = await client.rpc.getMinimumBalanceForRentExemption(space).send()
  await client.sendTransaction([
    getCreateAccountInstruction({
      payer: client.payer,
      newAccount: mint,
      lamports: rent,
      space,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({ mint: mint.address, decimals: USDC_DECIMALS, mintAuthority: client.payer.address }),
  ])
  await kvSet("devnet:usdc", mint.address)
  return mint.address
}

/** Devnet stand-in for a tokenized stock, with on-chain name and symbol so wallets show it. */
export async function stockMint(symbol: string, name: string, mainnetMint: string): Promise<Address> {
  if (cluster === "mainnet-beta") return address(mainnetMint)
  const key = `devnet:stock:${symbol}`
  const saved = await kvGet(key)
  if (saved) return address(saved)

  const client = await agentClient()
  const mint = await generateKeyPairSigner()
  const authority = client.payer.address
  const metadata = t22.extension("TokenMetadata", {
    updateAuthority: authority,
    mint: mint.address,
    name: `${name} (Coattails devnet)`,
    symbol,
    uri: "",
    additionalMetadata: new Map([["mirrors", mainnetMint]]),
  })
  const pointer = t22.extension("MetadataPointer", { authority, metadataAddress: mint.address })
  // The account is created at its pre-metadata size; the metadata instruction reallocates, so
  // rent covers the final size.
  const space = BigInt(t22.getMintSize([pointer]))
  const rent = await client.rpc.getMinimumBalanceForRentExemption(BigInt(t22.getMintSize([pointer, metadata]))).send()
  await client.sendTransaction([
    getCreateAccountInstruction({
      payer: client.payer,
      newAccount: mint,
      lamports: rent,
      space,
      programAddress: t22.TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...t22.getPreInitializeInstructionsForMintExtensions(mint.address, [pointer]),
    t22.getInitializeMint2Instruction({ mint: mint.address, decimals: STOCK_DECIMALS, mintAuthority: authority }),
    ...t22.getPostInitializeInstructionsForMintExtensions(mint.address, client.payer, [metadata]),
  ])
  await kvSet(key, mint.address)
  return mint.address
}

async function ata(owner: Address, mint: Address, tokenProgram: Address = TOKEN_PROGRAM_ADDRESS) {
  const [pda] = await findAssociatedTokenPda({ owner, mint, tokenProgram })
  return pda
}

// ---------------------------------------------------------------------------------------------
// Receipts

/** One Memo transaction per filing. Returns its signature. */
export async function writeReceipt(memo: string) {
  return send([getAddMemoInstruction({ memo })])
}

// ---------------------------------------------------------------------------------------------
// Faucet (devnet only): test USDC so anyone can try a mirror.

export async function faucet(to: Address, usd: number) {
  if (cluster !== "devnet") throw new Error("The faucet exists only on devnet")
  const client = await agentClient()
  const mint = await usdcMint()
  const dest = await ata(to, mint)
  return send([
    getCreateAssociatedTokenIdempotentInstruction({
      payer: client.payer,
      ata: dest,
      owner: to,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    getMintToCheckedInstruction({
      mint,
      token: dest,
      mintAuthority: client.payer,
      amount: BigInt(Math.round(usd * 10 ** USDC_DECIMALS)),
      decimals: USDC_DECIMALS,
    }),
    getAddMemoInstruction({ memo: `coattails:faucet|${usd} test USDC` }),
  ])
}

// ---------------------------------------------------------------------------------------------
// Follow and unfollow: transactions the follower signs, with the agent as fee payer.

// On globalThis so every route bundle in the Next server shares one map.
const gp = globalThis as unknown as { coattailsPending?: Map<string, { bytes: string; expires: number }> }
const pending = (gp.coattailsPending ??= new Map())

async function unsignedForWallet(owner: Address, instructions: Instruction[]) {
  const client = await agentClient()
  const { value: blockhash } = await withRetry(() => client.rpc.getLatestBlockhash().send())
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(client.payer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  )
  const tx = compileTransaction(message)
  const wire = getBase64EncodedWireTransaction(tx)
  // Remember the exact message so the co-sign step only signs what we built.
  pending.set(owner, { bytes: Buffer.from(tx.messageBytes).toString("base64"), expires: Date.now() + 120_000 })
  return wire
}

/**
 * Follow = approve the agent as delegate on the follower's USDC account, capped at `budgetUsd`.
 * The approval replaces any earlier one, so the cap is the budget across everyone they follow.
 */
export async function buildApproveTx(owner: Address, budgetUsd: number, memo: string) {
  const client = await agentClient()
  const mint = await usdcMint()
  const source = await ata(owner, mint)
  const user = createNoopSigner(owner)
  return unsignedForWallet(owner, [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: client.payer,
      ata: source,
      owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    getApproveCheckedInstruction({
      source,
      mint,
      delegate: client.payer.address,
      owner: user,
      amount: BigInt(Math.round(budgetUsd * 10 ** USDC_DECIMALS)),
      decimals: USDC_DECIMALS,
    }),
    getAddMemoInstruction({ memo }),
  ])
}

/**
 * The same approval, already signed by the agent as fee payer, for Blink clients that sign and
 * send the transaction themselves.
 */
export async function buildApproveTxPresigned(owner: Address, budgetUsd: number, memo: string) {
  const wire = await buildApproveTx(owner, budgetUsd, memo)
  pending.delete(owner)
  const client = await agentClient()
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
  const signed = await partiallySignTransaction([client.payer.keyPair], tx)
  return getBase64EncodedWireTransaction(signed)
}

export async function buildRevokeTx(owner: Address) {
  const mint = await usdcMint()
  const source = await ata(owner, mint)
  return unsignedForWallet(owner, [
    getRevokeInstruction({ source, owner: createNoopSigner(owner) }),
    getAddMemoInstruction({ memo: "coattails:revoke" }),
  ])
}

/** Co-signs a wallet-signed transaction as fee payer and sends it. */
export async function cosignAndSend(owner: Address, signedWire: string) {
  const entry = pending.get(owner)
  if (!entry || entry.expires < Date.now()) throw new Error("This request expired. Start again.")
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(signedWire))
  if (Buffer.from(tx.messageBytes).toString("base64") !== entry.bytes) {
    throw new Error("Your wallet changed the transaction, so Coattails did not co-sign it.")
  }
  pending.delete(owner)
  const client = await agentClient()
  const signed = await partiallySignTransaction([client.payer.keyPair], tx)
  const sig = await withRetry(() =>
    client.rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" }).send(),
  )
  return sig as string
}

/** Waits until a signature is confirmed; throws if the transaction failed. */
export async function confirm(sig: string, timeoutMs = 60_000) {
  const client = await agentClient()
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { value } = await withRetry(() =>
      client.rpc.getSignatureStatuses([sig as Parameters<typeof client.rpc.getSignatureStatuses>[0][number]]).send(),
    )
    const status = value[0]
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`)
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error("Timed out waiting for confirmation")
}

// ---------------------------------------------------------------------------------------------
// Delegation state

export async function usdcAllowance(owner: Address) {
  const client = await agentClient()
  const mint = await usdcMint()
  const tokenAccount = await ata(owner, mint)
  const account = await withRetry(() => t22.fetchMaybeToken(client.rpc, tokenAccount))
  if (!account.exists) return { balance: 0, allowance: 0 }
  const d = account.data
  const agent = client.payer.address
  const delegated = d.delegate.__option === "Some" && d.delegate.value === agent ? Number(d.delegatedAmount) : 0
  return { balance: Number(d.amount) / 10 ** USDC_DECIMALS, allowance: delegated / 10 ** USDC_DECIMALS }
}

// ---------------------------------------------------------------------------------------------
// Fills

export type Fill = { sig: string; usdc: number; tokens: number }

/**
 * Devnet buy: pull `usd` of test USDC from the follower through the allowance and mint the
 * stand-in stock at the Pyth price. On mainnet this is a Jupiter swap into the follower's ATA.
 */
export async function fillBuy(opts: {
  owner: Address
  usd: number
  price: number
  stock: Address
  memo: string
  /** xStock scaled-UI multiplier (mainnet); share-equivalents = tokens x multiplier. */
  multiplier?: number
}): Promise<Fill> {
  const client = await agentClient()
  const usdc = await usdcMint()
  const from = await ata(opts.owner, usdc)
  const treasury = await ata(client.payer.address, usdc)
  const to = await ata(opts.owner, opts.stock, t22.TOKEN_2022_PROGRAM_ADDRESS)
  const usdcRaw = BigInt(Math.round(opts.usd * 10 ** USDC_DECIMALS))

  if (cluster === "mainnet-beta") {
    const fill = await jupiterMirrorBuy({
      client,
      owner: opts.owner,
      usdcMint: usdc,
      userUsdcAta: from,
      agentUsdcAta: treasury,
      stockMint: opts.stock,
      userStockAta: to,
      amountRaw: usdcRaw,
      guardPrice: opts.price,
      multiplier: opts.multiplier ?? 1,
      maxDeviation: 0.01,
      memo: opts.memo,
    })
    return { sig: fill.sig, usdc: fill.usd, tokens: fill.shares / (opts.multiplier ?? 1) }
  }

  const tokens = opts.usd / opts.price
  const tokenRaw = BigInt(Math.floor(tokens * 10 ** STOCK_DECIMALS))

  const sig = await send([
    getCreateAssociatedTokenIdempotentInstruction({
      payer: client.payer,
      ata: treasury,
      owner: client.payer.address,
      mint: usdc,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    getTransferCheckedInstruction({
      source: from,
      mint: usdc,
      destination: treasury,
      authority: client.payer,
      amount: usdcRaw,
      decimals: USDC_DECIMALS,
    }),
    t22.getCreateAssociatedTokenIdempotentInstruction({
      payer: client.payer,
      ata: to,
      owner: opts.owner,
      mint: opts.stock,
      tokenProgram: t22.TOKEN_2022_PROGRAM_ADDRESS,
    }),
    t22.getMintToCheckedInstruction({
      mint: opts.stock,
      token: to,
      mintAuthority: client.payer,
      amount: tokenRaw,
      decimals: STOCK_DECIMALS,
    }),
    getAddMemoInstruction({ memo: opts.memo }),
  ])
  return { sig, usdc: opts.usd, tokens }
}

/** The follower's balance of a stock token, in tokens. */
export async function stockBalance(owner: Address, stock: Address) {
  const client = await agentClient()
  const tokenAccount = await ata(owner, stock, t22.TOKEN_2022_PROGRAM_ADDRESS)
  const account = await withRetry(() => t22.fetchMaybeToken(client.rpc, tokenAccount))
  if (!account.exists) return { tokens: 0, delegatedToAgent: 0 }
  const d = account.data
  const delegated = d.delegate.__option === "Some" && d.delegate.value === client.payer.address ? d.delegatedAmount : 0n
  return { tokens: Number(d.amount) / 10 ** STOCK_DECIMALS, delegatedToAgent: Number(delegated) / 10 ** STOCK_DECIMALS }
}

/**
 * Devnet sell: burn the follower's stand-in through their stock allowance and mint them test
 * USDC at the Pyth price.
 */
export async function fillSell(opts: {
  owner: Address
  tokens: number
  price: number
  stock: Address
  memo: string
}): Promise<Fill> {
  if (cluster !== "devnet") throw new Error("Mainnet fills go through Jupiter (not enabled on this deployment)")
  const client = await agentClient()
  const usdc = await usdcMint()
  const from = await ata(opts.owner, opts.stock, t22.TOKEN_2022_PROGRAM_ADDRESS)
  const dest = await ata(opts.owner, usdc)
  const usd = opts.tokens * opts.price
  const sig = await send([
    t22.getBurnCheckedInstruction({
      account: from,
      mint: opts.stock,
      authority: client.payer,
      amount: BigInt(Math.floor(opts.tokens * 10 ** STOCK_DECIMALS)),
      decimals: STOCK_DECIMALS,
    }),
    getMintToCheckedInstruction({
      mint: usdc,
      token: dest,
      mintAuthority: client.payer,
      amount: BigInt(Math.floor(usd * 10 ** USDC_DECIMALS)),
      decimals: USDC_DECIMALS,
    }),
    getAddMemoInstruction({ memo: opts.memo }),
  ])
  return { sig, usdc: usd, tokens: opts.tokens }
}

const U64_MAX = 18_446_744_073_709_551_615n

/**
 * Lets the agent sell the follower's mirrored stocks (exit rules and disclosed sales). The
 * allowance is on those stock accounts only and covers later buys of the same stock.
 */
export async function buildStockApproveTx(owner: Address, stocks: { mint: Address }[]) {
  const user = createNoopSigner(owner)
  return unsignedForWallet(owner, [
    ...(await Promise.all(
      stocks.map(async (s) =>
        t22.getApproveCheckedInstruction({
          source: await ata(owner, s.mint, t22.TOKEN_2022_PROGRAM_ADDRESS),
          mint: s.mint,
          delegate: (await agentClient()).payer.address,
          owner: user,
          amount: U64_MAX,
          decimals: STOCK_DECIMALS,
        }),
      ),
    )),
    getAddMemoInstruction({ memo: "coattails:allow-exits" }),
  ])
}

export { cluster, ata }

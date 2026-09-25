/**
 * Give the Coattails agent token a stock-paired Meteora pool: a DAMM v2 pool COAT/NVDAx, full
 * range, seeded on both sides. Mainnet. Simulates only unless --send.
 *
 * DAMM v2 rather than DLMM: its accounts cost about 0.02 SOL in rent against 0.1+ SOL for DLMM's
 * bin arrays and position, and it is the pool type Meteora's bonding curves graduate into.
 *
 * Seeding: spends --seed-sol SOL on NVDAx through Jupiter, then half of that NVDAx on COAT (bought
 * on its Clawpump curve through Jupiter). The pool opens at the price those two buys implied.
 *
 * The Meteora SDK is built on @solana/web3.js v1, so this script uses it; the app does not.
 * Usage: npx tsx --env-file=.env scripts/launch/pool.ts [--seed-sol 0.006] [--fee-bps 100] [--send]
 */
import { readFileSync } from "node:fs"
import {
  BaseFeeMode,
  CollectFeeMode,
  CpAmm,
  getBaseFeeParams,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  type PoolFeesParams,
} from "@meteora-ag/cp-amm-sdk"
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js"
import BN from "bn.js"
import { arg, flag, jupiterSwap, MAINNET_RPC, readRecord, SOL_MINT, writeRecord } from "./common"

const send = flag("send")
const record = readRecord()
if (!record?.mint) throw new Error("Launch the token first: scripts/launch/token.ts --pay")
if (record.meteora?.pool) {
  console.log(`Pool already exists: ${record.meteora.pool}`)
  process.exit(0)
}

const connection = new Connection(MAINNET_RPC, "confirmed")
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.LAUNCH_KEYPAIR_PATH ?? "keys/launch.json", "utf8"))))
const me = kp.publicKey
const A = new PublicKey(record.mint) // COAT
const B = new PublicKey(record.pair.mint) // NVDAx
const seedSol = Number(arg("seed-sol", "0.006"))
const feeBps = Number(arg("fee-bps", "100"))

async function tokenProgram(mint: PublicKey) {
  const info = await connection.getAccountInfo(mint)
  if (!info) throw new Error(`Mint ${mint.toBase58()} not found`)
  return info.owner
}
async function balanceOf(mint: PublicKey) {
  const res = await connection.getParsedTokenAccountsByOwner(me, { mint })
  return res.value.reduce((a, v) => a + BigInt(v.account.data.parsed.info.tokenAmount.amount as string), 0n)
}
async function submit(label: string, tx: Transaction, signers: Keypair[]) {
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
  tx.feePayer = me
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(...signers)
  // Always simulate first; only a clean simulation is sent.
  const sim = await connection.simulateTransaction(tx)
  if (sim.value.err) {
    const detail = `${JSON.stringify(sim.value.err)} ${sim.value.logs?.slice(-5).join(" | ")}`
    if (send) throw new Error(`${label} simulation failed: ${detail}`)
    console.log(`${label}: simulation failed as expected before the seed swaps run (${detail.slice(0, 200)})`)
    return null
  }
  console.log(`${label}: simulation OK (${sim.value.unitsConsumed} CU)`)
  if (!send) return null
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 })
  const conf = await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed")
  if (conf.value.err) throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}`)
  console.log(`${label}: https://solscan.io/tx/${sig}`)
  return sig
}

console.log(`SOL balance ${(await connection.getBalance(me)) / 1e9}`)

// 1. Seed both sides through Jupiter. In a dry run, amounts come from quotes.
let bHeld = await balanceOf(B)
if (bHeld === 0n) {
  console.log(`buying ${record.pair.symbol} with ${seedSol} SOL`)
  const r = await jupiterSwap({ inputMint: SOL_MINT, outputMint: B.toBase58(), amount: BigInt(Math.round(seedSol * 1e9)), dry: !send })
  bHeld = send ? await balanceOf(B) : r.outAmount
}
let aHeld = await balanceOf(A)
if (aHeld === 0n) {
  console.log(`buying ${record.symbol} with half the ${record.pair.symbol}`)
  if (send) {
    await jupiterSwap({ inputMint: B.toBase58(), outputMint: A.toBase58(), amount: bHeld / 2n })
    aHeld = await balanceOf(A)
    bHeld = await balanceOf(B)
  } else {
    // Jupiter won't build a swap the wallet can't fund yet, but its order still reports the
    // expected output, which is all a dry run needs.
    const half = bHeld / 2n
    const q = new URLSearchParams({ inputMint: B.toBase58(), outputMint: A.toBase58(), amount: half.toString(), taker: me.toBase58() })
    const order = (await (await fetch(`https://api.jup.ag/swap/v2/order?${q}`)).json()) as { outAmount?: string }
    if (!order.outAmount) throw new Error("No Jupiter route to the token yet")
    aHeld = BigInt(order.outAmount)
    bHeld = bHeld - half
  }
}
console.log(`seeding the pool with ${aHeld} raw ${record.symbol} and ${bHeld} raw ${record.pair.symbol}`)

// 2. Create the full-range pool at the price the two buys implied.
const cpAmm = new CpAmm(connection)
const [aProgram, bProgram] = [await tokenProgram(A), await tokenProgram(B)]
const { initSqrtPrice, liquidityDelta } = cpAmm.preparePoolCreationParams({
  tokenAAmount: new BN(aHeld.toString()),
  tokenBAmount: new BN(bHeld.toString()),
  minSqrtPrice: MIN_SQRT_PRICE,
  maxSqrtPrice: MAX_SQRT_PRICE,
  collectFeeMode: CollectFeeMode.BothToken,
})
// A flat fee: the time scheduler starts and ends at the same rate.
const poolFees: PoolFeesParams = {
  baseFee: getBaseFeeParams({
    baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
    feeTimeSchedulerParam: { startingFeeBps: feeBps, endingFeeBps: feeBps, numberOfPeriod: 0, totalDuration: 0 },
  }),
  compoundingFeeBps: 0,
  padding: 0,
  dynamicFee: null,
}
const positionNft = Keypair.generate()
const { tx, pool, position } = await cpAmm.createCustomPool({
  payer: me,
  creator: me,
  positionNft: positionNft.publicKey,
  tokenAMint: A,
  tokenBMint: B,
  tokenAAmount: new BN(aHeld.toString()),
  tokenBAmount: new BN(bHeld.toString()),
  sqrtMinPrice: MIN_SQRT_PRICE,
  sqrtMaxPrice: MAX_SQRT_PRICE,
  initSqrtPrice,
  liquidityDelta,
  poolFees,
  hasAlphaVault: false,
  collectFeeMode: CollectFeeMode.BothToken,
  activationPoint: null,
  activationType: 1,
  tokenAProgram: aProgram,
  tokenBProgram: bProgram,
})
const createTx = await submit("create DAMM v2 pool", tx, [kp, positionNft])

if (!send) {
  console.log(`Dry run: pool ${pool.toBase58()} would be created. Re-run with --send.`)
  process.exit(0)
}
writeRecord({
  ...record,
  meteora: { pool: pool.toBase58(), createTx, position: position.toBase58(), liquidityTx: createTx, at: new Date().toISOString() },
})
console.log(`Meteora DAMM v2 pool ${pool.toBase58()} saved to the record.`)

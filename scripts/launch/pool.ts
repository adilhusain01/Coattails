/**
 * Give the Coattails agent token a stock-paired Meteora pool: a DLMM pair COAT/NVDAx with a
 * two-sided position around the market price. Mainnet. Dry run (simulate only) unless --send.
 *
 * Seeding: spends --seed-sol SOL on NVDAx through Jupiter, then half of that NVDAx on COAT (bought
 * on its Clawpump curve through Jupiter). If COAT can't be bought yet, the position is NVDAx-only
 * (bids below the price).
 *
 * The Meteora SDK is built on @solana/web3.js v1, so this script uses it; the app does not.
 * Usage: npx tsx --env-file=.env scripts/launch/pool.ts [--seed-sol 0.03] [--bin-step 25] [--fee-bps 100] [--send]
 */
import { readFileSync } from "node:fs"
import DLMM, { ActivationType, StrategyType } from "@meteora-ag/dlmm"
import BN from "bn.js"
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js"
import { arg, flag, jupiterSwap, MAINNET_RPC, readRecord, SOL_MINT, writeRecord } from "./common"

const send = flag("send")
const record = readRecord()
if (!record?.mint) throw new Error("Launch the token first: scripts/launch/token.ts --pay")

const connection = new Connection(MAINNET_RPC, "confirmed")
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.LAUNCH_KEYPAIR_PATH ?? "keys/launch.json", "utf8"))))
const me = kp.publicKey
const X = new PublicKey(record.mint)
const Y = new PublicKey(record.pair.mint)
const binStep = Number(arg("bin-step", "25"))
const feeBps = Number(arg("fee-bps", "100"))
const widthBins = Number(arg("width-bins", "20"))
const seedSol = Number(arg("seed-sol", "0.03"))

async function decimals(mint: PublicKey) {
  const info = await connection.getParsedAccountInfo(mint)
  return (info.value?.data as { parsed: { info: { decimals: number } } }).parsed.info.decimals
}
async function balanceOf(mint: PublicKey) {
  const res = await connection.getParsedTokenAccountsByOwner(me, { mint })
  return res.value.reduce((a, v) => a + BigInt(v.account.data.parsed.info.tokenAmount.amount as string), 0n)
}
async function submit(label: string, tx: Transaction, signers: Keypair[] = [kp]) {
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
  tx.feePayer = me
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(...signers)
  if (!send) {
    const sim = await connection.simulateTransaction(tx)
    if (sim.value.err) throw new Error(`${label} simulation failed: ${JSON.stringify(sim.value.err)} ${sim.value.logs?.slice(-4).join(" | ")}`)
    console.log(`${label}: simulation OK`)
    return null
  }
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 })
  const conf = await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed")
  if (conf.value.err) throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}`)
  console.log(`${label}: https://solscan.io/tx/${sig}`)
  return sig
}

const [xDec, yDec] = [await decimals(X), await decimals(Y)]
console.log(`pair ${record.symbol}/${record.pair.symbol}: ${X.toBase58()} (${xDec} dp) / ${Y.toBase58()} (${yDec} dp)`)

// 1. Seed the wallet with NVDAx, then COAT, through Jupiter.
let yHeld = await balanceOf(Y)
if (yHeld === 0n) {
  console.log(`buying ${record.pair.symbol} with ${seedSol} SOL`)
  const r = await jupiterSwap({ inputMint: SOL_MINT, outputMint: Y.toBase58(), amount: BigInt(Math.round(seedSol * 1e9)), dry: !send })
  yHeld = send ? await balanceOf(Y) : r.outAmount
}
let xHeld = await balanceOf(X)
if (xHeld === 0n && yHeld > 0n) {
  console.log(`buying ${record.symbol} with half the ${record.pair.symbol}`)
  try {
    const r = await jupiterSwap({ inputMint: Y.toBase58(), outputMint: X.toBase58(), amount: yHeld / 2n, dry: !send })
    xHeld = send ? await balanceOf(X) : r.outAmount
    yHeld = send ? await balanceOf(Y) : yHeld / 2n
  } catch (err) {
    console.log(`  could not buy ${record.symbol} yet (${err instanceof Error ? err.message : err}); the position will be ${record.pair.symbol}-only`)
  }
}

// 2. Price: NVDAx per COAT, from what Jupiter paid, else a quote.
let price: number
if (xHeld > 0n && yHeld > 0n) {
  price = Number(yHeld) / 10 ** yDec / (Number(xHeld) / 10 ** xDec)
} else {
  const q = (await (await fetch(`https://api.jup.ag/price/v3?ids=${X.toBase58()},${Y.toBase58()}`)).json()) as Record<string, { usdPrice: number }>
  if (!q[X.toBase58()] || !q[Y.toBase58()]) throw new Error("No price for the pair yet; buy some of the token first")
  price = q[X.toBase58()].usdPrice / q[Y.toBase58()].usdPrice
}
const activeId = DLMM.getBinIdFromPrice(Number(DLMM.getPricePerLamport(xDec, yDec, price)), binStep, false)
console.log(`price ${price.toExponential(4)} ${record.pair.symbol} per ${record.symbol} -> active bin ${activeId}`)

// 3. Create the pair if it doesn't exist.
let pool = await DLMM.getCustomizablePermissionlessLbPairIfExists(connection, X, Y)
let createTx: string | null = null
if (!pool) {
  const tx = await DLMM.createCustomizablePermissionlessLbPair2(connection, new BN(binStep), X, Y, new BN(activeId), new BN(feeBps), ActivationType.Timestamp, false, me)
  createTx = await submit("create DLMM pair", tx)
  if (!send) {
    console.log("Dry run. Re-run with --send to create the pool and add liquidity.")
    process.exit(0)
  }
  pool = await DLMM.getCustomizablePermissionlessLbPairIfExists(connection, X, Y)
}
if (!pool) throw new Error("Pool was not created")
console.log(`pool ${pool.toBase58()}`)

// 4. Two-sided (or NVDAx-only) liquidity around the active bin.
const dlmm = await DLMM.create(connection, pool)
const active = await dlmm.getActiveBin()
const position = Keypair.generate()
const txs = await dlmm.initializePositionAndAddLiquidityByStrategy({
  positionPubKey: position.publicKey,
  user: me,
  totalXAmount: new BN(xHeld.toString()),
  totalYAmount: new BN(yHeld.toString()),
  strategy: {
    minBinId: xHeld > 0n ? active.binId - widthBins : active.binId - widthBins * 2,
    maxBinId: xHeld > 0n ? active.binId + widthBins : active.binId,
    strategyType: StrategyType.Spot,
  },
  slippage: 1,
})
let liquidityTx: string | null = null
for (const [i, t] of (Array.isArray(txs) ? txs : [txs]).entries()) liquidityTx = await submit(`add liquidity ${i + 1}`, t, [kp, position])

writeRecord({
  ...record,
  meteora: { pool: pool.toBase58(), createTx, position: position.publicKey.toBase58(), liquidityTx, at: new Date().toISOString() },
})
console.log(`Meteora pool ${pool.toBase58()} saved to the record.`)

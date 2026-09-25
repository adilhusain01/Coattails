/**
 * Launch the Coattails agent token through Clawpump, with its bonding curve priced in a tokenized
 * stock (NVDAx by default). Mainnet. Runs as a dry run (quote only) unless --pay is given.
 *
 * Flow (Clawpump self-funded launch): preflight quote -> pay the exact lamports -> resubmit with the
 * payment signature. Creator fees (75% of trading fees) go to the launch wallet.
 *
 * Usage: npx tsx --env-file=.env scripts/launch/token.ts [--pair NVDAx] [--pay]
 */
import { address, lamports } from "@solana/kit"
import { getTransferSolInstruction } from "@solana-program/system"
import { tokenBySymbol } from "../../src/server/registry"
import { arg, clawpump, flag, launchClient, readRecord, writeRecord, type AgentTokenRecord } from "./common"

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://coattails.adilhusain.xyz"
const pairSymbol = arg("pair", "NVDAx")!
const pay = flag("pay")

const existing = readRecord()
if (existing?.mint) {
  console.log(`Already launched: ${existing.symbol} ${existing.mint}. Delete ${"src/server/data/agent-token.json"} to launch again.`)
  process.exit(0)
}

const client = await launchClient()
const wallet = client.payer.address
const balance = Number((await client.rpc.getBalance(wallet).send()).value) / 1e9
console.log(`launch wallet ${wallet}: ${balance} SOL`)

type Pair = { symbol: string; mint: string; name: string; decimals: number }
const pairs = await clawpump<{ assets?: Pair[] }>("/pump-pairs")
if (pairs.status !== 200 || !pairs.body.assets) throw new Error(`pump-pairs ${pairs.status}: ${JSON.stringify(pairs.body).slice(0, 300)}`)
// Clawpump lists xStocks by their underlying ticker ("NVDA" for NVDAx), so match on the mint.
const wanted = tokenBySymbol(pairSymbol)?.mint
const match = pairs.body.assets.find((a) => a.mint === wanted || a.symbol.toLowerCase() === pairSymbol.toLowerCase())
const pair = match ? { ...match, symbol: wanted && match.mint === wanted ? pairSymbol : match.symbol } : undefined
if (!pair) {
  console.log("Allowed pairs:", pairs.body.assets.map((a) => a.symbol).join(", "))
  throw new Error(`${pairSymbol} is not an allowed Clawpump pair`)
}
console.log(`pair ${pair.symbol} (${pair.name}) ${pair.mint}`)

const body = {
  name: "Coattails Agent",
  symbol: "COAT",
  description:
    "The agent behind Coattails: it reads US House trade reports and SEC Form 4 filings, writes a receipt for each on Solana, and mirrors the trades into tokenized stocks in followers' own wallets. Creator fees pay for its reads and transaction fees. " +
    SITE,
  imageUrl: `${SITE}/agent-token.png`,
  agentId: "coattails-agent",
  agentName: "Coattails",
  walletAddress: wallet,
  pumpQuoteMint: pair.mint,
  pumpCreatorFeeBps: 100,
}

type Preflight = {
  payment?: { amountLamports: number; payTo: string; validForSeconds?: number }
  retryWith?: { preflightToken: string }
  error?: string
}
const pre = await clawpump<Preflight>("/launch/self-funded", { method: "POST", body: JSON.stringify({ ...body, preflight: true }) })
if (pre.status !== 200 || !pre.body.payment || !pre.body.retryWith) {
  throw new Error(`preflight ${pre.status}: ${JSON.stringify(pre.body).slice(0, 400)}`)
}
const { amountLamports, payTo } = pre.body.payment
console.log(`quote: pay ${amountLamports / 1e9} SOL to ${payTo} (valid ${pre.body.payment.validForSeconds ?? "?"}s)`)
if (!pay) {
  console.log("Dry run. Re-run with --pay to launch.")
  process.exit(0)
}
if (balance * 1e9 < amountLamports + 20_000) throw new Error("Not enough SOL in the launch wallet for the quoted fee")

const paid = await client.sendTransaction([
  getTransferSolInstruction({ source: client.payer, destination: address(payTo), amount: lamports(BigInt(amountLamports)) }),
])
const paymentTx = paid.context.signature as string
console.log(`paid: https://solscan.io/tx/${paymentTx}`)

type Launched = { mintAddress?: string; txHash?: string; pumpUrl?: string; earnings?: { dashboard?: string }; error?: string }
const res = await clawpump<Launched>("/launch/self-funded", {
  method: "POST",
  body: JSON.stringify({ ...body, txSignature: paymentTx, preflightToken: pre.body.retryWith.preflightToken }),
})
console.log(`launch ${res.status}`, JSON.stringify(res.body).slice(0, 600))
if (!res.body.mintAddress) throw new Error("Launch did not return a mint. The payment tx is above; contact Clawpump with it.")

const record: AgentTokenRecord = {
  name: body.name,
  symbol: body.symbol,
  mint: res.body.mintAddress,
  wallet,
  pair: { symbol: pair.symbol, mint: pair.mint, decimals: pair.decimals },
  clawpump: {
    agentId: body.agentId,
    launchTx: res.body.txHash ?? "",
    paymentTx,
    pumpUrl: res.body.pumpUrl,
    // The API's earnings.dashboard link 404s; the token page shows price and creator fees.
    dashboard: `https://clawpump.tech/token/${res.body.mintAddress}`,
    at: new Date().toISOString(),
  },
}
writeRecord(record)
console.log(`Launched ${record.symbol}: ${record.mint}`)

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { count, eq, isNotNull } from "drizzle-orm"
import type { AgentTokenRecord } from "../../scripts/launch/common"
import { db, schema } from "./db"

export type { AgentTokenRecord }

/** The mainnet launch record written by scripts/launch/*, or null before the launch. */
export function agentToken(): AgentTokenRecord | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "src/server/data/agent-token.json"), "utf8")) as AgentTokenRecord
  } catch {
    return null
  }
}

export type TokenMarket = {
  priceUsd: number | null
  liquidityUsd: number | null
  pairPriceUsd: number | null
  /** Where the COAT price came from: Jupiter's index, or the Meteora pool's reserves. */
  priceSource: "jupiter" | "pool" | null
  reserves: { token: number; pair: number } | null
  /** USD value of what sits in the Meteora pool itself. */
  poolValueUsd: number | null
}

const MAINNET_RPC = process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com"

async function vaultBalance(account: string): Promise<number | null> {
  const res = await fetch(MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountBalance", params: [account] }),
    next: { revalidate: 60 },
  })
  const body = (await res.json()) as { result?: { value: { uiAmount: number | null } } }
  return body.result?.value.uiAmount ?? null
}

/**
 * COAT's price and liquidity. Jupiter prices the token once it has indexed enough trading; until
 * then the price comes from the Meteora pool: its NVDAx reserve over its COAT reserve, times the
 * live NVDAx price.
 */
export async function tokenMarket(record: AgentTokenRecord): Promise<TokenMarket> {
  const empty: TokenMarket = { priceUsd: null, liquidityUsd: null, pairPriceUsd: null, priceSource: null, reserves: null, poolValueUsd: null }
  if (!record.mint) return empty
  try {
    const res = await fetch(`https://api.jup.ag/price/v3?ids=${record.mint},${record.pair.mint}`, { next: { revalidate: 60 } })
    const body = (await res.json()) as Record<string, { usdPrice?: number; liquidity?: number } | undefined>
    const pairPriceUsd = body[record.pair.mint]?.usdPrice ?? null
    const vaults = record.meteora?.vaultA && record.meteora?.vaultB
      ? await Promise.all([vaultBalance(record.meteora.vaultA), vaultBalance(record.meteora.vaultB)])
      : null
    const reserves = vaults && vaults[0] != null && vaults[1] != null ? { token: vaults[0], pair: vaults[1] } : null
    const jupPrice = body[record.mint]?.usdPrice ?? null
    const poolPrice = reserves && pairPriceUsd && reserves.token > 0 ? (reserves.pair / reserves.token) * pairPriceUsd : null
    const priceUsd = jupPrice ?? poolPrice
    const poolValueUsd = reserves && pairPriceUsd && priceUsd ? reserves.pair * pairPriceUsd + reserves.token * priceUsd : null
    return {
      priceUsd,
      liquidityUsd: body[record.mint]?.liquidity ?? null,
      poolValueUsd,
      pairPriceUsd,
      priceSource: jupPrice != null ? "jupiter" : poolPrice != null ? "pool" : null,
      reserves,
    }
  } catch {
    return empty
  }
}

/** What the agent has paid for so far: every one of these is a transaction or a model read. */
export async function agentWork() {
  const [receipts, fills, follows, reads] = await Promise.all([
    db.select({ n: count() }).from(schema.filings).where(isNotNull(schema.filings.receiptSig)),
    db.select({ n: count() }).from(schema.executions).where(eq(schema.executions.status, "confirmed")),
    db.select({ n: count() }).from(schema.follows).where(isNotNull(schema.follows.approveSig)),
    db.select({ n: count() }).from(schema.filings).where(eq(schema.filings.readBy, "sarvam")),
  ])
  return { receipts: receipts[0].n, fills: fills[0].n, follows: follows[0].n, reads: reads[0].n }
}

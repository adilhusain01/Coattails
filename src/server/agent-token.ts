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

export type TokenMarket = { priceUsd: number | null; liquidityUsd: number | null; pairPriceUsd: number | null }

export async function tokenMarket(record: AgentTokenRecord): Promise<TokenMarket> {
  if (!record.mint) return { priceUsd: null, liquidityUsd: null, pairPriceUsd: null }
  try {
    const res = await fetch(`https://api.jup.ag/price/v3?ids=${record.mint},${record.pair.mint}`, { next: { revalidate: 60 } })
    const body = (await res.json()) as Record<string, { usdPrice?: number; liquidity?: number } | undefined>
    return {
      priceUsd: body[record.mint]?.usdPrice ?? null,
      liquidityUsd: body[record.mint]?.liquidity ?? null,
      pairPriceUsd: body[record.pair.mint]?.usdPrice ?? null,
    }
  } catch {
    return { priceUsd: null, liquidityUsd: null, pairPriceUsd: null }
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

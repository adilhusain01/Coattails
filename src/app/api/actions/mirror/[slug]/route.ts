import {
  createActionHeaders,
  type ActionGetResponse,
  type ActionPostRequest,
  type ActionPostResponse,
} from "@solana/actions"
import { address } from "@solana/kit"
import { eq } from "drizzle-orm"
import type { NextRequest } from "next/server"
import { db, schema } from "@/server/db"
import { isWallet } from "@/server/http"
import { buildApproveTxPresigned, cluster } from "@/server/solana/agent"

const headers = createActionHeaders({ chainId: cluster === "devnet" ? "devnet" : "mainnet", actionVersion: "2.4" })

const PRESETS = [
  { per: 10, budget: 50 },
  { per: 25, budget: 100 },
]

function error(message: string, status = 400) {
  return Response.json({ message }, { status, headers })
}

async function findSource(slug: string) {
  return db.query.sources.findFirst({ where: eq(schema.sources.slug, slug) })
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/actions/mirror/[slug]">) {
  const { slug } = await ctx.params
  const source = await findSource(slug)
  if (!source) return error("Unknown member", 404)
  const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
  const short = source.kind === "house" ? source.name.split(" ").at(-1) : source.name
  const who = source.kind === "house" ? `Rep. ${source.name}` : `${source.name}, ${source.affiliation} of ${source.seat}`
  const body: ActionGetResponse = {
    type: "action",
    icon: source.photoUrl ?? `${origin}/icon.svg`,
    title: `Mirror ${short} on Solana`,
    description: `Copy every stock trade ${who} discloses into tokenized stocks in your own wallet. You approve a USDC budget; Coattails pays the fees and every fill links to the public filing it copies.`,
    label: `Mirror ${short}`,
    links: {
      actions: [
        ...PRESETS.map((p) => ({
          type: "transaction" as const,
          label: `$${p.per} per trade`,
          href: `${origin}/api/actions/mirror/${slug}?per=${p.per}&budget=${p.budget}`,
        })),
        {
          type: "transaction" as const,
          label: "Mirror",
          href: `${origin}/api/actions/mirror/${slug}?per={per}&budget={budget}`,
          parameters: [
            { type: "number", name: "per", label: "USDC per trade", required: true, min: 1, max: 1000 },
            { type: "number", name: "budget", label: "Total budget in USDC", required: true, min: 1, max: 100000 },
          ],
        },
      ],
    },
  }
  return Response.json(body, { headers })
}

export const OPTIONS = async () => new Response(null, { headers })

export async function POST(req: NextRequest, ctx: RouteContext<"/api/actions/mirror/[slug]">) {
  const { slug } = await ctx.params
  const source = await findSource(slug)
  if (!source) return error("Unknown member", 404)
  const per = Number(req.nextUrl.searchParams.get("per"))
  const budget = Number(req.nextUrl.searchParams.get("budget"))
  if (!(per >= 1 && per <= 1000) || !(budget >= per && budget <= 100_000)) {
    return error("Choose a per-trade amount from $1 to $1,000 and a budget at least that large")
  }
  const { account } = (await req.json()) as ActionPostRequest
  if (!isWallet(account)) return error("Invalid account")

  try {
    const transaction = await buildApproveTxPresigned(address(account), budget, `coattails:follow|${slug}|${per}|blink`)
    // Recorded now; the worker checks the on-chain allowance before every fill, so an unsent
    // approval simply produces no trades.
    await db
      .insert(schema.follows)
      .values({ wallet: account, sourceId: source.id, perTradeUsd: per, active: true, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.follows.wallet, schema.follows.sourceId],
        set: { perTradeUsd: per, active: true, createdAt: new Date() },
      })
    const body: ActionPostResponse = {
      type: "transaction",
      transaction,
      message: `Approve up to $${budget} USDC. Coattails mirrors ${source.name} at $${per} per trade.`,
    }
    return Response.json(body, { headers })
  } catch (err) {
    return error(err instanceof Error ? err.message : "Could not build the transaction", 500)
  }
}

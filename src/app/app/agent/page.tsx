import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { shortAddress, usd } from "@/lib/format"
import { agentToken, agentWork, tokenMarket } from "@/server/agent-token"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "The agent's token" }

const solscan = (path: string) => `https://solscan.io/${path}`

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm hover:underline">
      {children} <ArrowSquareOut aria-hidden />
    </a>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5 border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export default async function AgentPage() {
  const record = agentToken()
  const [market, work] = await Promise.all([record ? tokenMarket(record) : null, agentWork()])
  const launched = !!record?.mint

  return (
    <div className="grid gap-8 pt-8">
      <header className="grid max-w-3xl gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">The agent&apos;s token</h1>
          <Badge variant={launched ? "secondary" : "outline"}>{launched ? "Live on mainnet" : "Not launched yet"}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
          Coattails pays for every filing it reads and every transaction it sends, so followers never need SOL. Those costs
          are covered by COAT, the agent&apos;s own token. It was launched on Clawpump with its price curve set in a
          tokenized stock ({record?.pair.symbol ?? "NVDAx"}), and it trades in a Meteora pool against the same stock.
          Clawpump pays 75% of COAT&apos;s trading fees to the agent.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Filings read" value={String(work.reads)} hint="Sarvam AI reads" />
        <Stat label="Receipts written" value={String(work.receipts)} hint="Memo transactions" />
        <Stat label="Follows, gas paid" value={String(work.follows)} hint="Users paid no fee" />
        <Stat label="Fills" value={String(work.fills)} hint="Buys and exits" />
      </section>
      <p className="-mt-5 text-xs text-muted-foreground">Everything above was paid for by the agent. On devnet the fees are test SOL.</p>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">COAT on Clawpump</CardTitle>
            <CardDescription className="text-sm">
              A pump.fun curve priced in {record?.pair.symbol ?? "NVDAx"} instead of SOL, launched through Clawpump&apos;s
              agent launchpad.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {launched && record ? (
              <>
                <dl className="grid gap-1 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Mint</dt>
                    <dd className="font-mono">{shortAddress(record.mint!, 6)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Price</dt>
                    <dd className="font-mono tabular-nums">
                      {market?.priceUsd != null ? `$${market.priceUsd.toPrecision(3)}` : "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Liquidity</dt>
                    <dd className="font-mono tabular-nums">{market?.liquidityUsd != null ? usd(market.liquidityUsd, 0) : "-"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Paired with</dt>
                    <dd className="font-mono">
                      {record.pair.symbol} {market?.pairPriceUsd != null ? `(${usd(market.pairPriceUsd)})` : ""}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <Ext href={solscan(`token/${record.mint}`)}>Solscan</Ext>
                  {record.clawpump?.pumpUrl && <Ext href={record.clawpump.pumpUrl}>pump.fun</Ext>}
                  {record.clawpump?.dashboard && <Ext href={record.clawpump.dashboard}>Clawpump earnings</Ext>}
                  {record.clawpump?.launchTx && <Ext href={solscan(`tx/${record.clawpump.launchTx}`)}>Launch transaction</Ext>}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                The launch script is ready and runs on mainnet: it checks the stock pair with Clawpump, pays the quoted
                launch fee (about 0.01 SOL) and records the new token here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">COAT / {record?.pair.symbol ?? "NVDAx"} on Meteora</CardTitle>
            <CardDescription className="text-sm">
              A Meteora DLMM pool, so COAT can be traded directly against the tokenized stock, with liquidity on both
              sides of the price.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {record?.meteora ? (
              <>
                <dl className="grid gap-1 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Pool</dt>
                    <dd className="font-mono">{shortAddress(record.meteora.pool, 6)}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <Ext href={`https://app.meteora.ag/dlmm/${record.meteora.pool}`}>Meteora</Ext>
                  <Ext href={solscan(`account/${record.meteora.pool}`)}>Solscan</Ext>
                  {record.meteora.liquidityTx && <Ext href={solscan(`tx/${record.meteora.liquidityTx}`)}>Liquidity transaction</Ext>}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Created right after the launch: the agent buys a little {record?.pair.symbol ?? "NVDAx"} and COAT, opens
                the pool at the market price and adds liquidity on both sides.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

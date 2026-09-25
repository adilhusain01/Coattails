import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { shortAddress, usd } from "@/lib/format"
import { agentToken, agentWork, tokenMarket } from "@/server/agent-token"
import { livePrices } from "@/server/prices"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "The agent's token" }

const solscan = (path: string) => `https://solscan.io/${path}`

/** The equity feeds the Pyth plan grants; every other stock is priced by Jupiter and Yahoo. */
const PYTH_TICKERS = ["TSLA", "QQQ", "VOO"]

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
  const [market, work, pyth] = await Promise.all([
    record ? tokenMarket(record) : null,
    agentWork(),
    livePrices(PYTH_TICKERS).catch(() => null),
  ])
  const launched = !!record?.mint

  return (
    <div className="grid gap-8 pt-8">
      <header className="grid max-w-3xl gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">The agent&apos;s token</h1>
          <Badge variant={launched ? "secondary" : "outline"}>{launched ? "Live on mainnet" : "Not launched yet"}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
          Coattails pays the network fee on every follow, receipt and fill, and it pays for the model that reads each filing.
          COAT is how it plans to pay for that. Clawpump launched it with a price curve in{" "}
          {record?.pair.symbol ?? "NVDAx"} instead of SOL, it also trades in a Meteora pool against{" "}
          {record?.pair.symbol ?? "NVDAx"}, and Clawpump sends 75% of its trading fees to the agent&apos;s wallet.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Filings read" value={String(work.reads)} hint="House reports, read from the PDF" />
        <Stat label="Receipts written" value={String(work.receipts)} hint="Memo transactions" />
        <Stat label="Follows, gas paid" value={String(work.follows)} hint="Users paid no fee" />
        <Stat label="Fills" value={String(work.fills)} hint="Buys and exits" />
      </section>
      <p className="-mt-5 text-xs text-muted-foreground">
        The agent paid for all of the above. The copy-trading app runs on devnet, so those fees were test SOL.
      </p>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Reading</CardTitle>
            <CardDescription className="text-sm">
              Each House report goes to GPT-6 Luna as a PDF and comes back as one row per trade, checked against a strict
              schema. A scan Luna can&apos;t read cleanly gets a second pass from Gemini 3.8 Flash. Form 4 is XML and is
              parsed directly.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Prices</CardTitle>
            <CardDescription className="text-sm">
              Pyth prices the stocks our plan covers, live and for past closes. Jupiter and Yahoo price the rest.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-1 text-sm">
              {PYTH_TICKERS.map((t) => {
                const q = pyth?.get(t)
                return (
                  <div key={t} className="flex justify-between gap-4">
                    <dt className="font-mono">{t}</dt>
                    <dd className="font-mono tabular-nums">
                      {q ? usd(q.price) : "-"}
                      <span className="ml-1.5 font-sans text-xs text-muted-foreground">
                        {q?.source.startsWith("pyth") ? "Pyth" : q ? "Jupiter, market closed" : ""}
                      </span>
                    </dd>
                  </div>
                )
              })}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Signing</CardTitle>
            <CardDescription className="text-sm">
              The agent signs every transaction as fee payer before your wallet sees it, and sends it only if it is exactly
              the one it built. Receipts and fills are signed by the agent alone and carry the filing&apos;s hash in a memo.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">COAT on Clawpump</CardTitle>
            <CardDescription className="text-sm">
              Launched through Clawpump&apos;s agent launchpad on a pump.fun curve that is priced in{" "}
              {record?.pair.symbol ?? "NVDAx"}, so buying COAT means paying in a tokenized stock.
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
                      {market?.priceSource === "pool" && (
                        <span className="ml-1.5 font-sans text-xs text-muted-foreground">from the Meteora pool</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Liquidity across venues</dt>
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
                  {record.clawpump?.dashboard && <Ext href={record.clawpump.dashboard}>Clawpump</Ext>}
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
              A full-range Meteora DAMM v2 pool holding both tokens, so COAT trades directly against the tokenized
              stock outside the curve too.
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
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">In the pool</dt>
                    <dd className="text-right font-mono tabular-nums">
                      {market?.reserves
                        ? `${market.reserves.token.toLocaleString("en-US", { maximumFractionDigits: 0 })} COAT, ${market.reserves.pair.toFixed(5)} ${record.pair.symbol}`
                        : "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Pool value</dt>
                    <dd className="font-mono tabular-nums">{market?.poolValueUsd != null ? usd(market.poolValueUsd) : "-"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Trading fee</dt>
                    <dd className="font-mono tabular-nums">1%</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <Ext href={`https://app.meteora.ag/dammv2/${record.meteora.pool}`}>Meteora</Ext>
                  <Ext href={solscan(`account/${record.meteora.pool}`)}>Solscan</Ext>
                  {record.meteora.createTx && <Ext href={solscan(`tx/${record.meteora.createTx}`)}>Creation transaction</Ext>}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Created right after the launch: the agent buys a little {record?.pair.symbol ?? "NVDAx"} and COAT, opens a full-range pool
                at the price those buys set, with both tokens deposited.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

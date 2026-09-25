import { ArrowDown, ArrowRight, ArrowSquareOut, FilePdf, Seal, Wallet } from "@phosphor-icons/react/dist/ssr"
import { Card, CardContent } from "@/components/ui/card"
import { explorerTx } from "@/lib/cluster"
import { amountRange, day, lagDays, pct, shortAddress, usd } from "@/lib/format"
import { cn } from "@/lib/utils"

export type WalkthroughExample = {
  name: string
  seat: string | null
  party: string | null
  docId: string
  filingUrl: string
  filedAt: string
  sha256: string | null
  receiptSig: string | null
  ticker: string
  assetName: string
  amountLow: number | null
  amountHigh: number | null
  tradedAt: string
  pxTraded: number
  pxDisclosed: number
  symbol: string
  mint: string
  untokenized: string | null
  tokenCount: number
}

const PER_TRADE = 25
const STOP = 0.15
const HOLD_DAYS = 90

/** "Bloom Energy Corporation Class A Common Stock" -> "Bloom Energy" for running prose. */
export function companyName(asset: string) {
  return asset
    .replace(/\s*\(.*$/, "")
    .replace(/\s*-?\s*(Class [A-Z]\s*)?(Common|Ordinary) (Stock|Shares)$/i, "")
    .replace(/\s*-?\s*Class [A-Z]$/i, "")
    .replace(/,?\s*(Corporation|Corp\.?|Incorporated|Inc\.?|Holdings|Co\.?|Ltd\.?|plc|N\.V\.)$/i, "")
    .trim()
}

const STAGES = ["Trade", "Report", "Read", "Match", "Receipt", "Buy", "Watch", "Sell"]

function Row({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2 odd:bg-bar">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-sm", mono && "font-mono tabular-nums")}>{value}</dd>
    </div>
  )
}

function Stage({ n, title, children, visual }: { n: number; title: string; children: React.ReactNode; visual: React.ReactNode }) {
  return (
    <li className="grid gap-6 border-t py-10 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
      <div className="grid content-start gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm text-stamp tabular-nums">{String(n).padStart(2, "0")}</span>
          <h3 className="text-xl font-bold tracking-tight text-balance">{title}</h3>
        </div>
        <div className="grid gap-3 text-base leading-relaxed text-pretty text-muted-foreground">{children}</div>
      </div>
      <div>{visual}</div>
    </li>
  )
}

/**
 * One real trade followed from the member's purchase to the follower's wallet, with the numbers
 * Coattails actually recorded for it.
 */
export function Walkthrough({ ex }: { ex: WalkthroughExample }) {
  const lag = lagDays(ex.tradedAt, ex.filedAt)
  const moved = ex.pxDisclosed / ex.pxTraded - 1
  const tokens = PER_TRADE / ex.pxDisclosed
  const firstStop = ex.pxDisclosed * (1 - STOP)
  const sellBy = new Date(new Date(ex.filedAt).getTime() + HOLD_DAYS * 86_400_000)
  const who = ex.name.split(" ").at(-1)
  const company = companyName(ex.assetName)

  return (
    <div className="grid gap-10">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-label="The stages of one copied trade">
        {STAGES.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="border bg-card px-2.5 py-1 text-sm">{s}</span>
            {i < STAGES.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />}
          </li>
        ))}
      </ol>

      <ol>
        <Stage
          n={1}
          title={`${ex.name} buys ${company}`}
          visual={
            <Card className="py-0">
              <dl>
                <Row label="Member" value={`${ex.name}${ex.party ? ` (${ex.party})` : ""}`} mono={false} />
                <Row label="Asset" value={ex.assetName} mono={false} />
                <Row label="Transaction" value="Purchase" mono={false} />
                <Row label="Amount" value={amountRange(ex.amountLow, ex.amountHigh)} />
                <Row label="Trade date" value={day(ex.tradedAt)} />
                <Row label="Close that day" value={usd(ex.pxTraded)} />
              </dl>
            </Card>
          }
        >
          <p>
            On {day(ex.tradedAt)}, {ex.name} bought shares of {company} ({ex.ticker}). Nothing is sent to
            Coattails. Members of the House only have to report the trade, and they have up to 45 days to do it.
          </p>
        </Stage>

        <Stage
          n={2}
          title={`The report comes out ${lag} days later`}
          visual={
            <Card className="gap-4">
              <CardContent className="grid gap-4">
                <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>Traded {day(ex.tradedAt)}</span>
                  <span>Reported {day(ex.filedAt)}</span>
                </div>
                <div className="relative h-2 bg-bar" aria-hidden>
                  <div className="absolute inset-y-0 left-0 w-full bg-muted-foreground/30" />
                  <span className="absolute -top-1 left-0 size-4 rounded-full border-2 border-card bg-foreground" />
                  <span className="absolute -top-1 right-0 size-4 rounded-full border-2 border-card bg-stamp" />
                </div>
                <div className="flex items-baseline justify-between font-mono tabular-nums">
                  <span className="text-lg">{usd(ex.pxTraded)}</span>
                  <span className="text-sm text-muted-foreground">{lag} days</span>
                  <span className="text-lg">
                    {usd(ex.pxDisclosed)}{" "}
                    <span className={cn("text-sm", moved >= 0 ? "text-buy" : "text-sell")}>{pct(moved)}</span>
                  </span>
                </div>
              </CardContent>
            </Card>
          }
        >
          <p>
            The Periodic Transaction Report reached the House Clerk&apos;s website on {day(ex.filedAt)}. By then{" "}
            {ex.ticker} had gone from {usd(ex.pxTraded)} to {usd(ex.pxDisclosed)}. A follower buys at the later price,
            and Coattails shows that gap on every filing so you can see what the delay cost.
          </p>
          <p>Coattails checks the House Clerk and the SEC for new reports every minute.</p>
        </Stage>

        <Stage
          n={3}
          title="The agent reads the report"
          visual={
            <div className="grid items-center gap-3 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
              <a
                href={ex.filingUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 border bg-card px-4 py-3 hover:bg-accent"
              >
                <FilePdf className="size-8 text-sell" weight="duotone" aria-hidden />
                <span className="grid">
                  <span className="text-sm font-medium">PTR {ex.docId}.pdf</span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    Open the original <ArrowSquareOut aria-hidden />
                  </span>
                </span>
              </a>
              <ArrowRight className="hidden size-5 text-muted-foreground sm:block" aria-hidden />
              <ArrowDown className="mx-auto size-5 text-muted-foreground sm:hidden" aria-hidden />
              <Card className="py-0">
                <dl>
                  <Row label="Ticker" value={ex.ticker} />
                  <Row label="Side" value="Buy" mono={false} />
                  <Row label="Traded" value={ex.tradedAt.slice(0, 10)} />
                  <Row label="Amount" value={amountRange(ex.amountLow, ex.amountHigh)} />
                </dl>
              </Card>
            </div>
          }
        >
          <p>
            Most reports are typed PDF forms and some are scans of paper, sometimes handwritten. The agent sends the PDF
            itself to GPT-6 Luna, which turns every line into fields a program can act on: who, which stock, buy or sell,
            when and how much. A scan Luna can&apos;t read cleanly gets a second pass from Gemini 3.8 Flash.
          </p>
          <p>Insider reports on SEC Form 4 are already structured, so they skip this step.</p>
        </Stage>

        <Stage
          n={4}
          title={`${ex.ticker} is matched to ${ex.symbol}`}
          visual={
            <Card className="py-0">
              <dl>
                <Row label={ex.ticker} value={<span className="text-buy">{ex.symbol} on Solana</span>} />
                <Row label="Token mint" value={shortAddress(ex.mint, 6)} />
                {ex.untokenized && <Row label={ex.untokenized} value={<span className="text-muted-foreground">not tokenized</span>} />}
              </dl>
            </Card>
          }
        >
          <p>
            {ex.ticker} trades on Solana as {ex.symbol}, one of {ex.tokenCount} US stocks available as tokenized shares
            (xStocks). If a report lists something without a token, such as a private fund, it is shown on the filing and
            marked &quot;not tokenized&quot;. Nothing is bought.
          </p>
        </Stage>

        <Stage
          n={5}
          title="A receipt goes on Solana first"
          visual={
            <Card className="gap-3">
              <CardContent className="grid gap-3">
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">SHA-256 of the PDF</span>
                  <code className="font-mono text-sm break-all">{ex.sha256 ?? "computed when the report is read"}</code>
                </div>
                {ex.receiptSig ? (
                  <a
                    href={explorerTx(ex.receiptSig)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 border border-stamp/50 px-2 py-1 font-mono text-xs text-stamp hover:bg-stamp/10"
                  >
                    <Seal weight="fill" aria-hidden />
                    Receipt {ex.receiptSig.slice(0, 12)}
                    <ArrowSquareOut aria-hidden />
                  </a>
                ) : null}
              </CardContent>
            </Card>
          }
        >
          <p>
            Before buying anything, Coattails writes the report&apos;s fingerprint (its SHA-256 hash) to Solana. Anyone can
            hash the PDF and compare. Every purchase made because of this report points back to this receipt, so you can
            always check which public document a trade copied.
          </p>
        </Stage>

        <Stage
          n={6}
          title="Your copy is bought"
          visual={
            <Card className="gap-4">
              <CardContent className="grid gap-3">
                <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
                  <div className="border bg-card p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Wallet aria-hidden /> Your wallet
                    </div>
                    <p className="font-mono text-sm tabular-nums">-{usd(PER_TRADE)} USDC</p>
                  </div>
                  <ArrowRight className="mx-auto hidden size-4 text-muted-foreground sm:block" aria-hidden />
                  <div className="border border-dashed p-3">
                    <p className="text-xs text-muted-foreground">Coattails</p>
                    <p className="text-sm">spends within your limit</p>
                  </div>
                  <ArrowRight className="mx-auto hidden size-4 text-muted-foreground sm:block" aria-hidden />
                  <div className="border bg-card p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Wallet aria-hidden /> Your wallet
                    </div>
                    <p className="font-mono text-sm tabular-nums">
                      +{tokens.toFixed(4)} {ex.symbol}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {usd(PER_TRADE)} at {usd(ex.pxDisclosed)}, the price on the day of the report.
                </p>
              </CardContent>
            </Card>
          }
        >
          <p>
            You don&apos;t copy {who}&apos;s dollar amount. You choose your own, here {usd(PER_TRADE, 0)} per trade.
            Coattails spends it from the USDC you allowed and the {ex.symbol} goes straight into your wallet. Your money is
            never pooled with anyone else&apos;s.
          </p>
        </Stage>

        <Stage
          n={7}
          title="Then it watches the position"
          visual={
            <Card className="py-0">
              <dl>
                <Row label={`Trailing stop, ${Math.round(STOP * 100)}%`} value={`starts at ${usd(firstStop)}, rises with the price`} mono={false} />
                <Row label={`Time limit, ${HOLD_DAYS} days`} value={`sells by ${day(sellBy)}`} mono={false} />
                <Row label="Reported sale" value={`sells when ${who} reports selling ${ex.ticker}`} mono={false} />
              </dl>
            </Card>
          }
        >
          <p>
            A member can sell weeks before anyone finds out, so every position carries exit rules you set when you start
            following. Every 20 seconds Coattails checks them against the live price.
          </p>
          <p>
            Whichever comes first sells the position back to USDC: the trailing stop, the time limit, or a report that{" "}
            {who} sold. A reported sale only sells what was bought because of {who}, even if you follow someone else who
            owns {ex.ticker} too.
          </p>
        </Stage>
      </ol>
    </div>
  )
}

import {
  ArrowRight,
  ArrowSquareOut,
  Clock,
  Coins,
  FileText,
  Globe,
  HandCoins,
  MagnifyingGlass,
  Receipt,
  ShieldCheck,
  Timer,
  TrendDown,
  XCircle,
} from "@phosphor-icons/react/dist/ssr"
import type { Metadata } from "next"
import Link from "next/link"
import { FilingReceipt } from "@/components/filing-receipt"
import { ExitDiagram } from "@/components/landing/exit-diagram"
import { companyName, Walkthrough, type WalkthroughExample } from "@/components/landing/walkthrough"
import { ThemeToggle } from "@/components/theme-toggle"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { agentToken } from "@/server/agent-token"
import { latestFilings, sourceProfile } from "@/server/queries"
import { tokenBySymbol, tokenCount } from "@/server/registry"
import type { FilingView } from "@/server/queries"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: { absolute: "Coattails: copy what Congress trades" },
}

const EXITS = [
  {
    icon: TrendDown,
    title: "Trailing stop",
    body: "Sells if the price drops a set share below the highest price since you bought. Pick 10%, 15% or 25%, or turn it off.",
  },
  {
    icon: Timer,
    title: "Time limit",
    body: "Sells after 30, 90 or 180 days if no sale has been reported by then.",
  },
  {
    icon: Receipt,
    title: "Reported sales",
    body: "When a report shows the member sold, Coattails sells what it bought for you from that member, and only that.",
  },
  {
    icon: MagnifyingGlass,
    title: "The delay, on every filing",
    body: "Each filing shows how far the stock moved between the trade and the report, so you can judge a member before you follow.",
  },
]

const PERMISSIONS = [
  {
    icon: HandCoins,
    title: "Spend up to your budget",
    body: "When you follow someone you approve a budget, say $100 of USDC. Coattails can spend up to that on the stocks they buy, and nothing more.",
  },
  {
    icon: ShieldCheck,
    title: "Sell what it bought for you",
    body: "After the first purchase of a stock, one more signature lets Coattails sell that stock when an exit rule fires. Your other tokens stay out of reach.",
  },
  {
    icon: XCircle,
    title: "Take it back anytime",
    body: "Revoke either permission from Coattails or from any wallet app. The stocks you hold stay in your wallet.",
  },
]

const SOLANA = [
  { icon: Clock, title: "Nights and weekends", body: "Tokenized stocks trade outside market hours, so a report published on Friday night is copied on Friday night." },
  { icon: Coins, title: "Small amounts", body: "Fees are a fraction of a cent, which makes a $10 copy worth doing." },
  { icon: Globe, title: "No brokerage account", body: "A Solana wallet is all you need, from any country where tokenized stocks are offered." },
  { icon: ShieldCheck, title: "A public record", body: "Every receipt and every purchase is a transaction anyone can look up." },
]

const FAQ = [
  {
    q: "Can people in the US use it?",
    a: "No. Tokenized stocks are offered only to people outside the US, and Coattails follows the same rule.",
  },
  {
    q: "Do I get the same price the member got?",
    a: "No. You buy when the report comes out, often weeks after the trade, at that day's price. Every filing on Coattails shows how far the stock moved in between, so you can judge that before you follow anyone.",
  },
  {
    q: "Do I copy their dollar amount?",
    a: "No. You set your own amount per trade and a total budget. A member's $1 million purchase becomes, say, a $25 purchase for you.",
  },
  {
    q: "What if the stock isn't available on Solana?",
    a: "The trade still shows on the filing, marked not tokenized, and nothing is bought. About 950 US stocks are available as tokenized shares today.",
  },
  {
    q: "How late are the reports?",
    a: "House members have up to 45 days to report a trade. In the filings we have read, the typical gap is about a month. Insider purchases filed on SEC Form 4 arrive within two business days.",
  },
  {
    q: "What if a member sells right before a drop?",
    a: "You would only find out when the report comes out, possibly weeks later. The trailing stop and time limit exist for that gap. You set both when you start following someone, and the agent checks them every minute.",
  },
  {
    q: "Does Coattails hold my money?",
    a: "No. It holds an allowance on your USDC that you can revoke. What it buys goes straight to your wallet, and it can sell only the positions it bought for you, after you allow it.",
  },
  {
    q: "Is this running with real money?",
    a: "The copy-trading runs on Solana devnet with test USDC and live stock prices, so anyone can try it without risking money. On mainnet the only change is that each purchase goes through a Jupiter swap into the real tokenized stock. The agent's token, COAT, and its Meteora pool are already live on mainnet.",
  },
  {
    q: "Who pays the network fees?",
    a: "The agent does, for every follow, receipt and fill. COAT, the agent's own token, is how it plans to pay for that: Clawpump sends 75% of COAT's trading fees to the agent's wallet. COAT is live on mainnet, priced in NVDAx, with a Meteora pool against NVDAx.",
  },
  {
    q: "Is this investment advice?",
    a: "No. Coattails copies public disclosures. Who you follow and how much you put in is your decision.",
  },
]

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-20 gap-8 py-16 sm:py-24">
      <div className="grid max-w-2xl gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h2>
        {intro && <p className="text-base leading-relaxed text-pretty text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

function IconCard({ icon: Icon, title, body, index }: { icon: typeof FileText; title: string; body: string; index?: number }) {
  return (
    <Card className="gap-3">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <Icon className="size-5 text-foreground" weight="duotone" aria-hidden />
          {index != null && <span className="font-mono text-xs text-muted-foreground">{index}</span>}
        </div>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-sm leading-relaxed">{body}</CardDescription>
      </CardHeader>
    </Card>
  )
}

/** The featured filing's first tokenized purchase, shaped for the walkthrough. */
function walkthroughExample(filing: FilingView | undefined, others: FilingView[]): WalkthroughExample | null {
  const trade = filing?.trades.find((t) => t.side === "buy" && t.tokenSymbol && t.ticker && t.pxTraded && t.pxDisclosed)
  const token = trade?.tokenSymbol ? tokenBySymbol(trade.tokenSymbol) : null
  if (!filing || !trade || !token) return null
  const untokenized = [filing, ...others].flatMap((f) => f.trades).find((t) => !t.tokenSymbol)
  return {
    name: filing.source.name,
    seat: filing.source.seat,
    party: filing.source.affiliation,
    docId: filing.docId,
    filingUrl: filing.url,
    filedAt: filing.filedAt,
    sha256: filing.sha256,
    receiptSig: filing.receiptSig,
    ticker: trade.ticker!,
    assetName: trade.assetName.replace(/\s*\((Purchased|Sold)[^)]*\)\s*$/i, ""),
    amountLow: trade.amountLow,
    amountHigh: trade.amountHigh,
    tradedAt: trade.tradedAt,
    pxTraded: trade.pxTraded!,
    pxDisclosed: trade.pxDisclosed!,
    symbol: token.symbol,
    mint: token.mint,
    untokenized: untokenized ? untokenized.assetName.replace(/\s*\(.*$/, "").slice(0, 40) : null,
    tokenCount: tokenCount(),
  }
}

export default async function Landing() {
  const [pelosi, latest] = await Promise.all([sourceProfile("nancy-pelosi"), latestFilings(10)])
  const featured =
    pelosi?.filings.find((f) => f.trades.some((t) => t.tokenSymbol)) ??
    latest.find((f) => f.kind === "house_ptr" && f.trades.some((t) => t.tokenSymbol)) ??
    latest[0]
  const example = walkthroughExample(featured, latest)
  const coat = agentToken()

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-1 focus:ring-ring">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Coattails
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#exits" className="hover:text-foreground">
              Exits
            </a>
            <a href="#custody" className="hover:text-foreground">
              Your funds
            </a>
            <a href="#faq" className="hover:text-foreground">
              Questions
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm">
              <Link href="/app">Open the app</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <section className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="grid gap-6">
            <h1 className="text-5xl leading-[1.02] font-bold tracking-tight text-balance sm:text-7xl">
              Copy what Congress trades.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
              Members of the House have to report their stock trades. Coattails reads each report the day it is
              published and buys the same stocks for you as tokenized shares on Solana, in your own wallet. It works
              outside the US and starts at $10.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/app">
                  Open the app
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/app/demo">Watch the live demo</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {tokenCount()} US stocks are available as tokenized shares. Insider purchases are included too.
            </p>
          </div>
          {featured && (
            <div className="grid gap-2">
              <FilingReceipt
                filing={featured}
                compact
                action={
                  <Button asChild size="sm">
                    <Link href={`/app/p/${featured.source.slug}`}>Mirror {featured.source.name.split(" ").at(-1)}</Link>
                  </Button>
                }
              />
              <p className="text-xs text-muted-foreground">
                A real filing, as the agent read it. The prices show how far each stock moved before the report came out.
              </p>
            </div>
          )}
        </section>

        <Separator />

        <section className="grid gap-4 py-16 sm:grid-cols-[1fr_2fr] sm:py-20">
          <h2 className="text-sm font-semibold">Why this exists</h2>
          <p className="text-xl leading-relaxed text-pretty sm:text-2xl">
            Autopilot manages $1.3 billion for people who copy politicians&apos; trades, and about $400 million of that
            follows Nancy Pelosi. It needs a US brokerage account. Tokenized stocks on Solana are sold only outside the
            US. Coattails is the version for everyone Autopilot can&apos;t serve.
          </p>
        </section>

        <Separator />

        {example && (
          <>
            <Section
              id="how"
              title="Follow one trade from the report to your wallet"
              intro={`This is a real one. ${example.name} reported buying ${companyName(example.assetName)} (${example.ticker}), and these are the numbers Coattails recorded for it. Every report goes through the same stages.`}
            >
              <Walkthrough ex={example} />
            </Section>

        <Separator />
          </>
        )}

        <Section
          id="exits"
          title="Protection for the reporting delay"
          intro="A member can sell weeks before the report shows it. So every position you hold through Coattails has its own exit rules, checked against the live price every 20 seconds."
        >
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="gap-4">
              <CardHeader>
                <CardTitle className="text-sm">A trailing stop in practice</CardTitle>
                <CardDescription className="text-sm">
                  The stop rises with the price and never falls. When the price drops through it, the agent sells.
                </CardDescription>
              </CardHeader>
              <div className="px-(--card-spacing)">
                <ExitDiagram />
              </div>
            </Card>
            <div className="grid gap-4 sm:grid-cols-2">
              {EXITS.map((e) => (
                <IconCard key={e.title} {...e} />
              ))}
            </div>
          </div>
        </Section>

        <Separator />

        <Section
          id="custody"
          title="Two permissions, both in your wallet"
          intro="Coattails never takes custody of your money. It acts through permissions your wallet grants, each with a limit you set."
        >
          <div className="grid gap-4 md:grid-cols-3">
            {PERMISSIONS.map((p) => (
              <IconCard key={p.title} {...p} />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Coattails pays the network fee on every transaction it sends for you, so you don&apos;t need SOL.
          </p>
        </Section>

        <Separator />

        {coat?.mint && (
          <>
            <Section
              id="agent"
              title="The agent pays its own way"
              intro="Reading filings and paying every network fee costs the agent money. Its own token is how it plans to cover that, and the token and its pool are already live on Solana mainnet."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="gap-3">
                  <CardHeader className="gap-2">
                    <CardTitle className="text-sm">COAT, launched on Clawpump</CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      Its price curve is set in {coat.pair.symbol} instead of SOL, so buying COAT means paying in a tokenized
                      stock. Clawpump sends 75% of its trading fees to the agent.
                    </CardDescription>
                  </CardHeader>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 px-(--card-spacing) text-sm">
                    {coat.clawpump?.pumpUrl && (
                      <a href={coat.clawpump.pumpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        pump.fun <ArrowSquareOut aria-hidden />
                      </a>
                    )}
                    <a href={`https://solscan.io/token/${coat.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      Solscan <ArrowSquareOut aria-hidden />
                    </a>
                  </div>
                </Card>
                <Card className="gap-3">
                  <CardHeader className="gap-2">
                    <CardTitle className="text-sm">COAT / {coat.pair.symbol} on Meteora</CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      A Meteora DAMM v2 pool holding both tokens, so COAT also trades directly against the stock.
                    </CardDescription>
                  </CardHeader>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 px-(--card-spacing) text-sm">
                    {coat.meteora?.pool && (
                      <a href={`https://app.meteora.ag/dammv2/${coat.meteora.pool}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        Meteora <ArrowSquareOut aria-hidden />
                      </a>
                    )}
                    <Link href="/app/agent" className="hover:underline">
                      Agent page
                    </Link>
                  </div>
                </Card>
              </div>
            </Section>

            <Separator />
          </>
        )}

        <Section id="solana" title="Why it runs on Solana">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SOLANA.map((s) => (
              <IconCard key={s.title} {...s} />
            ))}
          </div>
        </Section>

        <Separator />

        <Section id="faq" title="Questions">
          <Accordion type="single" collapsible className="max-w-3xl">
            {FAQ.map((f) => (
              <AccordionItem key={f.q} value={f.q}>
                <AccordionTrigger className="text-base">{f.q}</AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>

        <section className="my-16 grid gap-6 bg-primary px-6 py-12 text-primary-foreground sm:px-12 sm:py-16">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-balance sm:text-4xl">Start with $10.</h2>
          <p className="max-w-xl text-base leading-relaxed text-primary-foreground/80">
            Connect a wallet, pick someone to follow, and set your budget and exits. On devnet the app gives you test USDC
            to try it.
          </p>
          <div>
            <Button asChild size="lg" variant="secondary">
              <Link href="/app">
                Open the app
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto grid w-full max-w-6xl gap-3 px-4 py-8 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2 sm:px-6">
          <p>
            Trades come from Periodic Transaction Reports filed with the Clerk of the US House and from SEC Form 4.
            Coattails is not affiliated with Congress, the SEC, or any issuer.
          </p>
          <p>Tokenized stocks are not offered to US persons. Not investment advice.</p>
        </div>
      </footer>
    </>
  )
}

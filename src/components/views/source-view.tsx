"use client"

import { FilingReceipt } from "@/components/filing-receipt"
import { FollowButton } from "@/components/follow-dialog"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { lagDays, pct } from "@/lib/format"
import { useSource, type SourceProfile } from "@/lib/queries"
import { cn } from "@/lib/utils"

function Stat({ label, value, tone }: { label: string; value: string; tone?: "buy" | "sell" }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-mono text-lg tabular-nums", tone === "buy" && "text-buy", tone === "sell" && "text-sell")}>{value}</dd>
    </div>
  )
}

export function SourceView({ slug, profile: initial }: { slug: string; profile: SourceProfile }) {
  const { data: profile = initial } = useSource(slug, initial)
  const { source, filings, followers } = profile
  const trades = filings.flatMap((f) => f.trades)
  const tokenized = trades.filter((t) => t.tokenSymbol)
  const buys = tokenized.filter((t) => t.side === "buy" && t.pxDisclosed && t.pxNow)
  const copy = buys.length ? buys.reduce((a, t) => a + (t.pxNow! / t.pxDisclosed! - 1), 0) / buys.length : null
  const lags = trades.map((t) => lagDays(t.tradedAt, t.disclosedAt))
  const medianLag = lags.length ? [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)] : null

  return (
    <div className="grid gap-8 pt-8">
      <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end">
        <div className="flex items-center gap-4">
          <MemberAvatar source={source} className="size-20" />
          <div className="grid gap-1">
            <h1 className="text-3xl font-bold tracking-tight">{source.name}</h1>
            <PartySeat source={source} />
          </div>
        </div>
        <div className="sm:ml-auto">
          <FollowButton source={source} size="lg" label={`Mirror ${source.name.split(" ").at(-1)}`} />
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label="Trades disclosed" value={String(trades.length)} />
        <Stat label="Tokenized on Solana" value={`${tokenized.length}`} />
        <Stat label="Median filing delay" value={medianLag == null ? "-" : `${medianLag} days`} />
        <Stat label="Copy return since disclosure" value={pct(copy)} tone={copy == null ? undefined : copy >= 0 ? "buy" : "sell"} />
      </dl>
      <p className="-mt-4 text-xs text-muted-foreground">{followers} {followers === 1 ? "wallet mirrors" : "wallets mirror"} this member.</p>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold">Filings</h2>
        {filings.map((f) => (
          <FilingReceipt key={f.id} filing={f} />
        ))}
      </section>
    </div>
  )
}

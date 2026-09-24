import { ArrowSquareOut, Seal } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { explorerTx } from "@/lib/cluster"
import { amountRange, day, lagDays, pct, shortDay, usd } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { FilingView, TradeView } from "@/server/queries"

function Move({ from, to, label }: { from: number | null; to: number | null; label: string }) {
  if (from == null || to == null) return <span className="text-muted-foreground">-</span>
  const change = to / from - 1
  return (
    <span className="whitespace-nowrap" title={label}>
      <span className="text-muted-foreground">{usd(from)}</span>
      <span className="px-1 text-muted-foreground">to</span>
      <span>{usd(to)}</span>
      <span className={cn("ml-1.5", change >= 0 ? "text-buy" : "text-sell")}>{pct(change)}</span>
    </span>
  )
}

function TradeLine({ trade }: { trade: TradeView }) {
  const lag = lagDays(trade.tradedAt, trade.disclosedAt)
  const mirrored = !!trade.tokenSymbol
  return (
    <li className="grid grid-cols-[3.25rem_1fr_auto] items-baseline gap-x-3 gap-y-1 px-4 py-2.5 odd:bg-bar sm:grid-cols-[3.25rem_minmax(0,1.4fr)_7rem_minmax(0,1.6fr)] sm:px-5">
      <span className={cn("font-mono text-xs font-semibold uppercase", trade.side === "buy" ? "text-buy" : "text-sell")}>
        {trade.side === "buy" ? "Buy" : "Sell"}
      </span>
      <span className="min-w-0">
        <span className="mr-2 font-mono text-sm font-semibold">{trade.ticker ?? "-"}</span>
        <span className="text-xs text-muted-foreground">{trade.assetName}</span>
      </span>
      <span className="text-right font-mono text-xs tabular-nums sm:text-left">{amountRange(trade.amountLow, trade.amountHigh)}</span>
      <span className="col-span-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 pl-[4rem] font-mono text-xs tabular-nums sm:col-span-1 sm:pl-0">
        <span className="text-muted-foreground">
          traded {shortDay(trade.tradedAt)}, filed {lag}d later
        </span>
        {mirrored ? (
          <Move from={trade.pxTraded} to={trade.pxDisclosed} label="Move between the trade and its disclosure: the part a copier cannot capture" />
        ) : (
          <span className="text-muted-foreground">not tokenized</span>
        )}
      </span>
    </li>
  )
}

/**
 * A filing drawn as green-bar printout: the member, each disclosed trade, and the on-chain
 * receipt stamped at the foot.
 */
export function FilingReceipt({ filing, action, compact = false }: { filing: FilingView; action?: React.ReactNode; compact?: boolean }) {
  const trades = compact ? filing.trades.slice(0, 4) : filing.trades
  const hidden = filing.trades.length - trades.length
  const mirrorable = filing.trades.filter((t) => t.tokenSymbol).length
  return (
    <article className="border bg-card shadow-[0_1px_0_var(--border)]">
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
        <MemberAvatar source={filing.source} />
        <div className="min-w-0 flex-1">
          <Link href={`/p/${filing.source.slug}`} className="block truncate text-sm font-semibold hover:underline">
            {filing.source.name}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <PartySeat source={filing.source} />
            <span className="text-xs text-muted-foreground">Filed {day(filing.filedAt)}</span>
          </div>
        </div>
        <a
          href={filing.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {filing.kind === "form4" ? "Form 4" : `PTR ${filing.docId}`}
          <ArrowSquareOut className="size-3.5" />
        </a>
      </header>

      <ol>
        {trades.map((t) => (
          <TradeLine key={t.id} trade={t} />
        ))}
      </ol>
      {hidden > 0 && (
        <Link href={`/p/${filing.source.slug}`} className="block border-t px-5 py-2 text-xs text-muted-foreground hover:text-foreground">
          {hidden} more {hidden === 1 ? "trade" : "trades"} on this filing
        </Link>
      )}

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed px-4 py-3 sm:px-5">
        {filing.receiptSig ? (
          <a
            href={explorerTx(filing.receiptSig)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 border border-stamp/50 px-2 py-1 font-mono text-[11px] text-stamp hover:bg-stamp/10"
            title="Memo transaction holding the filing's sha256 hash, written before any mirror trade"
          >
            <Seal weight="fill" className="size-3.5" />
            Receipt {filing.receiptSig.slice(0, 8)}
          </a>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">Receipt pending</span>
        )}
        {filing.sha256 && (
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline" title={filing.sha256}>
            sha256 {filing.sha256.slice(0, 12)}
          </span>
        )}
        <span className="font-mono text-[11px] text-muted-foreground">
          {mirrorable}/{filing.trades.length} tokenized
          {filing.mirrors > 0 && `, ${filing.mirrors} mirrored`}
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </footer>
    </article>
  )
}

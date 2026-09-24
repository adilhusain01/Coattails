"use client"

import { Seal } from "@phosphor-icons/react"
import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { explorerTx } from "@/lib/cluster"
import { day, shortAddress, usd } from "@/lib/format"
import { useReceipts, type ReceiptsLog } from "@/lib/queries"
import { cn } from "@/lib/utils"
import type { ExecutionView } from "@/server/queries"

const STATUS: Record<string, string> = {
  confirmed: "Filled",
  rejected: "Skipped",
  failed: "Failed",
  sent: "Sent",
}

export function FillRow({ e, showWallet = true }: { e: ExecutionView; showWallet?: boolean }) {
  return (
    <TableRow className="even:bg-bar">
      <TableCell className="text-muted-foreground">{day(e.createdAt)}</TableCell>
      {showWallet && <TableCell>{shortAddress(e.wallet)}</TableCell>}
      <TableCell>
        <span className={cn("mr-2 font-semibold uppercase", e.side === "buy" ? "text-buy" : "text-sell")}>{e.side}</span>
        {e.tokenSymbol}
      </TableCell>
      <TableCell className="text-right">{e.usdcAmount != null ? usd(e.usdcAmount) : "-"}</TableCell>
      <TableCell className="text-right">{e.fillPx != null ? usd(e.fillPx) : "-"}</TableCell>
      <TableCell className="font-sans">
        <Link href={`/app/p/${e.sourceSlug}`} className="text-xs hover:underline">
          {e.sourceName}
        </Link>
      </TableCell>
      <TableCell className="font-sans text-xs">
        {e.sig ? (
          <a href={explorerTx(e.sig)} target="_blank" rel="noreferrer" className="text-stamp hover:underline">
            {STATUS[e.status] ?? e.status}
          </a>
        ) : (
          <span className="text-muted-foreground" title={e.reason ?? undefined}>
            {STATUS[e.status] ?? e.status}
            {e.reason ? `: ${e.reason}` : ""}
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}

export function FillsTable({ rows, showWallet = true }: { rows: ExecutionView[]; showWallet?: boolean }) {
  return (
    <div className="border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Date</TableHead>
            {showWallet && <TableHead>Wallet</TableHead>}
            <TableHead>Trade</TableHead>
            <TableHead className="text-right">USDC</TableHead>
            <TableHead className="text-right">Pyth price</TableHead>
            <TableHead>Copies</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono tabular-nums">
          {rows.map((e) => (
            <FillRow key={e.id} e={e} showWallet={showWallet} />
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center font-sans text-sm text-muted-foreground">
                No mirror fills yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function ReceiptsView({ log: initial }: { log: ReceiptsLog }) {
  const { data: log = initial } = useReceipts(initial)
  return (
    <div className="grid gap-10 pt-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Receipts</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Before mirroring anything, the agent writes each filing&apos;s sha256 hash to Solana in a Memo transaction.
          Every fill below carries that receipt in its own memo, so anyone can check which public document a trade copied.
        </p>
      </header>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Mirror fills</h2>
        <FillsTable rows={log.executions} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Filing receipts</h2>
        <div className="border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Filed</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>sha256</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono tabular-nums">
              {log.filings.map((f) => (
                <TableRow key={f.id} className="even:bg-bar">
                  <TableCell className="text-muted-foreground">{day(f.filedAt)}</TableCell>
                  <TableCell className="font-sans">
                    <Link href={`/app/p/${f.source.slug}`} className="text-sm hover:underline">
                      {f.source.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {f.kind === "form4" ? `Form 4 ${f.docId}` : `PTR ${f.docId}`}
                    </a>
                  </TableCell>
                  <TableCell className="text-muted-foreground" title={f.sha256 ?? undefined}>
                    {f.sha256?.slice(0, 16)}
                  </TableCell>
                  <TableCell>
                    {f.receiptSig && (
                      <a
                        href={explorerTx(f.receiptSig)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-stamp hover:underline"
                      >
                        <Seal weight="fill" className="size-3.5" />
                        {f.receiptSig.slice(0, 10)}
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {log.filings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center font-sans text-sm text-muted-foreground">
                    No receipts written yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

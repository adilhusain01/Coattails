"use client"

import Link from "next/link"
import { FollowButton } from "@/components/follow-dialog"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pct, shortDay } from "@/lib/format"
import { useLeaders } from "@/lib/queries"
import { cn } from "@/lib/utils"
import type { LeaderRow } from "@/server/queries"

function Signed({ value, title }: { value: number | null; title: string }) {
  if (value == null) return <span className="text-muted-foreground">-</span>
  return (
    <span title={title} className={cn(value >= 0 ? "text-buy" : "text-sell")}>
      {pct(value)}
    </span>
  )
}

export function MembersView(props: { leaders: LeaderRow[] }) {
  const { data: leaders = [] } = useLeaders(props.leaders)
  return (
    <div className="grid gap-6 pt-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Members</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Everyone whose recent filings the agent has read. Copy return is what a mirror would have made on their
          tokenized buys since the disclosure date. Filing delay is how much the stock had already moved between the trade
          and its disclosure.
        </p>
      </header>
      <div className="border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Member</TableHead>
              <TableHead className="text-right">Filings</TableHead>
              <TableHead className="text-right">Tokenized trades</TableHead>
              <TableHead className="text-right">Copy return</TableHead>
              <TableHead className="text-right">Filing delay</TableHead>
              <TableHead className="text-right">Mirrors</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody className="font-mono tabular-nums">
            {leaders.map((m) => (
              <TableRow key={m.slug} className="even:bg-bar">
                <TableCell className="font-sans">
                  <div className="flex items-center gap-3">
                    <MemberAvatar source={m} className="size-8" />
                    <div className="min-w-0">
                      <Link href={`/p/${m.slug}`} className="block truncate text-sm font-medium hover:underline">
                        {m.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <PartySeat source={m} />
                        {m.lastFiledAt && <span className="text-xs text-muted-foreground">last filed {shortDay(m.lastFiledAt)}</span>}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">{m.filings}</TableCell>
                <TableCell className="text-right">
                  {m.mirrorable}/{m.trades}
                </TableCell>
                <TableCell className="text-right">
                  <Signed value={m.copyReturn} title="Average move of tokenized buys from disclosure date to now" />
                </TableCell>
                <TableCell className="text-right">
                  <Signed value={m.lagCost} title="Average move of tokenized buys from trade date to disclosure date" />
                </TableCell>
                <TableCell className="text-right">{m.followers}</TableCell>
                <TableCell className="text-right font-sans">
                  <FollowButton source={m} />
                </TableCell>
              </TableRow>
            ))}
            {leaders.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center font-sans text-sm text-muted-foreground">
                  No filings read yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

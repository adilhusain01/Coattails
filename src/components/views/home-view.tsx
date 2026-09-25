"use client"

import Link from "next/link"
import { useState } from "react"
import { FilingReceipt } from "@/components/filing-receipt"
import { FollowButton } from "@/components/follow-dialog"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { pct, shortDay } from "@/lib/format"
import { useFeed, useLeaders } from "@/lib/queries"
import { cn } from "@/lib/utils"
import type { FilingView, LeaderRow } from "@/server/queries"


function mirrorLabel(source: FilingView["source"]) {
  if (source.kind === "house") return `Mirror ${source.name.split(" ").at(-1)}`
  return source.name.length <= 22 ? `Mirror ${source.name}` : "Mirror"
}

export function HomeView(props: { filings: FilingView[]; leaders: LeaderRow[] }) {
  const { data: filings = [] } = useFeed(props.filings)
  const { data: leaders = [] } = useLeaders(props.leaders)
  const [kind, setKind] = useState<"all" | "house_ptr" | "form4">("all")
  const shown = filings.filter((f) => kind === "all" || f.kind === kind)
  const mirrorable = shown.filter((f) => f.trades.some((t) => t.tokenSymbol))
  // Lead with Congress when there is a tokenized House filing; insiders fill in otherwise.
  const houseFirst = [...mirrorable].sort((a, b) => Number(b.kind === "house_ptr") - Number(a.kind === "house_ptr"))
  const [hero, ...rest] = kind === "all" && houseFirst.length ? houseFirst : mirrorable.length ? mirrorable : shown

  return (
    <div className="grid gap-8 pt-8">
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Filings</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          House reports and insider purchases as the agent reads them, newest first. Each price shows how far the stock
          moved between the trade and the report.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="grid content-start gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Latest filing</h2>
            <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => v && setKind(v as typeof kind)}>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="house_ptr">Congress</ToggleGroupItem>
              <ToggleGroupItem value="form4">Insiders</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {hero ? (
            <FilingReceipt filing={hero} action={<FollowButton source={hero.source} size="default" label={mirrorLabel(hero.source)} />} />
          ) : (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyTitle>No filings read yet</EmptyTitle>
                <EmptyDescription>
                  New reports appear here within minutes of the House Clerk or the SEC publishing them.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {rest.slice(0, 6).map((f) => (
            <FilingReceipt key={f.id} filing={f} compact action={<FollowButton source={f.source} />} />
          ))}
        </section>

        <aside className="grid content-start gap-8">
          <section className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Who to mirror</h2>
              <Link href="/app/people" className="text-xs text-muted-foreground hover:text-foreground">
                Everyone
              </Link>
            </div>
            <ul className="border">
              {leaders.slice(0, 8).map((m) => (
                <li key={m.slug} className="flex items-center gap-3 px-3 py-2.5 odd:bg-bar">
                  <MemberAvatar source={m} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/p/${m.slug}`} className="block truncate text-sm font-medium hover:underline">
                      {m.name}
                    </Link>
                    <div className="flex min-w-0 items-center gap-2">
                      <PartySeat source={m} />
                      {m.lastFiledAt && <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{shortDay(m.lastFiledAt)}</span>}
                    </div>
                  </div>
                  {m.copyReturn != null && (
                    <span
                      className={cn("font-mono text-xs tabular-nums", m.copyReturn >= 0 ? "text-buy" : "text-sell")}
                      title="Average move of tokenized buys since their disclosure date"
                    >
                      {pct(m.copyReturn)}
                    </span>
                  )}
                </li>
              ))}
              {leaders.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">No members yet.</li>}
            </ul>
          </section>

          <section className="grid gap-2 border bg-card p-4">
            <h2 className="text-sm font-semibold">Exits run for you</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Reports can arrive weeks after a sale, so every position has a trailing stop and a time limit you choose
              when you start mirroring. The agent checks them every 20 seconds.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}

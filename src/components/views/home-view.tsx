"use client"

import Link from "next/link"
import { useState } from "react"
import { FilingReceipt } from "@/components/filing-receipt"
import { FollowButton } from "@/components/follow-dialog"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { pct, shortDay } from "@/lib/format"
import { useFeed, useLeaders } from "@/lib/queries"
import { cn } from "@/lib/utils"
import type { FilingView, LeaderRow } from "@/server/queries"

const STEPS = [
  ["A member files", "House members report trades on a Periodic Transaction Report, up to 45 days after trading."],
  ["The agent reads it", "The agent reads the PDF the day the Clerk publishes it; scanned paper forms go through OCR first."],
  ["A receipt goes on-chain", "The filing's hash is written to Solana before any trade, so every fill traces back to it."],
  ["Your wallet mirrors it", "Buys and sells fill into your own wallet at the live Pyth price, any hour of the week."],
]

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
    <div className="grid gap-10 pt-8 sm:pt-12">
      <section className="grid gap-4">
        <h1 className="max-w-3xl text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl">
          Copy what Congress trades.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Members of the House must disclose their stock trades. Coattails reads each filing as soon as it is published and
          mirrors the trades into tokenized stocks held in your own wallet, from anywhere outside the US. Company
          insiders&apos; open-market buys are included too: they are filed within two business days.
        </p>
      </section>

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
            <div className="border border-dashed p-8 text-sm text-muted-foreground">
              The agent has not read any filings yet. New Periodic Transaction Reports appear here within minutes of the
              Clerk publishing them.
            </div>
          )}
          {rest.slice(0, 6).map((f) => (
            <FilingReceipt key={f.id} filing={f} compact action={<FollowButton source={f.source} />} />
          ))}
        </section>

        <aside className="grid content-start gap-8">
          <section className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Who to mirror</h2>
              <Link href="/members" className="text-xs text-muted-foreground hover:text-foreground">
                Everyone
              </Link>
            </div>
            <ul className="border">
              {leaders.slice(0, 8).map((m) => (
                <li key={m.slug} className="flex items-center gap-3 px-3 py-2.5 odd:bg-bar">
                  <MemberAvatar source={m} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/p/${m.slug}`} className="block truncate text-sm font-medium hover:underline">
                      {m.name}
                    </Link>
                    <div className="flex items-center gap-2">
                      <PartySeat source={m} />
                      {m.lastFiledAt && <span className="text-xs text-muted-foreground">{shortDay(m.lastFiledAt)}</span>}
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

          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">How a mirror works</h2>
            <ol className="grid gap-3">
              {STEPS.map(([title, body], i) => (
                <li key={title} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
                  <span className="font-mono text-xs text-stamp">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

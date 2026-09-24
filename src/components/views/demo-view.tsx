"use client"

import { ArrowSquareOut, CheckCircle, Circle, MinusCircle, Play, XCircle } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ReplayChart } from "@/components/demo/replay-chart"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { explorerAddress, explorerTx } from "@/lib/cluster"
import { shortAddress } from "@/lib/format"
import { cn } from "@/lib/utils"
import { api } from "@/lib/wallet-tx"
import type { DemoRun, DemoStep, ScenarioInfo, ScenarioKey } from "@/server/demo"

function StepIcon({ status }: { status: DemoStep["status"] }) {
  if (status === "running") return <Spinner className="text-foreground" />
  if (status === "done") return <CheckCircle weight="fill" className="text-buy" />
  if (status === "failed") return <XCircle weight="fill" className="text-sell" />
  if (status === "skipped") return <MinusCircle weight="fill" className="text-muted-foreground" />
  return <Circle className="text-muted-foreground" />
}

function Timeline({ run }: { run: DemoRun }) {
  return (
    <ol className="grid" aria-live="polite">
      {run.steps.map((s, i) => (
        <li key={`${s.key}-${i}`} className="grid grid-cols-[1.5rem_1fr] gap-x-3 pb-5 last:pb-0">
          <div className="flex flex-col items-center gap-1 pt-0.5">
            <span className="flex size-5 items-center justify-center [&_svg]:size-5">
              <StepIcon status={s.status} />
            </span>
            {i < run.steps.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden />}
          </div>
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
              <h3 className={cn("text-sm font-semibold", s.status === "skipped" && "text-muted-foreground")}>{s.title}</h3>
            </div>
            {s.detail && <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{s.detail}</p>}
            {(s.sig || s.href) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {s.href && (
                  <a href={s.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    {s.hrefLabel ?? "Open"} <ArrowSquareOut aria-hidden />
                  </a>
                )}
                {s.sig && (
                  <a
                    href={explorerTx(s.sig)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-stamp hover:underline"
                  >
                    {s.key.startsWith("filing") ? "Receipt" : "Transaction"} {s.sig.slice(0, 10)} <ArrowSquareOut aria-hidden />
                  </a>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
      {run.status === "running" && run.steps.length === 0 && (
        <li className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Starting…
        </li>
      )}
    </ol>
  )
}

function ScenarioCard({
  s,
  onRun,
  busy,
  selected,
}: {
  s: ScenarioInfo
  onRun: (key: ScenarioKey) => void
  busy: boolean
  selected: boolean
}) {
  return (
    <Card className={cn("gap-3", selected && "ring-2 ring-ring")}>
      <CardHeader className="gap-2">
        <CardTitle className="text-sm">{s.title}</CardTitle>
        <CardDescription className="text-sm leading-relaxed">{s.summary}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {s.source ? (
          <div className="flex items-center gap-2">
            <MemberAvatar source={{ ...s.source, kind: s.source.kind as "house" | "insider" }} className="size-7" />
            <div className="min-w-0">
              <p className="line-clamp-2 text-xs font-medium">{s.setup}</p>
              <PartySeat source={{ ...s.source, kind: s.source.kind as "house" | "insider" }} />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No filing read so far fits this case.</p>
        )}
      </CardContent>
      <CardFooter className="mt-auto">
        <Button size="sm" onClick={() => onRun(s.key)} disabled={!s.available || busy} className="w-full">
          <Play data-icon="inline-start" weight="fill" />
          Run on devnet
        </Button>
      </CardFooter>
    </Card>
  )
}

export function DemoView() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const runId = params.get("run")

  const scenarios = useQuery({
    queryKey: ["demo", "scenarios"],
    queryFn: () => api<{ scenarios: ScenarioInfo[]; active: string | null }>("/api/demo"),
    refetchInterval: 15_000,
  })
  const run = useQuery({
    queryKey: ["demo", "run", runId],
    queryFn: () => api<DemoRun>(`/api/demo/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data?.status === "running" || !q.state.data ? 700 : false),
  })

  const setRun = (id: string) => router.replace(`${pathname}?run=${id}`, { scroll: false })

  const start = useMutation({
    mutationFn: (scenario: ScenarioKey) => api<{ id: string; joined: boolean }>("/api/demo/runs", { scenario }),
    onSuccess: (r) => {
      if (r.joined) toast("Another demo is running, so you are watching it. Start yours when it finishes.")
      setRun(r.id)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const active = scenarios.data?.active
  const r = run.data
  const busy = start.isPending || r?.status === "running" || (!!active && active !== runId)

  return (
    <div className="grid gap-8 pt-8">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Demo</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-pretty text-muted-foreground">
          Each scenario creates a new wallet and runs the whole flow on Solana devnet: test USDC, the follow, the
          purchases, the sell permission and the exit. Every step is a transaction you can open in the explorer. The
          filings are real reports the agent has read, and prices are the stock&apos;s real daily closes from the day of
          the report, played back one trading day at a time.
        </p>
      </header>

      {active && active !== runId && (
        <Alert>
          <Spinner />
          <AlertTitle>A demo is running right now</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>You can watch it live. New runs start once it finishes.</span>
            <Button size="sm" variant="outline" onClick={() => setRun(active)}>
              Watch it
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Scenarios">
        {scenarios.isLoading
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-64" />)
          : scenarios.data?.scenarios.map((s) => (
              <ScenarioCard key={s.key} s={s} onRun={(k) => start.mutate(k)} busy={busy} selected={r?.scenario === s.key} />
            ))}
      </section>

      {!runId ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Pick a scenario to run</EmptyTitle>
            <EmptyDescription>A run takes about a minute. Every transaction link opens on Solana Explorer.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !r ? (
        run.isError ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>This run is no longer available</EmptyTitle>
              <EmptyDescription>Runs are kept while the server is up. Start a new one above.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Skeleton className="h-96" />
        )
      ) : (
        <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm">
                  {scenarios.data?.scenarios.find((s) => s.key === r.scenario)?.title ?? "Run"}
                </CardTitle>
                <Badge variant={r.status === "failed" ? "destructive" : r.status === "done" ? "secondary" : "outline"}>
                  {r.status === "running" ? "Running" : r.status === "done" ? "Finished" : "Stopped"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Timeline run={r} />
              {r.status === "failed" && r.error && (
                <Alert variant="destructive" className="mt-4">
                  <XCircle />
                  <AlertTitle>The run stopped</AlertTitle>
                  <AlertDescription>{r.error}. The devnet RPC may be busy; run it again in a minute.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:sticky lg:top-20">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{r.ticker ? `${r.ticker} daily closes` : "Price"}</CardTitle>
                <CardDescription className="text-xs">
                  {r.series.length
                    ? `${r.series[0].date} to ${r.series.at(-1)!.date}. Source: daily closes, replayed.`
                    : "The chart fills in as each trading day plays back."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {r.series.length > 1 ? (
                  <ReplayChart series={r.series} markers={r.markers} ticker={r.ticker} />
                ) : (
                  <div className="flex h-64 items-center justify-center border border-dashed text-xs text-muted-foreground">
                    {r.scenario === "budget" ? "This scenario has no price replay." : "Waiting for the first trading day…"}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-xs text-muted-foreground">Follower wallet</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1">
                  {r.wallet ? (
                    <a href={explorerAddress(r.wallet)} target="_blank" rel="noreferrer" className="font-mono text-sm hover:underline">
                      {shortAddress(r.wallet, 6)}
                    </a>
                  ) : (
                    <Skeleton className="h-5 w-32" />
                  )}
                  {r.source && (
                    <Link href={`/app/p/${r.source.slug}`} className="truncate text-xs text-muted-foreground hover:text-foreground">
                      Mirroring {r.source.name}
                    </Link>
                  )}
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-xs text-muted-foreground">Rules</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {r.rules ? (
                    <p className="leading-relaxed">
                      ${r.rules.perTradeUsd} per trade, ${r.rules.budgetUsd} budget. Stop{" "}
                      {r.rules.trailingStopPct ? `${Math.round(r.rules.trailingStopPct * 100)}%` : "off"}, limit{" "}
                      {r.rules.maxHoldDays ? `${r.rules.maxHoldDays} days` : "off"}.
                    </p>
                  ) : (
                    <Skeleton className="h-5 w-40" />
                  )}
                </CardContent>
              </Card>
            </div>

            {r.summary && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Result</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1.5">
                  {r.summary.pnlPct != null && (
                    <p className={cn("font-mono text-3xl tabular-nums", r.summary.pnlPct >= 0 ? "text-buy" : "text-sell")}>
                      {r.summary.pnlPct >= 0 ? "+" : ""}
                      {(r.summary.pnlPct * 100).toFixed(1)}%
                    </p>
                  )}
                  {r.summary.lines.map((l) => (
                    <p key={l} className="text-sm leading-relaxed text-muted-foreground">
                      {l}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

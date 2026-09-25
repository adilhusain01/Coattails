"use client"

import { Drop, ShieldCheck, ShieldSlash, UsersThree, Wallet } from "@phosphor-icons/react"
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { toast } from "sonner"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FillsTable } from "@/components/views/receipts-view"
import { WalletButton } from "@/components/wallet-button"
import { CLUSTER, explorerTx } from "@/lib/cluster"
import { pct, shortDay, usd } from "@/lib/format"
import { keys, useMe, type PositionView } from "@/lib/queries"
import { client } from "@/lib/solana-client"
import { cn } from "@/lib/utils"
import { api, signAndSubmit, userRejected } from "@/lib/wallet-tx"

const CLOSED: Record<NonNullable<PositionView["closeReason"]>, string> = {
  member_sold: "Sold: member sold",
  trailing_stop: "Sold: trailing stop",
  max_hold: "Sold: time limit",
  manual: "Closed",
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5 border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl tabular-nums">{value}</span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

/** A transaction the server builds and signs as fee payer, the wallet signs, and the server sends. */
function useSignedAction(buildPath: string, intent: Record<string, unknown>, done: string) {
  const connected = useConnectedWallet(client)
  const wallet = connected?.account.address
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => {
      if (!connected?.signer || !wallet) throw new Error("Connect a wallet first")
      return signAndSubmit({ signer: connected.signer, wallet, buildPath, buildBody: {}, intent })
    },
    onSuccess: (sig: string) => {
      toast.success(done, { action: { label: "View", onClick: () => window.open(explorerTx(sig)) } })
      queryClient.invalidateQueries({ queryKey: keys.me(wallet ?? "") })
    },
    onError: (e: Error) => (userRejected(e) ? toast("Cancelled in your wallet") : toast.error(e.message)),
  })
}

function Status({ p }: { p: PositionView }) {
  if (p.status === "closed") {
    return p.closeSig ? (
      <a href={explorerTx(p.closeSig)} target="_blank" rel="noreferrer" className="text-stamp hover:underline">
        {CLOSED[p.closeReason ?? "manual"]}
      </a>
    ) : (
      <span className="text-muted-foreground">{CLOSED[p.closeReason ?? "manual"]}</span>
    )
  }
  if (p.exitDue) return <Badge variant="destructive">Exit due</Badge>
  if (!p.sellAllowed) return <Badge variant="outline">Selling not allowed</Badge>
  return <Badge variant="secondary">Protected</Badge>
}

function PositionsTable({ rows }: { rows: PositionView[] }) {
  return (
    <div className="border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Stock</TableHead>
            <TableHead>From</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Bought at</TableHead>
            <TableHead className="text-right">Now</TableHead>
            <TableHead className="text-right">Stop at</TableHead>
            <TableHead className="text-right">Sell by</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono tabular-nums">
          {rows.map((p) => {
            const now = p.status === "closed" ? p.closePx : p.lastPx
            const change = now ? now / p.entryPx - 1 : null
            return (
              <TableRow key={p.id} className="even:bg-bar" title={p.exitDue ?? undefined}>
                <TableCell className="font-semibold">{p.tokenSymbol}</TableCell>
                <TableCell className="font-sans text-xs">
                  {p.source ? (
                    <Link href={`/app/p/${p.source.slug}`} className="hover:underline">
                      {p.source.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell className="text-right">{usd(p.costUsd)}</TableCell>
                <TableCell className="text-right">{usd(p.entryPx)}</TableCell>
                <TableCell className="text-right">
                  {usd(now)}
                  {change != null && (
                    <span className={cn("ml-1.5 text-xs", change >= 0 ? "text-buy" : "text-sell")}>{pct(change)}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{p.status === "open" ? usd(p.stopPx) : "-"}</TableCell>
                <TableCell className="text-right">{p.status === "open" && p.sellBy ? shortDay(p.sellBy) : "-"}</TableCell>
                <TableCell className="font-sans text-xs">
                  <Status p={p} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function PortfolioView() {
  const connected = useConnectedWallet(client)
  const wallet = connected?.account.address
  const me = useMe(wallet)
  const queryClient = useQueryClient()

  const faucet = useMutation({
    mutationFn: () => api<{ sig: string; amount: number }>("/api/faucet", { wallet }),
    onSuccess: (r) => {
      toast.success(`Received ${r.amount} test USDC`, { action: { label: "View", onClick: () => window.open(explorerTx(r.sig)) } })
      queryClient.invalidateQueries({ queryKey: keys.me(wallet ?? "") })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useSignedAction("/api/revoke/build", { type: "revoke" }, "Allowance revoked. Coattails can no longer spend your USDC.")
  const allowExits = useSignedAction("/api/autosell/build", { type: "autosell" }, "Exits are on. Coattails can now sell these positions for you.")

  if (!wallet) {
    return (
      <Empty className="mt-12 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Wallet />
          </EmptyMedia>
          <EmptyTitle>Connect a wallet to see your portfolio</EmptyTitle>
          <EmptyDescription>
            Your positions, exit rules and the people you mirror appear here once a Solana wallet is connected.
          </EmptyDescription>
        </EmptyHeader>
        <WalletButton />
      </Empty>
    )
  }

  const data = me.data
  const follows = data?.follows.filter((f) => f.active) ?? []
  const positions = data?.positions ?? []
  const open = positions.filter((p) => p.status === "open")
  const unprotected = open.filter((p) => !p.sellAllowed)
  const value = open.reduce((a, p) => a + p.tokens * (p.lastPx ?? p.entryPx), 0)
  const cost = open.reduce((a, p) => a + p.costUsd, 0)

  return (
    <div className="grid gap-8 pt-8">
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {CLUSTER === "devnet" && (
            <Button variant="outline" onClick={() => faucet.mutate()} disabled={faucet.isPending}>
              {faucet.isPending ? <Spinner data-icon="inline-start" /> : <Drop data-icon="inline-start" />}
              Get 100 test USDC
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={revoke.isPending || !data?.usdc.allowance}>
                {revoke.isPending ? <Spinner data-icon="inline-start" /> : <ShieldSlash data-icon="inline-start" />}
                Revoke allowance
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop all mirroring?</AlertDialogTitle>
                <AlertDialogDescription>
                  Coattails will no longer be able to spend your USDC, so no new purchases will be made for anyone you
                  follow. Stocks you already hold stay in your wallet.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep mirroring</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => revoke.mutate()}>
                  Revoke allowance
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {unprotected.length > 0 && (
        <Alert>
          <ShieldCheck />
          <AlertTitle>Let Coattails sell {unprotected.length === 1 ? "this position" : "these positions"}</AlertTitle>
          <AlertDescription className="grid gap-3">
            <p>
              Your trailing stop and time limit can only run once you allow Coattails to sell{" "}
              {[...new Set(unprotected.map((p) => p.tokenSymbol))].join(", ")}. The permission covers only these stocks
              and you can revoke it from any wallet.
            </p>
            <div>
              <Button size="sm" onClick={() => allowExits.mutate()} disabled={allowExits.isPending}>
                {allowExits.isPending && <Spinner data-icon="inline-start" />}
                Allow selling
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {me.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Figure label="USDC in wallet" value={usd(data?.usdc.balance ?? 0)} hint={CLUSTER === "devnet" ? "Test USDC on devnet" : undefined} />
          <Figure label="Allowance left" value={usd(data?.usdc.allowance ?? 0)} hint="The most Coattails can still spend" />
          <Figure
            label="Open positions"
            value={usd(value)}
            hint={open.length ? `${open.length} held, ${pct(cost ? value / cost - 1 : null)} on cost` : "None yet"}
          />
        </div>
      )}

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Positions</h2>
        {positions.length ? (
          <PositionsTable rows={positions} />
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No positions yet</EmptyTitle>
              <EmptyDescription>
                When someone you mirror reports a purchase, the stock bought for you shows up here with its exit rules.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Mirroring</h2>
        {follows.length ? (
          <ul className="border">
            {follows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 odd:bg-bar">
                <MemberAvatar source={f.source} className="size-8" />
                <div className="min-w-0 flex-1">
                  <Link href={`/app/p/${f.source.slug}`} className="block truncate text-sm font-medium hover:underline">
                    {f.source.name}
                  </Link>
                  <PartySeat source={f.source} />
                </div>
                <span className="font-mono text-xs tabular-nums">{usd(f.perTradeUsd, 0)} per trade</span>
                <span className="text-xs text-muted-foreground">
                  Stop {f.trailingStopPct ? `${Math.round(f.trailingStopPct * 100)}%` : "off"}, limit{" "}
                  {f.maxHoldDays ? `${f.maxHoldDays} days` : "off"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersThree />
              </EmptyMedia>
              <EmptyTitle>You are not mirroring anyone yet</EmptyTitle>
              <EmptyDescription>
                Pick a member of Congress or a company insider on the <Link href="/app/people">People</Link> page.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Fills</h2>
        <FillsTable rows={data?.executions ?? []} showWallet={false} />
      </section>
    </div>
  )
}

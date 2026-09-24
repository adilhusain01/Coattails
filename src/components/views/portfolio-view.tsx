"use client"

import { Drop, ShieldSlash, Tag } from "@phosphor-icons/react"
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { toast } from "sonner"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { FillsTable } from "@/components/views/receipts-view"
import { WalletButton } from "@/components/wallet-button"
import { CLUSTER, explorerTx } from "@/lib/cluster"
import { shortDay, usd } from "@/lib/format"
import { keys, useMe } from "@/lib/queries"
import { client } from "@/lib/solana-client"
import { api, signAndSubmit, userRejected } from "@/lib/wallet-tx"

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5 border p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

/** A transaction the server builds, the wallet signs, and the server co-signs. */
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

export function PortfolioView() {
  const connected = useConnectedWallet(client)
  const wallet = connected?.account.address
  const me = useMe(wallet)
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.me(wallet ?? "") })

  const onError = (e: Error) => (userRejected(e) ? toast("Cancelled in your wallet") : toast.error(e.message))
  const viewTx = (sig: string) => ({ label: "View", onClick: () => window.open(explorerTx(sig)) })

  const faucet = useMutation({
    mutationFn: () => api<{ sig: string; amount: number }>("/api/faucet", { wallet }),
    onSuccess: (r) => {
      toast.success(`Received ${r.amount} test USDC`, { action: viewTx(r.sig) })
      refresh()
    },
    onError,
  })

  const revoke = useSignedAction("/api/revoke/build", { type: "revoke" }, "Allowance revoked. Coattails can no longer spend your USDC.")
  const autosell = useSignedAction("/api/autosell/build", { type: "autosell" }, "Auto-sell is on for your positions")

  if (!wallet) {
    return (
      <div className="grid justify-items-start gap-4 pt-12">
        <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Connect a Solana wallet to see who you mirror, what was bought for you, and to change or revoke your allowance.
        </p>
        <WalletButton />
      </div>
    )
  }

  const data = me.data
  const active = data?.follows.filter((f) => f.active) ?? []
  const fills = data?.executions ?? []
  const positions = new Map<string, number>()
  for (const e of fills) {
    if (e.status !== "confirmed" || e.tokenAmount == null) continue
    positions.set(e.tokenSymbol, (positions.get(e.tokenSymbol) ?? 0) + (e.side === "buy" ? e.tokenAmount : -e.tokenAmount))
  }
  const held = [...positions].filter(([, n]) => n > 1e-9)

  return (
    <div className="grid gap-8 pt-8">
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {CLUSTER === "devnet" && (
            <Button variant="outline" onClick={() => faucet.mutate()} disabled={faucet.isPending}>
              <Drop /> {faucet.isPending ? "Sending" : "Get 100 test USDC"}
            </Button>
          )}
          <Button variant="outline" onClick={() => autosell.mutate()} disabled={autosell.isPending || held.length === 0}>
            <Tag /> Turn on auto-sell
          </Button>
          <Button variant="destructive" onClick={() => revoke.mutate()} disabled={revoke.isPending || !data?.usdc.allowance}>
            <ShieldSlash /> Revoke allowance
          </Button>
        </div>
      </header>

      {me.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Figure label="USDC in wallet" value={usd(data?.usdc.balance ?? 0)} hint={CLUSTER === "devnet" ? "Test USDC on devnet" : undefined} />
          <Figure label="Allowance left" value={usd(data?.usdc.allowance ?? 0)} hint="Most Coattails can still spend" />
          <Figure label="Mirrored positions" value={String(held.length)} hint={held.map(([s]) => s).join(", ") || "None yet"} />
        </div>
      )}

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Mirroring</h2>
        {active.length ? (
          <ul className="border">
            {active.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 odd:bg-bar">
                <MemberAvatar source={f.source} className="size-8" />
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${f.source.slug}`} className="block truncate text-sm font-medium hover:underline">
                    {f.source.name}
                  </Link>
                  <PartySeat source={f.source} />
                </div>
                <span className="font-mono text-xs tabular-nums">{usd(f.perTradeUsd, 0)} per trade</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">since {shortDay(f.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border border-dashed p-6 text-sm text-muted-foreground">
            You are not mirroring anyone yet. Pick a member on the <Link href="/members" className="underline">Members</Link> page.
          </p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Fills</h2>
        <FillsTable rows={fills} showWallet={false} />
      </section>
    </div>
  )
}

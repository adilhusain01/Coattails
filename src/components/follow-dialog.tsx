"use client"

import { CheckCircle, Drop } from "@phosphor-icons/react"
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { MemberAvatar, PartySeat } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CLUSTER, explorerTx } from "@/lib/cluster"
import { usd } from "@/lib/format"
import { keys, useMe } from "@/lib/queries"
import { client } from "@/lib/solana-client"
import { useFollowPrefs } from "@/lib/store"
import { api, signAndSubmit, userRejected } from "@/lib/wallet-tx"
import type { SourceView } from "@/server/queries"

const PER_TRADE = [5, 10, 25, 50]
const BUDGET = [25, 50, 100, 250]

function Amounts({ value, options, onChange, label }: { value: number; options: number[]; onChange: (v: number) => void; label: string }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={String(value)}
      onValueChange={(v) => v && onChange(Number(v))}
      aria-label={label}
      className="w-full"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o} value={String(o)} className="flex-1 font-mono tabular-nums">
          ${o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function FollowButton({ source, size = "sm", label }: { source: SourceView; size?: "sm" | "default" | "lg"; label?: string }) {
  const [open, setOpen] = useState(false)
  const connected = useConnectedWallet(client)
  const wallet = connected?.account.address
  const me = useMe(wallet)
  const queryClient = useQueryClient()
  const { perTradeUsd, budgetUsd, setPerTrade, setBudget } = useFollowPrefs()
  const following = me.data?.follows.some((f) => f.source.slug === source.slug && f.active)

  const faucet = useMutation({
    mutationFn: () => api<{ sig: string; amount: number }>("/api/faucet", { wallet }),
    onSuccess: (r) => {
      toast.success(`Received ${r.amount} test USDC`, { action: { label: "View", onClick: () => window.open(explorerTx(r.sig)) } })
      queryClient.invalidateQueries({ queryKey: keys.me(wallet!) })
    },
    onError: (e) => toast.error(e.message),
  })

  const follow = useMutation({
    mutationFn: async () => {
      if (!connected?.signer || !wallet) throw new Error("Connect a wallet first")
      return signAndSubmit({
        signer: connected.signer,
        wallet,
        buildPath: "/api/follow/build",
        buildBody: { slug: source.slug, perTradeUsd, budgetUsd },
        intent: { type: "follow", slug: source.slug, perTradeUsd },
      })
    },
    onSuccess: (sig) => {
      toast.success(`Following ${source.name}`, { action: { label: "View", onClick: () => window.open(explorerTx(sig)) } })
      queryClient.invalidateQueries({ queryKey: keys.me(wallet!) })
      queryClient.invalidateQueries({ queryKey: keys.leaders })
      setOpen(false)
    },
    onError: (e) => {
      if (userRejected(e)) toast("Approval cancelled in your wallet")
      else toast.error(e.message)
    },
  })

  const balance = me.data?.usdc.balance ?? 0
  const needsFunds = !!wallet && me.isSuccess && balance < perTradeUsd

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant={following ? "outline" : "default"}>
          {following ? <CheckCircle weight="fill" className="text-buy" /> : null}
          {following ? "Following" : (label ?? "Mirror")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <MemberAvatar source={source} className="size-12" />
            <div>
              <DialogTitle className="text-base">Mirror {source.name}</DialogTitle>
              <PartySeat source={source} />
            </div>
          </div>
          <DialogDescription className="pt-2 text-sm leading-relaxed">
            When a new filing shows a buy of a tokenized stock, Coattails buys it for you with USDC from your wallet.
            When it shows a sale, Coattails sells your position.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Per trade</span>
              <span className="text-xs text-muted-foreground">spent on each mirrored buy</span>
            </div>
            <Amounts value={perTradeUsd} options={PER_TRADE} onChange={setPerTrade} label="Per trade amount" />
          </div>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Budget</span>
              <span className="text-xs text-muted-foreground">most Coattails can ever spend</span>
            </div>
            <Amounts value={budgetUsd} options={BUDGET.filter((b) => b >= perTradeUsd)} onChange={setBudget} label="Total budget" />
          </div>
          <ul className="grid gap-1.5 border-l-2 border-stamp/40 pl-3 text-xs leading-relaxed text-muted-foreground">
            <li>Your USDC stays in your wallet. You approve Coattails to spend up to {usd(budgetUsd, 0)} of it.</li>
            <li>Bought stock lands in your own wallet, not ours. Revoke anytime from Portfolio or any wallet app.</li>
            <li>Every fill is checked against the live Pyth price and links to the filing it copies.</li>
            <li>Coattails pays the network fee. You need no SOL.</li>
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {!wallet ? (
            <p className="text-sm text-muted-foreground">Connect a wallet from the top bar to continue.</p>
          ) : needsFunds && CLUSTER === "devnet" ? (
            <Button variant="outline" onClick={() => faucet.mutate()} disabled={faucet.isPending}>
              <Drop /> {faucet.isPending ? "Sending test USDC" : "Get 100 test USDC"}
            </Button>
          ) : (
            <Link href="/me" className="self-center text-xs text-muted-foreground hover:text-foreground">
              Wallet: {usd(balance)} USDC
            </Link>
          )}
          <Button onClick={() => follow.mutate()} disabled={!wallet || follow.isPending || needsFunds}>
            {follow.isPending ? "Waiting for wallet" : `Approve ${usd(budgetUsd, 0)} and mirror`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

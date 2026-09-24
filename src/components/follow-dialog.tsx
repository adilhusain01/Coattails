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
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
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
const STOPS: (number | null)[] = [0.1, 0.15, 0.25, null]
const HOLDS: (number | null)[] = [30, 90, 180, null]

/** A ToggleGroup over a fixed set of values, where null is the "Off" option. */
function Choice<T extends number | null>({
  id,
  value,
  options,
  onChange,
  format,
}: {
  id: string
  value: T
  options: T[]
  onChange: (v: T) => void
  format: (v: T) => string
}) {
  const key = (v: T) => (v === null ? "off" : String(v))
  return (
    <ToggleGroup
      id={id}
      type="single"
      variant="outline"
      value={key(value)}
      onValueChange={(v) => v && onChange((v === "off" ? null : Number(v)) as T)}
      className="w-full"
    >
      {options.map((o) => (
        <ToggleGroupItem key={key(o)} value={key(o)} className="flex-1 font-mono tabular-nums">
          {format(o)}
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
  const prefs = useFollowPrefs()
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
        buildBody: { slug: source.slug, perTradeUsd: prefs.perTradeUsd, budgetUsd: prefs.budgetUsd },
        intent: {
          type: "follow",
          slug: source.slug,
          perTradeUsd: prefs.perTradeUsd,
          trailingStopPct: prefs.trailingStopPct,
          maxHoldDays: prefs.maxHoldDays,
        },
      })
    },
    onSuccess: (sig) => {
      toast.success(`Mirroring ${source.name}`, { action: { label: "View", onClick: () => window.open(explorerTx(sig)) } })
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
  const needsFunds = !!wallet && me.isSuccess && balance < prefs.perTradeUsd

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant={following ? "outline" : "default"}>
          {following && <CheckCircle weight="fill" data-icon="inline-start" className="text-buy" />}
          {following ? "Mirroring" : (label ?? "Mirror")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <MemberAvatar source={source} className="size-12" />
            <div className="grid gap-0.5">
              <DialogTitle className="text-base">Mirror {source.name}</DialogTitle>
              <PartySeat source={source} />
            </div>
          </div>
          <DialogDescription className="pt-2 text-sm leading-relaxed">
            When a new report shows a purchase of a tokenized stock, Coattails buys it for you with USDC from your
            wallet. Your exit rules decide when it sells.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="per-trade">Per trade</FieldLabel>
            <Choice id="per-trade" value={prefs.perTradeUsd} options={PER_TRADE} onChange={prefs.setPerTrade} format={(v) => `$${v}`} />
          </Field>
          <Field>
            <FieldLabel htmlFor="budget">Budget</FieldLabel>
            <Choice
              id="budget"
              value={prefs.budgetUsd}
              options={BUDGET.filter((b) => b >= prefs.perTradeUsd)}
              onChange={prefs.setBudget}
              format={(v) => `$${v}`}
            />
            <FieldDescription>The most Coattails can ever spend from your USDC.</FieldDescription>
          </Field>
          <FieldSeparator />
          <Field>
            <FieldLabel htmlFor="trailing-stop">Trailing stop</FieldLabel>
            <Choice
              id="trailing-stop"
              value={prefs.trailingStopPct}
              options={STOPS}
              onChange={prefs.setTrailingStop}
              format={(v) => (v === null ? "Off" : `${Math.round(v * 100)}%`)}
            />
            <FieldDescription>Sell if the price falls this far below its highest point since you bought.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="max-hold">Time limit</FieldLabel>
            <Choice
              id="max-hold"
              value={prefs.maxHoldDays}
              options={HOLDS}
              onChange={prefs.setMaxHold}
              format={(v) => (v === null ? "Off" : `${v}d`)}
            />
            <FieldDescription>Sell after this many days if no sale has been reported.</FieldDescription>
          </Field>
        </FieldGroup>

        <p className="border-l-2 border-stamp/40 pl-3 text-xs leading-relaxed text-muted-foreground">
          Your USDC stays in your wallet and bought stock goes to your wallet. Coattails pays the network fees, and you
          can revoke the allowance at any time.
        </p>

        <DialogFooter className="gap-2 sm:justify-between">
          {!wallet ? (
            <p className="self-center text-sm text-muted-foreground">Connect a wallet from the top bar to continue.</p>
          ) : needsFunds && CLUSTER === "devnet" ? (
            <Button variant="outline" onClick={() => faucet.mutate()} disabled={faucet.isPending}>
              {faucet.isPending ? <Spinner data-icon="inline-start" /> : <Drop data-icon="inline-start" />}
              Get 100 test USDC
            </Button>
          ) : (
            <Link href="/app/portfolio" className="self-center text-xs text-muted-foreground hover:text-foreground">
              Wallet: {usd(balance)} USDC
            </Link>
          )}
          <Button onClick={() => follow.mutate()} disabled={!wallet || follow.isPending || needsFunds}>
            {follow.isPending && <Spinner data-icon="inline-start" />}
            {follow.isPending ? "Waiting for your wallet…" : `Approve ${usd(prefs.budgetUsd, 0)} and mirror`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

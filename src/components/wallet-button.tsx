"use client"

import { Copy, SignOut, Wallet } from "@phosphor-icons/react"
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { shortAddress } from "@/lib/format"
import { client } from "@/lib/solana-client"

function WalletMenu() {
  const wallets = useWallets(client)
  const connected = useConnectedWallet(client)
  const status = useWalletStatus(client)
  const { dispatch: connect } = useConnect(client)
  const { dispatch: disconnect } = useDisconnect(client)

  if (connected) {
    const address = connected.account.address
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="font-mono tabular-nums">
            {connected.wallet.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connected.wallet.icon} alt="" className="size-4" />
            ) : (
              <Wallet />
            )}
            {shortAddress(address)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal text-muted-foreground">{connected.wallet.name}</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => {
              navigator.clipboard.writeText(address)
              toast("Address copied")
            }}
          >
            <Copy /> Copy address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => disconnect()}>
            <SignOut /> Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const busy = status === "connecting" || status === "reconnecting"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={busy}>
          <Wallet />
          {busy ? "Connecting" : "Connect wallet"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {wallets.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.
          </div>
        ) : (
          wallets.map((w) => (
            <DropdownMenuItem key={w.name} onSelect={() => connect(w)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.icon} alt="" className="size-4" />
              {w.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WalletButton() {
  return <WalletMenu />
}

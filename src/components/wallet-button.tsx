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
import { Spinner } from "@/components/ui/spinner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
              <img src={connected.wallet.icon} alt="" width={16} height={16} data-icon="inline-start" className="size-4" />
            ) : (
              <Wallet data-icon="inline-start" />
            )}
            {shortAddress(address)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal text-muted-foreground">{connected.wallet.name}</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                navigator.clipboard.writeText(address)
                toast("Address copied")
              }}
            >
              <Copy /> Copy address
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => disconnect()}>
              <SignOut /> Disconnect
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const busy = status === "connecting" || status === "reconnecting"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
          {busy ? "Connecting…" : "Connect wallet"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {wallets.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.
          </div>
        ) : (
          <DropdownMenuGroup>
            {wallets.map((w) => (
              <DropdownMenuItem key={w.name} onSelect={() => connect(w)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.icon} alt="" width={16} height={16} className="size-4" />
                {w.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WalletButton() {
  return <WalletMenu />
}

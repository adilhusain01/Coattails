"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ThemeToggle } from "@/components/theme-toggle"
import { WalletButton } from "@/components/wallet-button"
import { CLUSTER } from "@/lib/cluster"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/app", label: "Filings" },
  { href: "/app/people", label: "People" },
  { href: "/app/receipts", label: "Receipts" },
  { href: "/app/portfolio", label: "Portfolio" },
  { href: "/app/demo", label: "Demo" },
  { href: "/app/agent", label: "Agent" },
]

export function SiteHeader() {
  const pathname = usePathname()
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight">Coattails</span>
          {CLUSTER === "devnet" && (
            <span className="rounded-sm border border-stamp/40 px-1 font-mono text-[10px] text-stamp">devnet</span>
          )}
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-sm px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                  active && "bg-secondary text-foreground",
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
      <nav className="flex border-t md:hidden">
        {NAV.map((item) => {
          const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex-1 py-2 text-center text-xs text-muted-foreground",
                active && "bg-secondary font-medium text-foreground",
              )}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}

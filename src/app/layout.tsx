import type { Metadata, Viewport } from "next"
import { JetBrains_Mono, Public_Sans } from "next/font/google"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { Providers } from "@/components/providers"
import { cn } from "@/lib/utils"
import "./globals.css"

const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans" })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" })

export const metadata: Metadata = {
  title: { default: "Coattails", template: "%s | Coattails" },
  description:
    "Copy the stock trades members of Congress disclose, into tokenized stocks on Solana. Every fill traces back to the public filing.",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6faf4" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1713" },
  ],
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("h-full antialiased", publicSans.variable, jetbrainsMono.variable)}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  )
}

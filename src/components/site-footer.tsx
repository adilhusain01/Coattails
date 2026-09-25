export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-3 px-4 py-8 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2 sm:px-6">
        <p>
          Trades come from Periodic Transaction Reports filed with the Clerk of the US House and from insider
          purchases on SEC Form 4. House members have up to 45 days to disclose, so every filing shows what the delay
          cost.
        </p>
        <p>
          Tokenized stocks are not offered to US persons. Coattails never holds your funds: it spends only the USDC
          allowance you approve, and you can revoke it from any wallet. Not investment advice.
        </p>
      </div>
    </footer>
  )
}

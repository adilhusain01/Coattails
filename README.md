# Coattails

Coattails copies the stock trades that members of Congress and company insiders disclose into
tokenized stocks on Solana, for anyone outside the US.

Autopilot proved people want this: it manages $1.3B, has about 3M downloads, and $400M of that
copies Nancy Pelosi alone. But Autopilot needs a US brokerage account. xStocks are sold only
outside the US. Coattails connects the two.

Built for the Stocklana hackathon (Solana, September 2026).

## What happens when a member files

1. **The filing is published.** House members file Periodic Transaction Reports (PTRs) with the
   Clerk, up to 45 days after trading. Company insiders file SEC Form 4 within two business days.
2. **The agent reads it.** Sarvam AI (`sarvam-105b`) turns each PTR into structured trades. Text
   comes from the PDF's text layer; scanned paper forms go through Sarvam Document Intelligence
   OCR first. Form 4 is XML and is parsed directly. Each trade's ticker is matched against 950 US
   xStocks.
3. **A receipt goes on-chain.** Before any trade, the agent writes a Memo transaction with the
   filing's sha256 hash. Anyone can check that a fill copied a real public document.
4. **Followers' wallets mirror it.** For every follower, the agent spends that follower's
   per-trade amount of USDC through an SPL allowance they approved. The stock lands in the
   follower's own token account. Each fill is checked against the live Pyth price, and its memo
   points back to the filing receipt.

## Exits

Reports arrive late, so a member can sell weeks before anyone sees it. Every position bought
through Coattails carries its own exit rules, set when you start following someone and checked
against the live price every 20 seconds:

- a trailing stop (10%, 15% or 25% below the highest price since purchase, or off)
- a time limit (30, 90 or 180 days without a reported sale, or off)
- a reported sale by the member sells only what was bought from that member

Selling needs one extra signature per stock: an allowance on that stock account only. The
portfolio asks for it as soon as a position exists without it.

## Why Solana

- **Global.** A wallet works in any country. A brokerage account does not.
- **24/7.** Filings are published at any hour. xStocks trade around the clock, so a Friday-night
  filing mirrors on Friday night, not at Monday's open.
- **Small amounts.** Fees are a fraction of a cent, so a $10 mirror makes sense.
- **Self-custody without a program.** Nothing is pooled. Following means one SPL `approve`
  capped at your budget. The agent can only spend what you approved, the stock goes to your own
  account, and you can revoke from Coattails or any wallet app.
- **Public receipts.** Every filing and every fill is a transaction anyone can audit. Autopilot's
  process is a black box.

## What's in the repo

| Path | What it does |
|---|---|
| `src/server/ingest/house.ts` | House Clerk yearly index: new PTRs, member photos and party |
| `src/server/agent/read-ptr.ts` | Sarvam AI reads a PTR PDF (text layer or OCR) into structured trades |
| `src/server/ingest/sec.ts` | EDGAR Form 4: open-market insider purchases in tokenized stocks |
| `src/server/registry.ts` | Ticker to xStock mint (US listings only) |
| `src/server/prices.ts` | Pyth Hermes live prices and Benchmarks history, with Jupiter and Yahoo as keyless fallbacks |
| `src/server/solana/agent.ts` | Agent key: receipts, gasless follow (agent pays fees), fills, revoke |
| `src/server/pipeline.ts`, `worker/index.ts` | Two loops: ingest and read every minute; receipts, mirrors and exits every 20 seconds |
| `scripts/e2e.ts` | Devnet end-to-end: faucet, gasless follow, mirrored buys, allow selling, trailing-stop exit |
| `src/app/page.tsx` | Landing page; the app lives under `/app` |
| `src/app/api/actions/*`, `src/app/actions.json` | Solana Actions: share `/app/p/<member>` and it unfolds as a "Mirror" Blink |
| `docs/ARCHITECTURE.md` | Design and custody model |
| `docs/INTEGRATIONS.md` | Verified API facts for every data source |

## Cluster modes

The deployment runs on **devnet**. xStocks do not exist on devnet, so the agent creates a test
USDC mint and a Token-2022 stand-in for each xStock it needs (with on-chain name and symbol), and
fills at the live price. On **mainnet** the only change is the fill step: a Jupiter swap from the
follower's USDC into the real xStock, with `destinationTokenAccount` set to the follower's own
account. Everything else is the same code.

## Run it

```sh
npm install
cp .env.example .env        # SARVAM_API_KEY, PYTH_API_KEY, SOLANA_RPC_URL (blank = public devnet)
npx drizzle-kit push        # creates data/coattails.db
# agent key: keys/agent.json (Solana CLI format); fund it with devnet SOL at faucet.solana.com
npx tsx --env-file=.env scripts/sync-index.ts 60     # House index
npx tsx --env-file=.env scripts/sync-form4.ts 7      # last 7 days of insider buys
npx pm2 start ecosystem.config.cjs --only coattails-web,coattails-worker
```

## Stack

Next.js 16, React 19, shadcn/ui, Tailwind v4, TanStack Query, Zustand, `@solana/kit` 8 with
Wallet Standard, `@solana-program/*`, Drizzle on libSQL, Sarvam AI SDK (`sarvam-105b`, Document Intelligence), unpdf, Pyth
Hermes, Jupiter.

## Limits

- Disclosures are late: House members have up to 45 days. Every filing shows the price move
  between the trade and its disclosure, so followers see what the delay cost. Insider Form 4s
  arrive within two days.
- Not every stock is tokenized. Trades without an xStock are shown and marked "not tokenized".
- xStocks are not offered to US persons. Not investment advice.

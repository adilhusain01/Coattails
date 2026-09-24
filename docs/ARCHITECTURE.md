# Coattails architecture

Coattails mirrors publicly disclosed trades (US House Periodic Transaction Reports and SEC Form 4
insider purchases) into tokenized stocks on Solana, for anyone outside the US. Autopilot proved the
demand ($1.3B AUM) but needs a US brokerage; xStocks are sold only outside the US.

Hackathon: Stocklana, submissions close Fri 2026-09-25 16:00 ET. Judged on "could this be a real
app people will actually use?": real need, working end-to-end demo, why Solana, execution quality.

## The loop

```
House Clerk FD index ──┐                                   ┌─> follower wallet A (own USDC, own xStock ATA)
SEC EDGAR Form 4 feed ─┼─> ingest ─> Claude reads PDF ─> trades ─> match ticker ─> Memo receipt ─> executor ─┼─> follower wallet B
                       │   (worker)  (structured output)          to token mint   (filing hash)   (Pyth guard) └─> ...
```

1. **Ingest** (`src/server/ingest/*`, run by `worker/index.ts`): polls the House Clerk 2026 index
   for new PTRs and EDGAR for new Form 4 filings with transaction code `P`.
2. **Read**: every PTR PDF goes to Claude (PDF document input, structured output). E-filed and
   scanned/handwritten forms go through the same path. Output: ticker, asset name, side, amount
   range, trade date, notification date.
3. **Match**: ticker to tokenized-stock mint via the registry (`src/server/registry.ts`, xStocks
   first, Ondo second). Unmatched tickers are stored and shown as "not tokenized yet".
4. **Receipt**: one Memo transaction per filing, signed by the agent key:
   `coattails:v1|<source>|<docId>|sha256:<pdf hash>|<n> trades`. Every mirror execution references
   that receipt signature, so any fill traces back to a public document.
5. **Execute**: for each follower of that source with an active allowance, the agent moves the
   per-trade budget out of the follower's USDC account (SPL delegate, capped by the follower) and
   fills the tokenized stock into the follower's own token account.
   - Price guard: fills are checked against the live Pyth price for the tokenized stock and its
     underlying equity. Out-of-band quotes are rejected and logged.
   - Sells: if the follower holds the token and approved auto-sell, the agent sells it back to USDC
     into the follower's USDC account.

## Custody model

No pooled funds and no custom program. A follower's "vault" is their own wallet:

- **Follow** = one transaction the follower signs: SPL `approve` on their USDC account with the
  agent as delegate, capped at the budget they choose. The agent pays the fee (gasless follow).
- **Unfollow / revoke** = SPL `revoke`, from Coattails or any wallet UI.
- The agent can only move what was approved, and output always lands in the follower's own ATA.

## Cluster modes (`NEXT_PUBLIC_CLUSTER`)

| | devnet (current) | mainnet-beta |
|---|---|---|
| USDC | Coattails test USDC mint (faucet button) | Circle USDC |
| Tokenized stocks | Token-2022 stand-in mints, one per xStock symbol | real xStocks mints |
| Fill | agent settles at the live Pyth price: pulls USDC via delegate, mints the stand-in token to the follower | Jupiter swap, `destinationTokenAccount` = follower ATA |
| Prices | Pyth Hermes (real, same feeds) | Pyth Hermes |

Everything except the fill function is identical across modes.

## Stack

- Next.js 16 App Router, React 19, TypeScript. UI: shadcn (radix-lyra preset), Tailwind v4 classes
  inline in JSX, theme tokens in `globals.css` only. Icons: Phosphor (shadcn default) plus
  better-icons SVGs where Phosphor lacks one. No emojis.
- Client state: Zustand (UI prefs, pending actions). Server state: TanStack Query.
- Solana: `@solana/kit` 8 plugin clients, `@solana/kit-plugin-wallet` (Wallet Standard),
  `@solana-program/{system,token,token-2022,memo}`. Transactions are v0 for wallet compatibility.
- Data: libSQL (SQLite file) via Drizzle ORM. `data/coattails.db`.
- Agent: `@anthropic-ai/sdk`, PDF document input, structured output.
- Prices: Pyth Hermes (latest) and Pyth Benchmarks (historical, for disclosure-lag cost).
- Runtime: pm2 runs `web` (next start, port 3000) and `worker` (tsx). Public URL via Tailscale Funnel.

## Layout

```
src/app/                 routes (UI + route handlers)
  page.tsx               latest filing as a receipt, who to follow, live receipts tape
  p/[slug]/page.tsx      one member or insider: trades, lag cost, follow
  receipts/page.tsx      public receipt log
  me/page.tsx            my follows, allowance, positions, revoke
  api/...                JSON for TanStack Query; follow tx builder; faucet; Solana Actions (Blinks)
src/components/          UI (shadcn in components/ui)
src/lib/                 client-safe helpers (formatting, cluster config, query keys)
src/server/              server-only: db, registry, pyth, solana agent, ingest, executor
worker/index.ts          polling loop: ingest -> receipt -> execute
scripts/                 one-off: devnet setup (mints), seed, backfill
```

## Sponsor bounties targeted

- Main track.
- Pyth: price guard on every fill, fill price source on devnet, disclosure-lag cost from Benchmarks.
- Clawpump + Meteora DBC: launch the Coattails agent token with a stock-paired pool (operational,
  mainnet).
- PreStocks (stretch): a "venture mirror" portfolio of pre-IPO names.

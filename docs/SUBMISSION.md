# Stocklana submission: Coattails

## Project name

Coattails

## Tagline

Copy the stock trades members of Congress disclose, into tokenized stocks in your own Solana wallet.

## Short description

Members of the US House have to report their stock trades, and company insiders report their own
purchases to the SEC. Coattails reads every report as it comes out and buys the same stocks for its
followers as tokenized shares on Solana. The stock lands in the follower's own wallet, every
purchase links to an on-chain receipt of the filing it copied, and exit rules sell the position if
the price falls or time runs out, because reports arrive weeks after the trade.

Autopilot manages $1.3 billion for people who copy politicians' trades, about $400 million of it
following Nancy Pelosi, but it needs a US brokerage account. Tokenized stocks are sold only outside
the US. Coattails is the same idea for everyone Autopilot can't serve.

## How it works

1. The worker polls the House Clerk for Periodic Transaction Reports and SEC EDGAR for Form 4
   insider purchases.
2. The PDF goes straight to GPT-6 Luna, which fills a strict JSON schema with every trade on the
   form. Typed and scanned paper forms take the same path; a scan Luna can't read cleanly is retried
   on Gemini 3.8 Flash. Form 4 is XML and is parsed directly.
3. Each ticker is matched to one of 947 US stocks available as xStocks.
4. Before anything is bought, the agent writes the report's SHA-256 hash to Solana in a Memo
   transaction.
5. For each follower, the agent spends their per-trade amount from USDC they approved with a single
   SPL `approve`, and the tokenized stock goes into their own token account. The fill's memo points
   back to the filing receipt.
6. Every 20 seconds the agent checks each open position against the live price. A trailing stop, a
   time limit, or a report that the member sold will sell it, and a reported sale only sells what was
   bought from that member.

Followers never need SOL: Coattails builds each transaction with itself as fee payer, the follower's
wallet signs, and the server co-signs only the exact transaction it built.

## Why Solana

A wallet works in any country where tokenized stocks are offered, and a brokerage account does not.
xStocks trade outside market hours, so a report published on a Friday night is copied that night.
Fees are small enough that a $10 copy makes sense. Custody stays with the follower, since nothing is
pooled and the agent only holds a capped allowance that the follower can revoke from any wallet.
Every filing receipt and every fill is a public transaction.

## What is live

- Site: https://coattails.adilhusain.xyz
- App (Solana devnet, test USDC, live prices): https://coattails.adilhusain.xyz/app
- Live demo, four scenarios run end to end on devnet: https://coattails.adilhusain.xyz/app/demo
- Agent token COAT on mainnet: `5JtyjnqicMFsT59BxJhT3TURqwwgASwCeQUQXj5SdgWN`
- COAT/NVDAx Meteora DAMM v2 pool on mainnet: `D8iqEXcL4xpy8gHDiSdaQVhiGveqoNYrt9uZrFK3j9P9`
- Code: https://github.com/adilhusain01/Coattails

As of September 25 the agent has read 72 House reports and 24 insider Form 4s covering 127 people,
found 1,612 trades of which 505 are in tokenized stocks, and written 96 receipts. The rest of the
400 House reports filed in 2026 are being read now. Across the reports read so far, trades were
disclosed 27.5 days after they happened on average, and every filing in the app shows how far the
stock moved in that time.

The demo scenarios use real reports and each stock's real daily closes from the report date,
replayed one trading day per tick: a member reports a sale and Coattails sells, the price falls
through a 10% trailing stop, a 30-day limit runs out, and a $25 budget runs out partway through a
report.

## Sponsor tracks

### Clawpump

COAT, the agent's own token, was launched through Clawpump's self-funded launch with its pump.fun
curve priced in NVDAx instead of SOL. It also has a full-range Meteora DAMM v2 pool against NVDAx.
Clawpump sends 75% of COAT's trading fees to the agent's wallet, which is how Coattails plans to pay
for the model reads and the network fees it covers for followers. The launch and pool scripts are
in `scripts/launch/`, and `/app/agent` shows the token, the pool's reserves and what the agent has
paid for so far.

### Pyth

Pyth is the first price source the agent asks. The live app runs on a Pyth Pro Demo trial, which
grants the `Equity.US` feeds for TSLA, QQQ and VOO. For those three, the price behind every fill and
every trailing-stop check comes from Hermes, and a trade's price on its trade and disclosure dates
comes from Pyth Pro's daily candles (the trial keeps them from May 22).
Pyth Pro refuses any feed the plan doesn't grant, NVDA included, so every other stock is priced by
Jupiter live and by Yahoo for past closes. Adding a ticker to the plan and to
`PYTH_EQUITY_TICKERS` moves it onto Pyth without code changes.

### Meteora

The COAT/NVDAx pool is a Meteora DAMM v2 pool created with the `cp-amm` SDK, opened at the price set
by two seed buys, with both tokens deposited. We did not use DBC.

## Tech

Next.js 16, React 19, shadcn/ui, Tailwind v4, TanStack Query, Zustand, `@solana/kit` 8 with Wallet
Standard, `@solana-program/*`, Drizzle on libSQL, the OpenAI SDK against OpenRouter (GPT-6 Luna,
Gemini 3.8 Flash), Jupiter, Pyth Hermes, the Meteora DAMM v2 SDK, and the Clawpump API. Hosted on a
VPS behind Caddy.

## Limits

House members have up to 45 days to report, so a follower never gets the member's price. Insider
Form 4s arrive within two business days. Only stocks with an xStock are copied, and the rest are shown
as not tokenized. The copy-trading app runs on devnet today; on mainnet the only change is that each
purchase is a Jupiter swap into the real xStock, which is written and quoted but not yet sent with
real funds. Tokenized stocks are not offered to US persons, and Coattails is not investment advice.

---

# Demo video script (about 3 minutes)

Record at https://coattails.adilhusain.xyz with a devnet Phantom wallet that already has a follow in
place, so nothing waits on a first-time signature.

**0:00 to 0:20. Landing page, hero.**
"Autopilot manages over a billion dollars for people who copy politicians' stock trades. It only
works with a US brokerage account. Coattails does it on Solana, for everyone outside the US."

**0:20 to 0:50. Scroll to "Follow one trade".**
Show stages 1 and 2. "This is a real report. Nancy Pelosi bought Bloom Energy on July 24 and
reported it 28 days later. By then the stock was up 9%, and Coattails shows that on every filing."
Point at stage 5. "Before anything is bought, the report's fingerprint goes on Solana as a receipt."

**0:50 to 1:30. Open the app, then Pelosi's page, then Mirror.**
Open the follow dialog. "I pick $10 a trade, a $50 budget, a 15% trailing stop and a 90-day limit.
One signature approves the budget. Coattails pays the fee, so I need no SOL, and the stock will land
in my own wallet." Approve in Phantom and show the toast.

**1:30 to 2:20. Demo page, run "The price drops".**
"Each scenario is a new wallet and real devnet transactions." Let the timeline fill in while the
chart plays back. "This is the stock's real daily closes. When it falls 10% below its high, the stop
sells without waiting for a report." Click one transaction link to show it on Solana Explorer.

**2:20 to 2:40. Receipts page.**
Click a receipt and show the memo holding the filing hash on Explorer. "Every fill links back to the
filing it copied."

**2:40 to 3:00. Agent page.**
"The agent pays for every read and every fee. Its token, COAT, is live on mainnet, launched through
Clawpump against NVDAx with a Meteora pool, and 75% of its trading fees go to the agent."
End on the landing page URL.

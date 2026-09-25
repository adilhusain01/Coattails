# Coattails integration reference

Everything below was checked with live requests on **2026-09-24, 07:45–08:10 UTC** (03:45 ET Thursday, when US equity markets were closed). **[UNVERIFIED]** marks anything I could not confirm with a real call.

## TL;DR: blockers and decisions

| Area | Status |
|---|---|
| House Clerk FD index + PTR PDFs | Free, no key. Electronic PTRs contain extractable text. Paper PTRs (DocID `8xxxxxx`/`9xxxxxx`) are image scans with no text, so they need Claude vision on the PDF. |
| SEC EDGAR Form 4 | Free, no key. **A descriptive `User-Agent` is required**: without one, EDGAR returns `403`. The fair-access limit is 10 req/s. |
| xStocks list | Free public API. **1,124 xStocks**, all Token-2022, 8 decimals, ScaledUiAmount. Full list: `docs/xstocks-mints.json`. |
| Ondo GM list | No keyless official list found. Built from Jupiter's verified token list, which has 449 `…on` tokens (Token-2022, **9 decimals**). Saved as `docs/ondo-mints.json`. |
| Jupiter | **`api.jup.ag` works keyless at 0.5 RPS** (30/min). A free key (1 RPS) is available at developers.jup.ag/portal. Metis `/swap/v1/*` is "no longer actively maintained" and replaced by **Swap V2 (`/swap/v2/build`, `/swap/v2/order`)**. USDC→NVDAx routes fine (0.16% impact at $10). **Ondo tokens route well only via JupiterZ RFQ (`/order`). `/build` (Metis only) gave 20.7% impact on NVDAon.** |
| **Pyth Hermes** | **BLOCKER: since 2026-08-26, every Hermes price request needs a Pyth API key.** Keyless calls return `401 unauthorized`. The metadata endpoints (`/v2/price_feeds`) still work keyless. Sign up at Pyth Terminal (free trial). Benchmarks `/v1/updates/price/*` also returns 401, and the TradingView shim returns 404. The on-chain Solana push accounts for equity feeds are stale (NVDA last updated 2026-08-26). Keyless fallback price sources: Jupiter Price v3 (`stockData`) and xStocks `/price-data`. |
| Clawpump | Launch goes through the REST API with a `cpk_` key: sign up with Google, or use the `agent_signup` MCP tool (Ed25519). Costs 0.012 SOL (0.018 with an initial buy). On-chain it's a **pump.fun curve with a stock quote mint** (`pumpQuoteMint`). For the Meteora part, add a Meteora pool yourself. |
| Meteora DBC | `@meteora-ag/dynamic-bonding-curve-sdk@1.5.12`. xStocks and Ondo tokens **have DBC and DAMM v2 token badges** on-chain, so they can be the quote mint. |
| Solana Actions | `@solana/actions@1.6.6`. The last release was 2024-11-05 and the repo has had no pushes since 2024-11. It still works. Unfurling on X needs Dialect registry approval. |
| create-solana-dapp | v4.8.5. **No gill templates anymore.** Use `web3js-next-tailwind` (wallet adapter + TanStack Query + shadcn) or `nextjs` (@solana/kit + swr). |

---

## 1. House Clerk: Periodic Transaction Reports

### Yearly index
- **URL:** `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip` (no auth). The ZIP contains `2026FD.xml` and `2026FD.txt` (the same data, tab-separated).
- Observed: 60 KB zip, `Last-Modified: Wed, 23 Sep 2026 13:00:14 GMT`, `cache-control: max-age=27159`. The newest PTR had `FilingDate` 9/22/2026. It appears to be **rebuilt about once a day**; this is an inference from Last-Modified, not a documented schedule. Poll it every 1–6 h and use `If-Modified-Since`/ETag.
- 2026 counts: 1,689 rows. `FilingType`: C=824, **P=400 (PTRs)**, X=247, W=102, D=74, A=38, H=2, T=2.

```xml
<FinancialDisclosure>
  <Member>
    <Prefix>Hon.</Prefix><Last>Pelosi</Last><First>Nancy</First><Suffix />
    <FilingType>P</FilingType>          <!-- P = Periodic Transaction Report -->
    <StateDst>CA11</StateDst><Year>2026</Year>
    <FilingDate>6/23/2026</FilingDate>  <!-- M/D/YYYY -->
    <DocID>20034836</DocID>
  </Member>
```
To filter, keep `Member` rows where `FilingType == 'P'`. Dedupe on `DocID`. A new PTR is a `DocID` you have not seen before.

### PTR PDF
- **URL pattern:** `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{Year}/{DocID}.pdf`
- DocIDs starting with `2` (8 digits, 354 of the 400) are **e-filed** and contain a real text layer. DocIDs starting with `9` or `8` (7 digits, 46 of the 400) are **paper scans with no text layer**, so send the PDF to Claude as a document or image. Example: `9116249` returned an empty text extraction.
- Non-PTR filings use `/public_disc/financial-pdfs/{Year}/{DocID}.pdf`.
- Text extracted from `20034836.pdf` (Pelosi, filed 2026-06-23). The small-caps headers come out garbled:
```
Name: Hon. Nancy Pelosi
Status: Member
State/District: CA11
ID Owner Asset Transaction Type Date Notification Date Amount Cap. Gains > $200?
SP Intel Corporation - Common Stock
(INTC) [OP]
P 05/29/2026 05/29/2026 $1,000,001 -
$5,000,000
F      S     : New
D          : Purchased 200 call options with a strike price of $50 and an expiration date of 3/19/27.
SP Uber Technologies, Inc. Common
Stock (UBER) [OP]
P 05/29/2026 05/29/2026 $500,001 -
$1,000,000
...
Digitally Signed: Hon. Nancy Pelosi , 06/23/2026
Filing ID #20034836
```
- Another sample (`20035492`, Allen GA12, filed 9/22): `SP Broadcom Inc. - Common Stock (AVGO) [ST]  P 08/12/2026 09/15/2026 $1,001 - $15,000`.
- Parsing notes for the Claude prompt:
  - Owner codes: `SP` spouse, `JT` joint, `DC` dependent child, blank for self.
  - Type: `P` purchase, `S` sale, `S (partial)`, `E` exchange.
  - Asset tags: `[ST]` stock, `[OP]` option, `[GS]` gov security, and others; the full list is at https://fd.house.gov/reference/asset-type-codes.aspx.
  - Amount is a **range**. Ticker is in parentheses.
  - Transaction date can be up to 45 days before the notification date, so show the lag in the UI.
  - Copy only `[ST]` purchases, or treat `[OP]` calls as "bullish on the underlying" if you decide to.

## 2. SEC EDGAR Form 4

**All requests need `User-Agent: <App> <contact email>`.** Without it, EDGAR returns `403` (verified). The SEC's fair-access limit is 10 req/s per client.

### Fastest feed of new filings
1. **Atom "current events"** (near real time):
   `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=include&count=100&output=atom`
   Each accession appears twice, once as `(Issuer)` and once as `(Reporting)`, so dedupe on `<id>urn:tag:sec.gov,2008:accession-number=...`.
   ```xml
   <entry><title>4 - PRIMEENERGY RESOURCES CORP (0000056868) (Issuer)</title>
   <link href="https://www.sec.gov/Archives/edgar/data/56868/000143774926031099/0001437749-26-031099-index.htm"/>
   <summary>Filed: 2026-09-23 AccNo: 0001437749-26-031099 Size: 4 KB</summary>
   <updated>2026-09-23T21:48:00-04:00</updated>
   <category term="4"/><id>urn:tag:sec.gov,2008:accession-number=0001437749-26-031099</id></entry>
   ```
2. **Daily index (for backfill):** `https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/form.20260923.idx`. This is fixed-width text; lines starting with `4 ` are Form 4s, and the last column is `edgar/data/{cik}/{accession}.txt`. There were 608 Form 4 lines on 2026-09-23.
3. **Full-text search JSON:** `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=2026-09-23&enddt=2026-09-24`. It returns Elasticsearch-style `hits.hits[]._source` with `adsh`, `ciks`, `display_names`, and `file_date`. There were 297 hits.
4. **Per-company:** `https://data.sec.gov/submissions/CIK##########.json` (10-digit zero-padded). It has `filings.recent.{form[],accessionNumber[],acceptanceDateTime[],primaryDocument[]}`.
   - **Gotcha:** `primaryDocument` looks like `xslF345X06/wk-form4_1790161217.xml`, which is the **rendered HTML**. Strip the `xslF345X06/` prefix to get the raw XML.

### Getting the XML
- The full submission at `https://www.sec.gov/Archives/edgar/data/{cik}/{accessionNoDashes}/{accession}.txt` contains `<XML><ownershipDocument>…`.
- Alternatively, `…/{accessionNoDashes}/index.json` lists the files; pick the `.xml` whose name does not start with `xsl`.
- In practice, 5 of the first 15 Form 4s scanned from 2026-09-23 had code `P`.

### Fields (trimmed real example: ADC, accession 0001747962-26-000007)
```xml
<ownershipDocument>
  <documentType>4</documentType><periodOfReport>2026-09-21</periodOfReport>
  <issuer><issuerCik>0000917251</issuerCik><issuerName>AGREE REALTY CORP</issuerName>
          <issuerTradingSymbol>ADC</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerName>Erlich Craig</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer>
      <isTenPercentOwner>0</isTenPercentOwner><officerTitle>CHIEF GROWTH OFFICER</officerTitle>
    </reportingOwnerRelationship></reportingOwner>
  <aff10b5One>0</aff10b5One>                       <!-- 1 = 10b5-1 plan trade -->
  <nonDerivativeTable><nonDerivativeTransaction>
    <securityTitle><value>Common Shares</value></securityTitle>
    <transactionDate><value>2026-09-21</value></transactionDate>
    <transactionCoding><transactionCode>P</transactionCode></transactionCoding>  <!-- P = open-market purchase -->
    <transactionAmounts>
      <transactionShares><value>1000</value></transactionShares>
      <transactionPricePerShare><value>67.55</value></transactionPricePerShare>
      <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
    </transactionAmounts>
    <postTransactionAmounts><sharesOwnedFollowingTransaction><value>60388</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
  </nonDerivativeTransaction></nonDerivativeTable>
```
Filter: `nonDerivativeTransaction` with `transactionCode == P` and `A/D == A`. The dollar value is shares × price, summed across rows. Prices can be `<footnoteId>` references (weighted average). Ticker→CIK map: `https://www.sec.gov/files/company_tickers.json`.

## 3. xStocks and Ondo on Solana

### xStocks API (public, no key)
- `GET https://api.xstocks.fi/api/v2/public/assets?page=N` is **0-indexed** and returns `{nodes:[…100], page:{currentPage, hasNextPage}}`. There were 12 pages, **1,124 assets, all with a Solana deployment**.
- Rate limit header: `x-ratelimit-limit: 1000` (window not stated). Cloudflare blocks Python's default urllib UA with a 403, so send a UA.
- Other public endpoints:
  - `/public/assets/{symbol}`
  - `/public/assets/{symbol}/price-data`, which returned `{"quote":224.19}` for NVDAx
  - `/public/assets/{symbol}/multiplier?network=Solana`; `network` is required
  - `/public/system/status/{symbol}`
  - `/public/corporate-actions/upcoming`
  - `/public/oracles/{symbol}`: Chainlink feeds on EVM chains, not Solana
- The asset node includes `symbol`, `underlyingSymbol`, `isTradingHalted`, `trading.tradingHoursMode` (`TwentyFourFive`=931, `MarketHours`=104, `Regular`=87), `trading.currentPeriod`, `trading.openNow`, and `deployments[{network:"Solana", address}]`.
- On-chain check via `getMultipleAccounts` for all 1,124 mints: **owner `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token-2022), decimals 8**. Every mint has the same extensions: `scaledUiAmountConfig`, `permanentDelegate`, `pausableConfig`, `defaultAccountState(initialized)`, `transferHook(programId=null)`, `confidentialTransferMint`, `metadataPointer`, `tokenMetadata`.
- Key mints: NVDAx `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`, AAPLx `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`, TSLAx `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`, SPYx `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W`, INTCx `XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM`, UBERx `XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB`, AVGOx `XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo`, TSMx `XsafvsGtzFqqHgTnA3aPC83EAMkacU5mcGtcSayhpVV`.
- `docs/xstocks-mints.json` has one entry per asset: `{symbol, underlying, name, mint, decimals, program, multiplier (effective, snapshot 2026-09-24), tradingHoursMode, isTradingHalted, listingCountry, exchange}`.
- Listing countries: US 950, GB 93, HK 79, ES 1, DE 1. **When matching tickers from House or SEC filings, filter on `listingCountry == "US"`**, because LSE and HKEX codes can collide with US tickers. Jupiter's `xstocks` tag also has TEFx and WBSx, which are not in the xStocks API; treat them as delisted.

### ScaledUiAmount gotchas
- The on-chain **raw amount never changes**. UI amount = raw × multiplier. The multiplier covers dividends reinvested and splits.
- NVDAx right now: `multiplier 1.0009180758`, `newMultiplier 1.0017011968`, `newMultiplierEffectiveTimestamp 1789000200` (2026-09-10). The effective timestamp is in the past, so the **effective multiplier is `newMultiplier`**. Always compute `now >= newMultiplierEffectiveTimestamp ? newMultiplier : multiplier`; Jupiter's `usdPrice` already does this.
- Build transactions with **raw** amounts. Show users **scaled** amounts. Share-equivalent price = raw price / multiplier.
- `permanentDelegate` and `pausableConfig` mean the issuer can move or freeze tokens. Mention this in the risk copy.
- xStocks are not for US persons. Keep the geo notice.

### Ondo Global Markets (`…on`)
- No keyless list endpoint was found. docs.ondo.finance has an API, but a key is **[UNVERIFIED]**. I built `docs/ondo-mints.json` from Jupiter's verified list (`GET https://lite-api.jup.ag/tokens/v2/tag?query=verified`, filtered on tag `ondo`): **449 tokens, all Token-2022, 9 decimals**. The mint addresses end in `…ondo`, e.g. NVDAon `gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo`.
- Also Token-2022 with `scaledUiAmountConfig` and `pausableConfig`. Authority is `9foMHsSDq7nMg4WPusSz9eY7tyxyukqborA8GyU5cUxD`. **No permanentDelegate** was seen on NVDAon or AAPLon.
- **AMM liquidity is tiny** (by Jupiter `liquidity`: SPYon $9.4k, NVDAon $486). Ondo fills come from JupiterZ RFQ (see §4). Prefer xStocks; use Ondo only as a fallback when there is no xStock.
- Beware the fake NVDAon (`3XzHC…`, classic SPL, tag `unknown`). Always match on the verified mint.

## 4. Jupiter

### Base URLs and auth (verified)
| Host | Status on 2026-09-24 |
|---|---|
| `https://api.jup.ag` | **Works keyless** at 0.5 RPS / 30 per minute (sliding 60 s window). With `x-api-key: jup_…`: Free 1 RPS, Developer $25/mo 10 RPS, and higher tiers. `/swap/v2/execute` has its own bucket (keyless 20 RPS). Headers: `x-ratelimit-remaining`, `x-ratelimit-current`, `x-ratelimit-reset` (unix seconds). |
| `https://lite-api.jup.ag` | Still answers `/swap/v1/quote`, `/tokens/v2/*`, `/price/v3`, and `/ultra/v1/order`. It was announced as deprecated (third-party sources say 2026-01-31, **[UNVERIFIED]** in the official docs). Don't build on it; `/swap/v2/*` returns 404 there. |

A key is free to get at https://developers.jup.ag/portal and is recommended even at 1 RPS. It is org-scoped; keep it server-side.

### Swap V2 (current). Docs: https://developers.jup.ag/docs/swap
- **`GET /swap/v2/build`** is the router path. It uses **Metis only** and returns instructions for your own transaction; it replaces `/quote` + `/swap-instructions`.
  - Required params: `inputMint`, `outputMint`, `amount` (raw), `taker`.
  - Optional params: `slippageBps` (default 50, or `rtse`), **`destinationTokenAccount`**, `payer`, `maxAccounts` (≤64), `dexes`/`excludeDexes`, `platformFeeBps` + `feeAccount`, `computeUnitPricePercentile`, `mode=fast`, `blockhashSlotsToExpiry`.
  - ExactIn only. No Jupiter fee.
  - Response keys: `inputMint, outputMint, inAmount, outAmount, otherAmountThreshold, swapMode, slippageBps, priceImpactPct, routePlan[{percent,bps,swapInfo{ammKey,label,…}}], computeBudgetInstructions, setupInstructions, swapInstruction, cleanupInstruction, otherInstructions, tipInstruction, addressesByLookupTableAddress{alt:[keys]}, blockhashWithMetadata{blockhash:<byte array!>, lastValidBlockHeight}`.
  - Gotchas:
    - `blockhash` comes back as a **byte array**, not base58.
    - The CU **limit** is not included: simulate, then use 1.2×.
    - `/build` transactions cannot go to `/execute`.
- **`GET /swap/v2/order` + `POST /swap/v2/execute`** is the meta-aggregator path: Metis, JupiterZ RFQ, Dflow, and OKX compete. It returns an assembled transaction for `taker` to sign.
  - Params include `receiver`, a *wallet* whose ATA receives the output (must differ from `taker`).
  - Setting `payer` ≠ `taker` restricts routing to Metis.
  - 10 bps Jupiter fee (`feeBps: 10`). Can be gasless.
- Metis v1 (`/swap/v1/quote`, `/swap/v1/swap-instructions`) still works but is "no longer actively maintained". Old param name `userPublicKey` → new name `taker`.

### Real quotes: $10 USDC (`amount=10000000`)
| Pair | Path | Route | outAmount (raw) | Impact |
|---|---|---|---|---|
| USDC→NVDAx | `/swap/v1/quote` | BinaryFi (Metis) | 4446070 = 0.04446070 raw → **0.04453634 NVDAx UI** (×1.0017012) ≈ **$224.54 per share-equiv** | 0.155% |
| USDC→NVDAx | `/swap/v2/build` | BinaryFi | 4429798–4449959 | 0.36% |
| USDC→NVDAx | `/swap/v2/order` | **JupiterZ RFQ** (`swapType: rfq`, gasless) | 4440745 | 0.13% (after 10 bps fee) |
| USDC→NVDAon | `/swap/v2/order` | **JupiterZ RFQ** | 44357701 (9 dp) | 0.02% |
| USDC→NVDAon | `/swap/v2/build` | Manifest | 34822033 | **20.7%, so don't use** |

Reference prices at that moment: Jupiter `stockData.price` 225.07, xStocks indicative 224.19. This was the overnight session.

### Token-2022 and the delegate flow
- A `/build` call with `destinationTokenAccount` set to a **Token-2022 ATA** (derived with seeds `[owner, TokenzQd…, mint]`) returned 200, and the account appeared in `swapInstruction.accounts`. **Jupiter does not create the destination ATA**, so prepend `createAssociatedTokenAccountIdempotent` using program `TokenzQd…`.
- Suggested atomic transaction for a user who granted an allowance: `approve` on their **USDC ATA (classic SPL Token)**, delegate = agent key. The agent then sends one v0 transaction, paid by the agent:
  1. `transferChecked` USDC from the user's ATA to the agent's USDC ATA (the agent signs as delegate)
  2. create the user's xStock ATA (idempotent)
  3. Jupiter `/build` instructions with `taker=agent` and `destinationTokenAccount=user xStock ATA`
  4. a Memo receipt

  This route is Metis-only, which is fine for xStocks.
- For Ondo tokens, or when RFQ gives a better fill, use `/order` with `taker=agent` and `receiver=user wallet`. That is two transactions: first the delegate pull, then the order. In one test, `/order` with `receiver` routed to Metis, not JupiterZ, and returned "Insufficient funds" for an unfunded taker. **Whether RFQ supports `receiver` is [UNVERIFIED].**

### Tokens and Price APIs
- `GET https://api.jup.ag/tokens/v2/search?query=<symbol|mint[,mint…]>` returns an array of objects with `id, name, symbol, decimals, tokenProgram, usdPrice, liquidity, holderCount, isVerified, tags[…], organicScore, stats5m…`. Relevant tags are `xstocks`, `ondo`, `prestocks`, `tessera`, `stocks`, `rwa`, `token-2022`, and `verified`.
- `GET /tokens/v2/tag?query=verified|lst` works (only those two tags are allowed; `xstocks` returns 400). The verified list is 5 MB and has 3,689 tokens, including 1,126 `xstocks` and 449 `ondo`.
- `GET https://api.jup.ag/price/v3?ids=<≤50 mints>`. For stock tokens it adds `stockData{price, mcap, updatedAt}` and `scaledUiConfig{multiplier,newMultiplier,newMultiplierEffectiveAt,usdPricePrescaled}`. **This is a keyless guard price** (see §5).

## 5. Pyth

### Feed IDs (from `GET https://hermes.pyth.network/v2/price_feeds?query=NVDA&asset_type=equity`, which still works keyless)
| Symbol | Feed ID | Schedule |
|---|---|---|
| Equity.US.NVDA/USD | `b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593` | NY 09:30–16:00 Mon–Fri, holidays closed |
| Equity.US.AAPL/USD | `49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688` | same |
| Crypto.NVDAX/USD | `4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f` | 24/7 (`O,O,O…`) |
| Crypto.AAPLX/USD | `978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675` | 24/7 |
| Crypto.NVDAX/NVDA.RR (redemption rate, i.e. the multiplier) | `b675c4e9f46d94afa9174a7df09966b77a2950970bb50a77ec8ad4fcfd8266f4` | |
| Crypto.AAPLX/AAPL.RR | `25babb83691a056fd65f879bfd7197eabd840aae741f69c87ccb31e204a979b2` | |
| Crypto.NVDAON/USD | `207ddea2a443d30b7e13a7c88a9e3f106765deb97049afc65a18cede50fffc82` | |
| Crypto.AAPLON/USD | `e6734de88a83d9d2fb33072adab319004700aefd069653aba30ba9e3cac056f2` | |

There are 1,245 equity feeds (1,047 US). The only NVDA equity feeds are `Equity.US.NVDA/USD` and `Equity.Index.NVDA/USD`; I found no separate pre, post, or overnight feeds. `https://benchmarks.pyth.network/v1/price_feeds/?query=NVDA&asset_type=equity` (keyless) also returns `market_hours{is_open,next_open,next_close}`.

### Price updates: API KEY REQUIRED
- `GET https://hermes.pyth.network/v2/updates/price/latest?ids[]=<id>&parsed=true` returns **`401 unauthorized`** without a key, including for BTC. The same is true of `https://pyth.dourolabs.app/hermes/...`, the "upgraded" drop-in endpoint.
- Pyth docs: *"Since August 26, 2026, every hermes.pyth.network request requires a Pyth API Key. Send it as `Authorization: Bearer $PYTH_API_KEY`"*. SDK usage: `new HermesClient(url, { accessToken })` with `@pythnetwork/hermes-client@3.1.0`. Sign up at https://pythdata.app/signup ("free trial included, paid plans for ongoing use"). Trial length and limits are **[UNVERIFIED]**.
- The routes and response shapes are unchanged. `parsed[].price = {price, conf, expo, publish_time}`, and `binary.data[]` holds the update for on-chain posting.
- **Historical:**
  - `https://benchmarks.pyth.network/v1/updates/price/{ts}?ids=…&parsed=true` returns **401**.
  - `/v1/shims/tradingview/history?symbol=Equity.US.NVDA/USD&resolution=60&from&to` returns **404**.
  - I could not confirm historical equity prices keyless. **[UNVERIFIED with a key.]**
- **On-chain push accounts** (Pyth Push Oracle `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, shard 0; account owner is the receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`):
  - NVDA `2w1Tg1XTZbUib7srfRoStJ4v5JXVsK7roQEGMsMaGZFC`: last publish **2026-08-26**, so it's stale
  - AAPL `DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy`: last publish 2026-08-14
  - NVDAX `6TPsjFigUaMFanRCsxQ4WbmG215xhRBXsb5y5Cn5L6eE`: last publish 2026-09-20
  - SOL: live

  **Equity push feeds are not sponsored or updated on Solana.** To use Pyth on-chain, you have to post your own update, which needs Hermes and therefore a key.
- **Market hours:** outside the schedule, the equity feed stops publishing and `publish_time` goes stale. Use `getPriceNoOlderThan` or check `publish_time`. xStocks trade 24/5 on-chain, so on nights and weekends compare against `Crypto.NVDAX/USD`, which is 24/7, or skip the check.
- **What our key actually gets (verified 2026-09-25).** The key is a Pyth Pro Demo trial key. It mints JWTs at `POST https://pyth.dourolabs.app/auth/token`, and `POST https://pyth-lazer-0.dourolabs.app/v1/latest_price` works for granted feeds. Grants are Equity.US TSLA (Pro id 1435), QQQ and VOO (1472); anything else, e.g. NVDA (1314), returns `403 Not entitled: feed 1314 (no grant accepts this feed ...)` on Pro and Hermes alike. History: `GET https://pyth.dourolabs.app/v1/fixed_rate@200ms/history?symbol=Equity.US.VOO/USD&resolution=D&from=<s>&to=<s>` returns TradingView-style `{s,t,o,h,l,c,v}` in one request, but only from 2026-05-22 on the trial. Benchmarks `/v1/updates/price/{ts}` returns 404 for older timestamps and rate-limits per-day loops.
- **Pyth Pro** (formerly Lazer) is a subscription WebSocket stream (`wss://pyth-lazer-{0,1,2}.dourolabs.app/v1/stream`, `@pythnetwork/pyth-lazer-sdk@7.0.0`). It uses numeric feed IDs and channels from `real_time` to `fixed_rate@1000ms`, and its signed payloads can be verified on Solana. It is **not needed** for Coattails, where filings arrive days late. It is the Pyth track *prize* (3 months of access). What the Pyth track needs is Pyth data doing real work, meaning Core/Hermes with a key.
- **Recommendation:** get a Pyth API key today. Guard = Hermes `Equity.US.<T>/USD` during market hours, otherwise `Crypto.<T>X/USD`; reject the fill if the Jupiter quote per share-equivalent deviates by more than X bps. Keyless fallback: Jupiter `price/v3` `stockData.price`, or xStocks `/price-data`.

## 6. Clawpump and Meteora

### Clawpump (https://clawpump.tech)
- The API key (`cpk_…`) comes from signing up with Google on the site or from the `agent_signup` MCP tool (Ed25519 wallet signature). The free tier is 1K calls/month. MCP options: `npx @clawpump/agents` (v0.1.27) with `CLAWPUMP_API_KEY`, or the hosted MCP at `https://clawpump.tech/api/mcp`.
- **Launch (self-funded)**, a documented 3-step flow:
  1. `POST https://clawpump.tech/api/v1/launch/self-funded` with `{..., preflight:true}`. The response holds `payment.amountLamports`, `payment.payTo`, and `retryWith.preflightToken`.
  2. Send exactly those lamports to `payTo`.
  3. POST the same body again with `txSignature` and `preflightToken`.

  Body fields:
  ```json
  {"name":"…","symbol":"…","description":"…","imageUrl":"https://…","agentId":"…","agentName":"…",
   "walletAddress":"<payer>","pumpQuoteMint":"<stock mint>","pumpCreatorFeeBps":100}
  ```
  `pumpQuoteMint` isn't in the public docs. I took it from a working Stocklana repo (`ExpertVagabond/stockcurve/scripts/clawpump-launch.mjs`). **[UNVERIFIED by me]**
- `GET /api/v1/pump-pairs` lists the allowed quote assets (156 per stockcurve, including xStocks). It returns 401 without a key.
- Costs: **0.012 SOL** launch fee (0.018 SOL with an initial buy) plus network fees. stockcurve paid 0.0092 SOL. Fee split: creator 75%, Clawpump 25%.
- On-chain it is a **pump.fun** curve quoted in the stock token. The track rule says *"Launch your token with a stock-paired liquidity pool using clawpump and Meteora"*. stockcurve met the Meteora part by creating a **Meteora DLMM pool** (token/stock) itself, using `@meteora-ag/dlmm@1.9.14`. Meteora-side details of a Clawpump launch are **[UNVERIFIED]**; ask in the Clawpump TG if you have time.

### Meteora DBC
- Packages: `@meteora-ag/dynamic-bonding-curve-sdk@1.5.12` (2026-09-08), `@meteora-ag/cp-amm-sdk@1.4.10` (DAMM v2), and `@meteora-ag/dlmm@1.9.14`. The DBC program is `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`.
- Quote mint rules:
  - SPL Token mints are accepted permissionlessly.
  - Token-2022 mints are accepted permissionlessly only if their extensions are limited to metadata.
  - Mints with other extensions (xStocks have PermanentDelegate and more) need a **token badge**.
- Verified badge PDAs (`["token_badge", mint]`) **exist** under both the DBC and DAMM v2 (`cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`) programs for NVDAx, AAPLx, XRXx, and NVDAon. **So yes, an xStock can be the DBC quote mint**, and stockcurve has a live sGME/AAPLx DBC pool that graduated to DAMM v2. Token-2022 base tokens must migrate to DAMM v2.

## 7. PreStocks and Tessera (public, no key)

`GET https://prestocks.com/api/prestocks` returns a JSON array of 8 objects (Vercel, `max-age=0`):
```json
{"name":"Anduril PreStocks","symbol":"ANDURIL","description":"…","image":"https://www.prestocks.com/logos/anduril.png",
 "external_url":"https://www.prestocks.com/anduril","contract_address":"PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB",
 "markPrice":152.63896038,"markValuation":135039544354,"tokenPrice":154.22875483305208,"impliedValuation":136446034007,"supply":11805.817985464}
```
- Symbols: ANDURIL, ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, SPACEX. Mints start with `Pre…`. They are Token-2022 with 9 decimals, and Jupiter tags them `prestocks`.
- `markPrice` is the private-market mark. `tokenPrice` is the on-chain price. Example: SPACEX has mark 148.62 and token 106.47.

`GET https://rest-api.tessera.pe/v1/public/token-details` returns a JSON array of 3 objects:
```json
{"id":"T-OpenAI","name":"T-OpenAI","symbol":"T-OpenAI","code":"tOpenAI","sector":"Artificial Intelligence",
 "mint":"oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ","markPrice":812.79,"holders":8747,"markValuation":950000000000}
```
- The other two are T-Kalshi `TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ` and T-SpaceX `TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v`. tOpenAI is Token-2022 with 9 decimals, and Jupiter's usdPrice for it is about 1038 against the 812.79 mark.

## 8. Solana Actions / Blinks ("Follow Pelosi with $10")
- `@solana/actions@1.6.6` (spec `@solana/actions-spec@2.4.2`). The last publish was 2024-11-05, and `solana-developers/solana-actions` has had no pushes since 2024-11. It isn't archived and still works, but it depends on web3.js v1. Docs: https://solana.com/docs/tools/actions
- **`/actions.json` at the domain root**:
  ```json
  {"rules":[{"pathPattern":"/follow/*","apiPath":"/api/actions/follow/*"}]}
  ```
- **Headers on actions.json and every Action route**, including `OPTIONS`. These are the exact `ACTIONS_CORS_HEADERS` from the SDK:
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET,POST,PUT,OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids
  Access-Control-Expose-Headers: X-Action-Version, X-Blockchain-Ids
  X-Action-Version: 2.4
  X-Blockchain-Ids: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp   # mainnet
  ```
  The SDK sets these only when you pass them in: `createActionHeaders({chainId:"mainnet", actionVersion:"2.4"})`. The value `2.4` is my choice to match spec 2.4.x; the SDK has no default. **[UNVERIFIED]** whether clients need it.
- **GET** returns `{type:"action", icon:<abs url>, title, description, label, links:{actions:[{type:"transaction", label:"Follow with $10", href:"/api/actions/follow/pelosi?amount=10"}, {type:"transaction", label:"Custom", href:"/api/actions/follow/pelosi?amount={amount}", parameters:[{name:"amount", label:"USDC", type:"number", required:true}]}]}}`.
- **POST** takes `{account}` and returns `{type:"transaction", transaction:<base64>, message}`. For Coattails, the transaction is:
  1. create the user's USDC ATA if needed
  2. SPL Token **`approve`** (or `approveChecked`) on the user's USDC ATA, with delegate = agent pubkey and amount = allowance
  3. Memo `coattails:follow:pelosi`

  The agent spends the allowance later. Chaining via `links.next` can show a "completed" card.
- Share as `https://dial.to/?action=solana-action:https://<host>/api/actions/follow/pelosi`. X unfurls only for hosts in the Dialect registry (apply at dial.to/register); `https://actions-registry.dial.to/all` is live. Test with `https://blinks.xyz/inspector`.

## 9. create-solana-dapp
- `npx create-solana-dapp@latest` is **v4.8.5** (published 2026-09-18). Flags: `-t/--template <id>`, `--list-templates`, `--list-template-ids`, `--minimal` (nextjs-anchor), `--pm/--pnpm/--bun/--yarn`, `--skip-install`, `--skip-git`, `--skip-init`, `-d` (dry run).
- Templates, all from `gh:solana-foundation/templates/...`:
  - kit: `nextjs`, `nextjs-anchor`, `nextjs-das-nfts`, `nextjs-hardware-signin`, `nextjs-keychain`, `nextjs-subscriptions`, `react-vite`, `react-vite-anchor`, `axum-keychain`, `pinocchio-counter`
  - mobile: `kit-expo-*`, `web3js-expo*`
  - web3js: `web3js-next-tailwind`, `web3js-next-tailwind-basic`, `web3js-next-tailwind-counter`, `web3js-react-vite-tailwind{,-basic,-counter}`
  - community: `solana-blinks-axum`, `x402-template`, `phantom-embedded-react`, `supabase-auth`, and many more
- **There are no gill templates any more.** To get Next.js + Tailwind + wallet adapter + TanStack Query, use **`web3js-next-tailwind`**, which ships next 16.3.4, `@solana/wallet-adapter-react@0.15.39`, `@solana/web3.js@^1.98`, `@tanstack/react-query@^5.89`, `@solana/spl-token@0.4.14`, and shadcn/radix. The modern alternative is `nextjs`: `@solana/kit@^7`, `@solana/kit-plugin-wallet`, `@solana/react`, `swr`, with no wallet adapter or TanStack. Current package versions: `@solana/kit` 8.3.0, `gill` 0.14.0 (last release 2025-11).
- Command: `npx create-solana-dapp@latest coattails-web -t web3js-next-tailwind --pnpm`

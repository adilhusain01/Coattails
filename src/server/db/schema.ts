import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

/** A person whose disclosed trades can be followed: a House member or a company insider. */
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  kind: text("kind", { enum: ["house", "insider"] }).notNull(),
  name: text("name").notNull(),
  /** House: "CA11" style state-district. Insider: issuer ticker. */
  seat: text("seat"),
  /** House: D / R / I. Insider: officer title, e.g. "CEO". */
  affiliation: text("affiliation"),
  photoUrl: text("photo_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

/** One public document: a House PTR PDF or an EDGAR Form 4. */
export const filings = sqliteTable(
  "filings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    kind: text("kind", { enum: ["house_ptr", "form4"] }).notNull(),
    /** House DocID or EDGAR accession number. */
    docId: text("doc_id").notNull(),
    url: text("url").notNull(),
    /** sha256 of the exact bytes the agent read. */
    sha256: text("sha256"),
    filedAt: integer("filed_at", { mode: "timestamp" }).notNull(),
    status: text("status", { enum: ["new", "parsed", "receipted", "failed"] })
      .notNull()
      .default("new"),
    /** How the document was read: "sarvam" or "sarvam+ocr" for PDFs, "xml" for Form 4. */
    readBy: text("read_by"),
    receiptSig: text("receipt_sig"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("filings_kind_doc").on(t.kind, t.docId), index("filings_filed_at").on(t.filedAt)],
)

/** One transaction line inside a filing. */
export const trades = sqliteTable(
  "trades",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    filingId: integer("filing_id")
      .notNull()
      .references(() => filings.id),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    ticker: text("ticker"),
    assetName: text("asset_name").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    /** Disclosed USD range; Form 4 has an exact value so low == high. */
    amountLow: real("amount_low"),
    amountHigh: real("amount_high"),
    tradedAt: integer("traded_at", { mode: "timestamp" }).notNull(),
    disclosedAt: integer("disclosed_at", { mode: "timestamp" }).notNull(),
    /** Tokenized-stock symbol this trade mirrors into, e.g. "NVDAx". Null when not tokenized. */
    tokenSymbol: text("token_symbol"),
    /** Underlying close on the trade date and at disclosure, from Pyth Benchmarks. */
    pxTraded: real("px_traded"),
    pxDisclosed: real("px_disclosed"),
    mirrorStatus: text("mirror_status", { enum: ["pending", "done", "skipped"] })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("trades_source").on(t.sourceId), index("trades_disclosed").on(t.disclosedAt)],
)

/** A wallet following a source, with the budget it approved to the agent. */
export const follows = sqliteTable(
  "follows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wallet: text("wallet").notNull(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    /** USDC spent per mirrored buy. */
    perTradeUsd: real("per_trade_usd").notNull(),
    autoSell: integer("auto_sell", { mode: "boolean" }).notNull().default(true),
    /** Sell when the price falls this fraction below the position's peak. Null = off. */
    trailingStopPct: real("trailing_stop_pct").default(0.15),
    /** Sell when a position has been held this many days without a disclosed sale. Null = off. */
    maxHoldDays: integer("max_hold_days").default(90),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    approveSig: text("approve_sig"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("follows_wallet_source").on(t.wallet, t.sourceId)],
)

/** One mirror fill for one follower. */
export const executions = sqliteTable(
  "executions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tradeId: integer("trade_id")
      .notNull()
      .references(() => trades.id),
    followId: integer("follow_id")
      .notNull()
      .references(() => follows.id),
    wallet: text("wallet").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    tokenSymbol: text("token_symbol").notNull(),
    usdcAmount: real("usdc_amount"),
    tokenAmount: real("token_amount"),
    /** Pyth price used for the guard (and for the fill on devnet). */
    pythPx: real("pyth_px"),
    fillPx: real("fill_px"),
    sig: text("sig"),
    status: text("status", { enum: ["sent", "confirmed", "rejected", "failed"] }).notNull(),
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("executions_trade_follow_side").on(t.tradeId, t.followId, t.side),
    index("executions_wallet").on(t.wallet),
  ],
)

export type Source = typeof sources.$inferSelect
export type Filing = typeof filings.$inferSelect
export type Trade = typeof trades.$inferSelect
export type Follow = typeof follows.$inferSelect
export type Execution = typeof executions.$inferSelect

/** Small key-value store for deployment facts, e.g. devnet mint addresses. */
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

/** A follower's holding of one stock bought by mirroring one person. Exit rules act on these. */
export const positions = sqliteTable(
  "positions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wallet: text("wallet").notNull(),
    followId: integer("follow_id")
      .notNull()
      .references(() => follows.id),
    /** The trade that opened the position. */
    tradeId: integer("trade_id")
      .notNull()
      .references(() => trades.id),
    tokenSymbol: text("token_symbol").notNull(),
    ticker: text("ticker").notNull(),
    tokens: real("tokens").notNull(),
    costUsd: real("cost_usd").notNull(),
    entryPx: real("entry_px").notNull(),
    peakPx: real("peak_px").notNull(),
    lastPx: real("last_px"),
    openedAt: integer("opened_at", { mode: "timestamp" }).notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    /** Set when an exit rule fired but the follower has not allowed Coattails to sell. */
    exitDue: text("exit_due"),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    closeReason: text("close_reason", { enum: ["member_sold", "trailing_stop", "max_hold", "manual"] }),
    closePx: real("close_px"),
    closeSig: text("close_sig"),
  },
  (t) => [index("positions_wallet").on(t.wallet), index("positions_open").on(t.status)],
)

export type Position = typeof positions.$inferSelect

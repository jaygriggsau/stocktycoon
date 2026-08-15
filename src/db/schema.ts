import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Market-wide singleton state
// ---------------------------------------------------------------------------
export const marketState = pgTable("market_state", {
  id: integer("id").primaryKey().default(1),
  // Simulated market day counter. Advances on a fixed wall-clock cadence.
  marketDay: integer("market_day").notNull().default(0),
  // Unix ms of the real-world moment the simulation epoch started.
  epochMs: bigint("epoch_ms", { mode: "number" }).notNull(),
  // Macro regime: drift applied market-wide. Random-walks between bull/bear.
  regimeDrift: doublePrecision("regime_drift").notNull().default(0.0002),
  regimeLabel: text("regime_label").notNull().default("neutral"),
  interestRate: doublePrecision("interest_rate").notNull().default(0.04),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sectors
// ---------------------------------------------------------------------------
export const sectors = pgTable("sectors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  // Slow-moving sector momentum, re-randomized periodically (sector rotation).
  momentum: doublePrecision("momentum").notNull().default(0),
  baseVolatility: doublePrecision("base_volatility").notNull().default(0.02),
  baseGrowth: doublePrecision("base_growth").notNull().default(0.05),
});

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------
export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    sectorId: integer("sector_id")
      .notNull()
      .references(() => sectors.id),
    description: text("description"),
    status: text("status").notNull().default("active"), // active | bankrupt | acquired
    listedDay: integer("listed_day").notNull().default(0),
    delistedDay: integer("delisted_day"),

    // Price state
    price: doublePrecision("price").notNull(),
    prevClose: doublePrecision("prev_close").notNull(),
    sharesOutstanding: bigint("shares_outstanding", { mode: "number" }).notNull(),

    // Fundamentals (annualized, in dollars)
    revenue: doublePrecision("revenue").notNull(),
    earnings: doublePrecision("earnings").notNull(),
    cashReserves: doublePrecision("cash_reserves").notNull(),
    growthRate: doublePrecision("growth_rate").notNull(), // expected annual revenue growth
    profitMargin: doublePrecision("profit_margin").notNull(),

    // Behavior parameters
    volatility: doublePrecision("volatility").notNull(), // daily log-return stddev
    beta: doublePrecision("beta").notNull(), // sensitivity to market/sector
    quality: doublePrecision("quality").notNull(), // idiosyncratic drift edge [-1..1]
    dividendYield: doublePrecision("dividend_yield").notNull().default(0), // annual
    // Day-of-cycle offset so earnings reports are staggered across the quarter.
    earningsOffset: integer("earnings_offset").notNull().default(0),
    distressDays: integer("distress_days").notNull().default(0),

    // Analyst coverage: 1=Sell 2=Underperform 3=Hold 4=Buy 5=Strong Buy
    analystRating: integer("analyst_rating").notNull().default(3),
    priceTarget: doublePrecision("price_target").notNull().default(0),
    ratedDay: integer("rated_day").notNull().default(0),
  },
  (t) => [
    uniqueIndex("companies_symbol_idx").on(t.symbol),
    index("companies_sector_idx").on(t.sectorId),
    index("companies_status_idx").on(t.status),
  ]
);

// ---------------------------------------------------------------------------
// Daily OHLCV bars
// ---------------------------------------------------------------------------
export const priceBars = pgTable(
  "price_bars",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    day: integer("day").notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.day] }), index("price_bars_day_idx").on(t.day)]
);

// ---------------------------------------------------------------------------
// News / market events
// ---------------------------------------------------------------------------
export const newsItems = pgTable(
  "news_items",
  {
    id: serial("id").primaryKey(),
    day: integer("day").notNull(),
    kind: text("kind").notNull(), // earnings | ipo | bankruptcy | sector | macro | company | dividend
    headline: text("headline").notNull(),
    body: text("body"),
    companyId: integer("company_id").references(() => companies.id),
    sectorId: integer("sector_id").references(() => sectors.id),
    priceImpact: doublePrecision("price_impact"), // applied log-return, if any
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("news_day_idx").on(t.day), index("news_company_idx").on(t.companyId)]
);

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
export const players = pgTable("players", {
  // Stack Auth (Neon Auth) user id
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  cash: doublePrecision("cash").notNull().default(100_000),
  startingCash: doublePrecision("starting_cash").notNull().default(100_000),
  realizedPnl: doublePrecision("realized_pnl").notNull().default(0),
  totalDividends: doublePrecision("total_dividends").notNull().default(0),
  createdDay: integer("created_day").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const holdings = pgTable(
  "holdings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    shares: bigint("shares", { mode: "number" }).notNull(),
    avgCost: doublePrecision("avg_cost").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.companyId] }), index("holdings_company_idx").on(t.companyId)]
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    side: text("side").notNull(), // buy | sell
    type: text("type").notNull(), // market | limit
    status: text("status").notNull().default("open"), // open | filled | cancelled | expired
    shares: bigint("shares", { mode: "number" }).notNull(),
    limitPrice: doublePrecision("limit_price"),
    fillPrice: doublePrecision("fill_price"),
    placedDay: integer("placed_day").notNull(),
    filledDay: integer("filled_day"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("orders_user_idx").on(t.userId), index("orders_status_idx").on(t.status)]
);

export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    side: text("side").notNull(),
    shares: bigint("shares", { mode: "number" }).notNull(),
    price: doublePrecision("price").notNull(),
    realizedPnl: doublePrecision("realized_pnl"),
    day: integer("day").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("trades_user_idx").on(t.userId)]
);

// Daily net-worth snapshots for portfolio charts + leaderboard.
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    userId: text("user_id")
      .notNull()
      .references(() => players.userId),
    day: integer("day").notNull(),
    netWorth: doublePrecision("net_worth").notNull(),
    cash: doublePrecision("cash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })]
);

// Market index history (equal/cap-weighted composite + per-sector indices).
export const indexBars = pgTable(
  "index_bars",
  {
    indexKey: text("index_key").notNull(), // "COMPOSITE" or "SECTOR:<id>"
    day: integer("day").notNull(),
    value: doublePrecision("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.indexKey, t.day] })]
);

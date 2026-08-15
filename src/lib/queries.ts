import { sql } from "@/db";
import { advanceMarket } from "./sim/engine";

// Every page read goes through tick() first so the market lazily advances.
export async function tick(): Promise<number> {
  try {
    return await advanceMarket();
  } catch (e) {
    console.error("advanceMarket failed", e);
    return -1;
  }
}

export interface MarketOverview {
  day: number;
  regimeLabel: string;
  composite: { day: number; value: number }[];
  compositeChange: number;
  sectors: { id: number; name: string; value: number; change: number }[];
  gainers: MoverRow[];
  losers: MoverRow[];
  mostActive: MoverRow[];
  activeCount: number;
  recentNews: NewsRow[];
}

export interface MoverRow {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  marketCap: number;
  volume?: number;
}

export interface NewsRow {
  id: number;
  day: number;
  kind: string;
  headline: string;
  symbol: string | null;
  priceImpact: number | null;
}

export async function getMarketOverview(): Promise<MarketOverview> {
  const day = await tick();

  const [stateRows, composite, sectorRows, gainers, losers, active, countRows, news] = await Promise.all([
    sql`SELECT market_day, regime_label FROM market_state WHERE id = 1`,
    sql`SELECT day, value FROM index_bars WHERE index_key = 'COMPOSITE' ORDER BY day DESC LIMIT 120`,
    sql`
      SELECT s.id, s.name, cur.value, (cur.value / NULLIF(prev.value, 0) - 1) AS change
      FROM sectors s
      JOIN LATERAL (SELECT value FROM index_bars WHERE index_key = 'SECTOR:' || s.id ORDER BY day DESC LIMIT 1) cur ON true
      LEFT JOIN LATERAL (SELECT value FROM index_bars WHERE index_key = 'SECTOR:' || s.id ORDER BY day DESC LIMIT 1 OFFSET 1) prev ON true
      ORDER BY change DESC NULLS LAST`,
    sql`SELECT symbol, name, price, prev_close, price / NULLIF(prev_close, 0) - 1 AS change, price * shares_outstanding AS market_cap
        FROM companies WHERE status = 'active' AND prev_close > 0 AND price * shares_outstanding > 5e7
        ORDER BY change DESC LIMIT 8`,
    sql`SELECT symbol, name, price, prev_close, price / NULLIF(prev_close, 0) - 1 AS change, price * shares_outstanding AS market_cap
        FROM companies WHERE status = 'active' AND prev_close > 0 AND price * shares_outstanding > 5e7
        ORDER BY change ASC LIMIT 8`,
    // Join the most recent day that actually has bars — the current market day
    // may still be mid-write (or have been skipped), which would empty this list.
    sql`SELECT c.symbol, c.name, c.price, c.prev_close, c.price / NULLIF(c.prev_close, 0) - 1 AS change,
               c.price * c.shares_outstanding AS market_cap, pb.volume
        FROM companies c
        JOIN price_bars pb ON pb.company_id = c.id AND pb.day = (SELECT max(day) FROM price_bars)
        WHERE c.status = 'active'
        ORDER BY pb.volume * c.price DESC LIMIT 8`,
    sql`SELECT count(*)::int AS n FROM companies WHERE status = 'active'`,
    sql`SELECT n.id, n.day, n.kind, n.headline, c.symbol, n.price_impact
        FROM news_items n LEFT JOIN companies c ON c.id = n.company_id
        ORDER BY n.id DESC LIMIT 12`,
  ]);

  const comp = (composite as { day: number; value: number }[]).reverse();
  const compositeChange =
    comp.length >= 2 ? comp[comp.length - 1].value / comp[comp.length - 2].value - 1 : 0;

  const toMover = (r: Record<string, unknown>): MoverRow => ({
    symbol: r.symbol as string,
    name: r.name as string,
    price: Number(r.price),
    prevClose: Number(r.prev_close),
    change: Number(r.change ?? 0),
    marketCap: Number(r.market_cap),
    volume: r.volume !== undefined ? Number(r.volume) : undefined,
  });

  return {
    day: (stateRows as { market_day: number }[])[0]?.market_day ?? day,
    regimeLabel: (stateRows as { regime_label: string }[])[0]?.regime_label ?? "neutral",
    composite: comp.map((r) => ({ day: Number(r.day), value: Number(r.value) })),
    compositeChange,
    sectors: (sectorRows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      name: r.name as string,
      value: Number(r.value),
      change: Number(r.change ?? 0),
    })),
    gainers: (gainers as Record<string, unknown>[]).map(toMover),
    losers: (losers as Record<string, unknown>[]).map(toMover),
    mostActive: (active as Record<string, unknown>[]).map(toMover),
    activeCount: (countRows as { n: number }[])[0].n,
    recentNews: (news as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      day: Number(r.day),
      kind: r.kind as string,
      headline: r.headline as string,
      symbol: (r.symbol as string) ?? null,
      priceImpact: r.price_impact === null ? null : Number(r.price_impact),
    })),
  };
}

export interface ScreenerParams {
  q?: string;
  sector?: number;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  status?: string;
}

const SORT_COLUMNS: Record<string, string> = {
  symbol: "symbol",
  name: "name",
  price: "price",
  change: "change",
  marketCap: "market_cap",
  pe: "pe",
  dividend: "dividend_yield",
  revenue: "revenue",
};

export async function screener(params: ScreenerParams) {
  await tick();
  const page = Math.max(1, params.page ?? 1);
  const perPage = 50;
  const sortCol = SORT_COLUMNS[params.sort ?? "marketCap"] ?? "market_cap";
  const dir = params.dir === "asc" ? "ASC" : "DESC";
  const q = params.q ? `%${params.q}%` : null;
  const status = params.status === "bankrupt" ? "bankrupt" : "active";

  const rows = await sql(
    `SELECT c.symbol, c.name, s.name AS sector, c.price, c.prev_close,
            c.price / NULLIF(c.prev_close, 0) - 1 AS change,
            c.price * c.shares_outstanding AS market_cap,
            CASE WHEN c.earnings > 0 THEN c.price * c.shares_outstanding / c.earnings END AS pe,
            c.dividend_yield, c.revenue, c.status,
            count(*) OVER() AS total
     FROM companies c JOIN sectors s ON s.id = c.sector_id
     WHERE c.status = $1
       AND ($2::text IS NULL OR c.name ILIKE $2 OR c.symbol ILIKE $2)
       AND ($3::int IS NULL OR c.sector_id = $3)
     ORDER BY ${sortCol} ${dir} NULLS LAST
     LIMIT $4 OFFSET $5`,
    [status, q, params.sector ?? null, perPage, (page - 1) * perPage]
  );

  const list = rows as Record<string, unknown>[];
  return {
    total: list.length ? Number(list[0].total) : 0,
    perPage,
    page,
    rows: list.map((r) => ({
      symbol: r.symbol as string,
      name: r.name as string,
      sector: r.sector as string,
      price: Number(r.price),
      change: Number(r.change ?? 0),
      marketCap: Number(r.market_cap),
      pe: r.pe === null ? null : Number(r.pe),
      dividendYield: Number(r.dividend_yield),
      revenue: Number(r.revenue),
      status: r.status as string,
    })),
  };
}

export async function getSectors() {
  return (await sql`SELECT id, name FROM sectors ORDER BY name`) as { id: number; name: string }[];
}

export async function getCompany(symbol: string) {
  await tick();
  const rows = (await sql`
    SELECT c.*, s.name AS sector_name
    FROM companies c JOIN sectors s ON s.id = c.sector_id
    WHERE c.symbol = ${symbol}`) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const c = rows[0];
  const id = Number(c.id);

  const [bars, news] = await Promise.all([
    sql`SELECT day, open, high, low, close, volume FROM price_bars
        WHERE company_id = ${id} ORDER BY day DESC LIMIT 180`,
    sql`SELECT id, day, kind, headline, price_impact FROM news_items
        WHERE company_id = ${id} ORDER BY id DESC LIMIT 10`,
  ]);

  return {
    id,
    symbol: c.symbol as string,
    name: c.name as string,
    sector: c.sector_name as string,
    description: (c.description as string) ?? "",
    status: c.status as string,
    listedDay: Number(c.listed_day),
    delistedDay: c.delisted_day === null ? null : Number(c.delisted_day),
    price: Number(c.price),
    prevClose: Number(c.prev_close),
    sharesOutstanding: Number(c.shares_outstanding),
    marketCap: Number(c.price) * Number(c.shares_outstanding),
    revenue: Number(c.revenue),
    earnings: Number(c.earnings),
    profitMargin: Number(c.profit_margin),
    growthRate: Number(c.growth_rate),
    volatility: Number(c.volatility),
    beta: Number(c.beta),
    dividendYield: Number(c.dividend_yield),
    pe: Number(c.earnings) > 0 ? (Number(c.price) * Number(c.shares_outstanding)) / Number(c.earnings) : null,
    eps: Number(c.earnings) / Number(c.shares_outstanding),
    analystRating: Number(c.analyst_rating ?? 3),
    priceTarget: Number(c.price_target ?? 0),
    bars: (bars as Record<string, unknown>[])
      .map((b) => ({
        day: Number(b.day),
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume),
      }))
      .reverse(),
    news: (news as Record<string, unknown>[]).map((n) => ({
      id: Number(n.id),
      day: Number(n.day),
      kind: n.kind as string,
      headline: n.headline as string,
      priceImpact: n.price_impact === null ? null : Number(n.price_impact),
    })),
  };
}

export async function getPortfolio(userId: string) {
  await tick();
  const [playerRows, holdingRows, orderRows, tradeRows, snapshots] = await Promise.all([
    sql`SELECT * FROM players WHERE user_id = ${userId}`,
    sql`SELECT h.shares, h.avg_cost, c.symbol, c.name, c.price, c.prev_close, c.status
        FROM holdings h JOIN companies c ON c.id = h.company_id
        WHERE h.user_id = ${userId} ORDER BY h.shares * c.price DESC`,
    sql`SELECT o.id, o.side, o.type, o.status, o.shares, o.limit_price, o.fill_price, o.placed_day, c.symbol
        FROM orders o JOIN companies c ON c.id = o.company_id
        WHERE o.user_id = ${userId} AND o.status = 'open' ORDER BY o.id DESC LIMIT 50`,
    sql`SELECT t.side, t.shares, t.price, t.realized_pnl, t.day, c.symbol
        FROM trades t JOIN companies c ON c.id = t.company_id
        WHERE t.user_id = ${userId} ORDER BY t.id DESC LIMIT 25`,
    sql`SELECT day, net_worth FROM portfolio_snapshots WHERE user_id = ${userId} ORDER BY day DESC LIMIT 180`,
  ]);
  if ((playerRows as unknown[]).length === 0) return null;
  const p = (playerRows as Record<string, unknown>[])[0];

  const holdings = (holdingRows as Record<string, unknown>[]).map((h) => {
    const shares = Number(h.shares); // negative = short position
    const price = Number(h.price);
    const avgCost = Number(h.avg_cost);
    const unrealized = (price - avgCost) * shares; // signed math covers shorts
    return {
      symbol: h.symbol as string,
      name: h.name as string,
      status: h.status as string,
      shares,
      avgCost,
      price,
      value: shares * price,
      dayChange: Number(h.prev_close) > 0 ? price / Number(h.prev_close) - 1 : 0,
      unrealized,
      unrealizedPct: avgCost > 0 ? unrealized / (avgCost * Math.abs(shares)) : 0,
    };
  });

  const cash = Number(p.cash);
  const holdingsValue = holdings.reduce((s, h) => s + h.value, 0);
  const longValue = holdings.reduce((s, h) => s + Math.max(0, h.value), 0);
  const shortExposure = holdings.reduce((s, h) => s + Math.max(0, -h.value), 0);
  const equity = cash + longValue - shortExposure;

  return {
    displayName: p.display_name as string,
    cash,
    startingCash: Number(p.starting_cash),
    realizedPnl: Number(p.realized_pnl),
    totalDividends: Number(p.total_dividends),
    netWorth: cash + holdingsValue,
    holdingsValue,
    longValue,
    shortExposure,
    equity,
    marginUsage: shortExposure > 0 ? equity / shortExposure : null,
    holdings,
    openOrders: (orderRows as Record<string, unknown>[]).map((o) => ({
      id: Number(o.id),
      symbol: o.symbol as string,
      side: o.side as string,
      type: o.type as string,
      shares: Number(o.shares),
      limitPrice: o.limit_price === null ? null : Number(o.limit_price),
      placedDay: Number(o.placed_day),
    })),
    recentTrades: (tradeRows as Record<string, unknown>[]).map((t) => ({
      symbol: t.symbol as string,
      side: t.side as string,
      shares: Number(t.shares),
      price: Number(t.price),
      realizedPnl: t.realized_pnl === null ? null : Number(t.realized_pnl),
      day: Number(t.day),
    })),
    history: (snapshots as Record<string, unknown>[])
      .map((s) => ({ day: Number(s.day), value: Number(s.net_worth) }))
      .reverse(),
  };
}

export async function getLeaderboard() {
  await tick();
  const rows = (await sql`
    SELECT p.user_id, p.display_name, p.starting_cash, p.created_day,
           p.cash + COALESCE(sum(h.shares * c.price), 0) AS net_worth
    FROM players p
    LEFT JOIN holdings h ON h.user_id = p.user_id
    LEFT JOIN companies c ON c.id = h.company_id
    GROUP BY p.user_id
    ORDER BY net_worth DESC
    LIMIT 100`) as Record<string, unknown>[];
  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.user_id as string,
    displayName: r.display_name as string,
    netWorth: Number(r.net_worth),
    returnPct: Number(r.net_worth) / Number(r.starting_cash) - 1,
    createdDay: Number(r.created_day),
  }));
}

export async function getNews(page = 1) {
  await tick();
  const perPage = 40;
  const rows = (await sql`
    SELECT n.id, n.day, n.kind, n.headline, n.price_impact, c.symbol
    FROM news_items n LEFT JOIN companies c ON c.id = n.company_id
    ORDER BY n.id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    day: Number(r.day),
    kind: r.kind as string,
    headline: r.headline as string,
    symbol: (r.symbol as string) ?? null,
    priceImpact: r.price_impact === null ? null : Number(r.price_impact),
  }));
}

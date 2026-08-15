import { sql } from "@/db";
import {
  DAY_MS,
  MAX_CATCHUP_DAYS,
  TARGET_COMPANIES,
  QUARTER_DAYS,
  BAR_RETENTION_DAYS,
  NEWS_RETENTION_DAYS,
  MIN_PRICE,
  MAINTENANCE_MARGIN,
} from "./config";
import { generateCompanies, SECTOR_DEFS } from "./names";

interface MarketStateRow {
  market_day: number;
  epoch_ms: number;
  regime_drift: number;
  regime_label: string;
  interest_rate: number;
}

/**
 * Advance the simulation to the current wall-clock time.
 *
 * The market is anchored to a fixed epoch: target day = floor((now - epoch) / DAY_MS).
 * Each missing day is claimed with a compare-and-set on market_state.market_day so
 * concurrent serverless invocations never double-simulate a day. Catch-up is capped
 * per request; if the app has been idle for a long time, the market catches up
 * incrementally across the next few requests.
 */
export async function advanceMarket(): Promise<number> {
  const rows = (await sql`SELECT market_day, epoch_ms, regime_drift, regime_label, interest_rate FROM market_state WHERE id = 1`) as MarketStateRow[];
  if (rows.length === 0) return 0; // not seeded yet
  const state = rows[0];

  const targetDay = Math.floor((Date.now() - Number(state.epoch_ms)) / DAY_MS);
  let day = state.market_day;
  if (targetDay <= day) return day;

  const stopAt = Math.min(targetDay, day + MAX_CATCHUP_DAYS);
  let regimeDrift = state.regime_drift;
  let regimeLabel = state.regime_label;

  while (day < stopAt) {
    const next = day + 1;
    // Claim the day (CAS). If another invocation got it first, stop here.
    const claimed = await sql`
      UPDATE market_state SET market_day = ${next}, updated_at = now()
      WHERE id = 1 AND market_day = ${day}
      RETURNING market_day`;
    if (claimed.length === 0) break;

    ({ regimeDrift, regimeLabel } = await simulateDay(next, regimeDrift, regimeLabel));
    day = next;
  }
  return day;
}

/**
 * Run an optional "flavor" step (news, corporate actions, analyst coverage).
 * A day is claimed via CAS before it is simulated, so a throw here would leave
 * that day permanently half-written. Core state — prices, bars, indices — must
 * never depend on these, so their failures are logged and swallowed.
 */
async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`sim step "${label}" failed`, e);
  }
}

/** Run one full market day. All heavy lifting is set-based SQL. */
async function simulateDay(
  day: number,
  regimeDrift: number,
  regimeLabel: string
): Promise<{ regimeDrift: number; regimeLabel: string }> {
  // ---- 1. Macro regime: mean-reverting random walk with occasional shocks ----
  regimeDrift = regimeDrift * 0.985 + (Math.random() - 0.5) * 0.0006;
  if (Math.random() < 0.01) {
    // Macro shock (rate decision, geopolitical event, ...)
    const shock = (Math.random() - 0.5) * 0.004;
    regimeDrift += shock;
    const headline =
      shock > 0
        ? "Central bank signals easing; markets rally broadly"
        : "Macro shock rattles markets as risk appetite fades";
    await sql`INSERT INTO news_items (day, kind, headline, price_impact)
              VALUES (${day}, 'macro', ${headline}, ${shock})`;
  }
  const newLabel = regimeDrift > 0.0006 ? "bull" : regimeDrift < -0.0006 ? "bear" : "neutral";
  if (newLabel !== regimeLabel) {
    await sql`INSERT INTO news_items (day, kind, headline)
              VALUES (${day}, 'macro', ${`Market regime shifts to ${newLabel} territory`})`;
  }
  regimeLabel = newLabel;
  await sql`UPDATE market_state SET regime_drift = ${regimeDrift}, regime_label = ${regimeLabel} WHERE id = 1`;

  // ---- 2. Sector rotation: slow-moving momentum per sector ----
  await sql`UPDATE sectors SET momentum = momentum * 0.96 + (random() - 0.5) * 0.0035`;

  // Occasional sector-wide news event with real price impact.
  // Note: decide the phrasing in JS. Comparing a bound parameter against an
  // integer literal in SQL makes Postgres infer the parameter as `integer`,
  // which rejects fractional impacts.
  if (Math.random() < 0.12) {
    const impact = (Math.random() - 0.5) * 0.05;
    const phrase =
      impact > 0 ? " sector surges on strong demand outlook" : " sector slides amid supply concerns";
    await safe("sector news", () =>
      sql`
      WITH s AS (SELECT id, name FROM sectors ORDER BY random() LIMIT 1),
      bump AS (UPDATE sectors SET momentum = momentum + ${impact / 8}::double precision FROM s WHERE sectors.id = s.id RETURNING s.name)
      INSERT INTO news_items (day, kind, headline, sector_id, price_impact)
      SELECT ${day}, 'sector', name || ${phrase}, id, ${impact}::double precision
      FROM s`
    );
  }

  // ---- 3. Daily price update: GBM + factor model + value anchoring ----
  // log-return = market(beta) + sector(beta) + quality drift + valuation pull + noise
  await sql`
    UPDATE companies c SET
      prev_close = c.price,
      price = GREATEST(${MIN_PRICE}, c.price * exp(
          ${regimeDrift} * c.beta
        + s.momentum * c.beta
        + c.quality * 0.0007
        + 0.004 * LEAST(1.5, GREATEST(-1.5, ln(
            GREATEST(1e6,
              CASE WHEN c.earnings > 0
                   THEN c.earnings * (14 + GREATEST(0, c.growth_rate) * 50)
                   ELSE c.revenue * 0.8 END)
            / GREATEST(1e6, c.price * c.shares_outstanding))))
        + c.volatility * sqrt(-2 * ln(random() + 1e-12)) * cos(2 * pi() * random())
      ))
    FROM sectors s
    WHERE s.id = c.sector_id AND c.status = 'active'`;

  // ---- 4. Fundamentals drift daily ----
  await sql`
    UPDATE companies SET
      revenue = GREATEST(1e5, revenue * (1 + growth_rate / 252.0 + (random() - 0.5) * 0.004)),
      cash_reserves = cash_reserves + earnings / 252.0,
      earnings = revenue * profit_margin
    WHERE status = 'active'`;

  // ---- 5. Quarterly earnings reports (staggered by earnings_offset) ----
  await sql`
    WITH reporters AS (
      SELECT id, symbol, name FROM companies
      WHERE status = 'active' AND (${day} + earnings_offset) % ${QUARTER_DAYS} = 0
    ),
    surprises AS (
      SELECT id, symbol, name, (random() - 0.42) * 0.12 AS surprise FROM reporters
    ),
    updated AS (
      UPDATE companies c SET
        profit_margin = LEAST(0.5, GREATEST(-0.35, c.profit_margin + (s.surprise) * 0.15 + (random() - 0.5) * 0.01)),
        growth_rate = c.growth_rate * 0.97 + s.surprise * 0.25,
        earnings = c.revenue * c.profit_margin,
        cash_reserves = c.cash_reserves + c.revenue * c.profit_margin / 4.0,
        price = GREATEST(${MIN_PRICE}, c.price * exp(s.surprise * 0.9))
      FROM surprises s WHERE c.id = s.id
      RETURNING c.id
    )
    INSERT INTO news_items (day, kind, headline, company_id, price_impact)
    SELECT ${day}, 'earnings',
           s.name || ' (' || s.symbol || ') reports ' ||
           CASE WHEN s.surprise > 0.03 THEN 'blowout quarterly earnings, beating expectations'
                WHEN s.surprise > 0 THEN 'quarterly earnings slightly above expectations'
                WHEN s.surprise > -0.03 THEN 'quarterly earnings just short of expectations'
                ELSE 'disappointing quarterly results, missing estimates badly' END,
           s.id, s.surprise * 0.9
    FROM surprises s
    WHERE abs(s.surprise) > 0.025`;

  // ---- 6. Idiosyncratic company news (a handful per day) ----
  await safe("company news", () =>
    sql`
    WITH targets AS (
      SELECT id, symbol, name, (random() - 0.5) * 0.12 AS impact
      FROM companies WHERE status = 'active' ORDER BY random() LIMIT 6
    ),
    bump AS (
      UPDATE companies c SET price = GREATEST(${MIN_PRICE}, c.price * exp(t.impact))
      FROM targets t WHERE c.id = t.id RETURNING c.id
    )
    INSERT INTO news_items (day, kind, headline, company_id, price_impact)
    SELECT ${day}, 'company',
           name || ' (' || symbol || ') ' ||
           CASE WHEN impact > 0.05 THEN 'lands a major contract; shares jump'
                WHEN impact > 0 THEN 'announces expansion plans'
                WHEN impact > -0.05 THEN 'faces analyst downgrade'
                ELSE 'hit by lawsuit and executive departures; shares tumble' END,
           id, impact
    FROM targets`
  );

  // ---- 6b. Analyst coverage: re-rate a slice of the market each day ----
  // Targets derive from fundamental fair value with analyst noise; big rating
  // jumps make the news.
  await safe("analyst ratings", () =>
    sql`
    WITH picks AS (
      SELECT id, symbol, name, price, shares_outstanding, earnings, revenue, growth_rate, analyst_rating
      FROM companies
      WHERE status = 'active' AND rated_day <= ${day - 45}
      ORDER BY random() LIMIT 60
    ),
    calc AS (
      SELECT id, symbol, name, price, shares_outstanding, analyst_rating AS old_rating,
        GREATEST(0.5,
          (CASE WHEN earnings > 0 THEN earnings * (14 + GREATEST(0, growth_rate) * 50)
                ELSE revenue * 0.8 END) / shares_outstanding
        ) * (0.85 + random() * 0.4) AS target
      FROM picks
    ),
    rated AS (
      SELECT *,
        CASE WHEN target / price - 1 > 0.25 THEN 5
             WHEN target / price - 1 > 0.08 THEN 4
             WHEN target / price - 1 > -0.08 THEN 3
             WHEN target / price - 1 > -0.25 THEN 2
             ELSE 1 END AS new_rating
      FROM calc
    ),
    upd AS (
      UPDATE companies c SET analyst_rating = r.new_rating,
        price_target = round(r.target::numeric, 2), rated_day = ${day}
      FROM rated r WHERE c.id = r.id RETURNING c.id
    )
    INSERT INTO news_items (day, kind, headline, company_id)
    SELECT ${day}, 'rating',
      name || ' (' || symbol || ') ' ||
      CASE WHEN new_rating > old_rating THEN 'upgraded by analysts to ' ELSE 'downgraded by analysts to ' END ||
      CASE new_rating WHEN 5 THEN 'Strong Buy' WHEN 4 THEN 'Buy' WHEN 3 THEN 'Hold' WHEN 2 THEN 'Underperform' ELSE 'Sell' END,
      id
    FROM rated
    WHERE abs(new_rating - old_rating) >= 2 AND price * shares_outstanding > 1e9`
  );

  // ---- 7. Dividends: quarterly, staggered mid-cycle ----
  await sql`
    WITH payouts AS (
      SELECT h.user_id, sum(h.shares * c.price * c.dividend_yield / 4.0) AS amount
      FROM holdings h
      JOIN companies c ON c.id = h.company_id
      WHERE c.status = 'active' AND c.dividend_yield > 0
        AND (${day} + c.earnings_offset) % ${QUARTER_DAYS} = 31
      GROUP BY h.user_id
    )
    UPDATE players p SET cash = p.cash + payouts.amount, total_dividends = p.total_dividends + payouts.amount
    FROM payouts WHERE p.user_id = payouts.user_id`;

  // ---- 8. Distress tracking & bankruptcies ----
  await sql`
    UPDATE companies SET distress_days =
      CASE WHEN price < 1.0 OR (earnings < 0 AND cash_reserves < -revenue * 0.1) OR cash_reserves < 0
           THEN distress_days + 1 ELSE GREATEST(0, distress_days - 2) END
    WHERE status = 'active'`;

  const bankrupt = (await sql`
    WITH victims AS (
      SELECT id, symbol, name FROM companies
      WHERE status = 'active' AND distress_days > 15 AND random() < 0.07
      LIMIT 5
    ),
    mark AS (
      UPDATE companies c SET status = 'bankrupt', delisted_day = ${day}, price = 0, prev_close = 0
      FROM victims v WHERE c.id = v.id RETURNING c.id
    ),
    losses AS (
      SELECT h.user_id, sum(h.shares * h.avg_cost) AS loss
      FROM holdings h JOIN victims v ON v.id = h.company_id GROUP BY h.user_id
    ),
    charge AS (
      UPDATE players p SET realized_pnl = p.realized_pnl - losses.loss
      FROM losses WHERE p.user_id = losses.user_id RETURNING p.user_id
    ),
    wipe AS (
      DELETE FROM holdings h USING victims v WHERE h.company_id = v.id RETURNING h.user_id
    ),
    cancel AS (
      UPDATE orders o SET status = 'cancelled' FROM victims v
      WHERE o.company_id = v.id AND o.status = 'open' RETURNING o.id
    )
    INSERT INTO news_items (day, kind, headline, company_id)
    SELECT ${day}, 'bankruptcy', name || ' (' || symbol || ') files for bankruptcy; shares delisted and worthless', id
    FROM victims
    RETURNING company_id`) as { company_id: number }[];

  // ---- 8b. M&A: occasionally a large company swallows a smaller one ----
  // Long holders are cashed out at a premium; shorts are forced to cover at
  // the deal price (signed share math handles both in one statement).
  if (Math.random() < 0.06) {
    await safe("m&a", () =>
      sql`
      WITH target AS (
        SELECT id, symbol, name, price, shares_outstanding, sector_id,
               price * shares_outstanding AS cap
        FROM companies
        WHERE status = 'active' AND price * shares_outstanding BETWEEN 5e7 AND 5e9
        ORDER BY random() LIMIT 1
      ),
      acq AS (
        SELECT c.id, c.symbol, c.name FROM companies c, target t
        WHERE c.status = 'active' AND c.id <> t.id
          AND c.price * c.shares_outstanding > 4 * t.cap
        ORDER BY (c.sector_id = t.sector_id)::int DESC, random() LIMIT 1
      ),
      deal AS (
        SELECT t.id, t.symbol, t.name, t.price, t.shares_outstanding,
               a.symbol AS acq_symbol, a.name AS acq_name, a.id AS acq_id,
               round((t.price * (1.2 + random() * 0.3))::numeric, 2) AS payout
        FROM target t, acq a
      ),
      payoff AS (
        SELECT h.user_id, sum(h.shares * d.payout) AS cash_delta,
               sum((d.payout - h.avg_cost) * h.shares) AS pnl
        FROM holdings h JOIN deal d ON d.id = h.company_id GROUP BY h.user_id
      ),
      pay AS (
        UPDATE players p SET cash = p.cash + payoff.cash_delta,
          realized_pnl = p.realized_pnl + payoff.pnl
        FROM payoff WHERE p.user_id = payoff.user_id RETURNING p.user_id
      ),
      wipe AS (
        DELETE FROM holdings h USING deal d WHERE h.company_id = d.id RETURNING h.user_id
      ),
      cancel AS (
        UPDATE orders o SET status = 'cancelled' FROM deal d
        WHERE o.company_id = d.id AND o.status = 'open' RETURNING o.id
      ),
      mark AS (
        UPDATE companies c SET status = 'acquired', delisted_day = ${day},
          price = d.payout, prev_close = d.payout
        FROM deal d WHERE c.id = d.id RETURNING c.id
      ),
      chest AS (
        UPDATE companies c SET cash_reserves = c.cash_reserves - d.payout * d.shares_outstanding
        FROM deal d WHERE c.id = d.acq_id RETURNING c.id
      )
      INSERT INTO news_items (day, kind, headline, company_id, price_impact)
      SELECT ${day}, 'merger',
        acq_name || ' (' || acq_symbol || ') acquires ' || name || ' (' || symbol || ') for $' || payout || ' per share',
        id, payout / price - 1
      FROM deal`
    );
  }

  // ---- 8c. Stock splits: keep runaway share prices in a tradable range ----
  await safe("splits", () =>
    sql`
    WITH cand AS (
      SELECT id, symbol, name, price FROM companies
      WHERE status = 'active' AND price > 900 LIMIT 10
    ),
    s AS (SELECT *, CASE WHEN price > 3000 THEN 10 ELSE 4 END AS ratio FROM cand),
    c1 AS (
      UPDATE companies c SET price = c.price / s.ratio, prev_close = c.prev_close / s.ratio,
        shares_outstanding = c.shares_outstanding * s.ratio,
        price_target = c.price_target / s.ratio
      FROM s WHERE c.id = s.id RETURNING c.id
    ),
    h1 AS (
      UPDATE holdings h SET shares = h.shares * s.ratio, avg_cost = h.avg_cost / s.ratio
      FROM s WHERE h.company_id = s.id RETURNING h.user_id
    ),
    b1 AS (
      UPDATE price_bars pb SET open = pb.open / s.ratio, high = pb.high / s.ratio,
        low = pb.low / s.ratio, close = pb.close / s.ratio, volume = pb.volume * s.ratio
      FROM s WHERE pb.company_id = s.id RETURNING pb.company_id
    ),
    o1 AS (
      UPDATE orders o SET status = 'cancelled' FROM s
      WHERE o.company_id = s.id AND o.status = 'open' RETURNING o.id
    )
    INSERT INTO news_items (day, kind, headline, company_id)
    SELECT ${day}, 'split', name || ' (' || symbol || ') announces a ' || ratio || '-for-1 stock split', id
    FROM s`
  );

  // ---- 9. IPOs: replenish the market toward TARGET_COMPANIES ----
  const [{ active }] = (await sql`SELECT count(*)::int AS active FROM companies WHERE status = 'active'`) as {
    active: number;
  }[];
  const deficit = TARGET_COMPANIES - active;
  let ipoCount = Math.max(0, Math.min(deficit, 3));
  if (Math.random() < 0.25) ipoCount += 1; // occasional net-new listing
  if (ipoCount > 0) {
    const symrows = (await sql`SELECT symbol FROM companies`) as { symbol: string }[];
    const used = new Set(symrows.map((r) => r.symbol));
    const newcos = generateCompanies(ipoCount, used);
    for (const c of newcos) {
      const sectorName = SECTOR_DEFS[c.sectorIndex].name;
      await sql`
        WITH sec AS (SELECT id FROM sectors WHERE name = ${sectorName}),
        ins AS (
          INSERT INTO companies (symbol, name, sector_id, description, status, listed_day,
            price, prev_close, shares_outstanding, revenue, earnings, cash_reserves,
            growth_rate, profit_margin, volatility, beta, quality, dividend_yield, earnings_offset)
          SELECT ${c.symbol}, ${c.name}, sec.id, ${c.description}, 'active', ${day},
            ${c.price}, ${c.price}, ${c.sharesOutstanding}, ${c.revenue}, ${c.earnings}, ${c.cashReserves},
            ${c.growthRate}, ${c.profitMargin}, ${c.volatility}, ${c.beta}, ${c.quality}, ${c.dividendYield}, ${c.earningsOffset}
          FROM sec RETURNING id
        )
        INSERT INTO news_items (day, kind, headline, company_id)
        SELECT ${day}, 'ipo', ${`${c.name} (${c.symbol}) goes public at $${c.price.toFixed(2)} per share`}, id FROM ins`;
    }
  }

  // ---- 10. Write today's OHLCV bars ----
  await sql`
    INSERT INTO price_bars (company_id, day, open, high, low, close, volume)
    SELECT id, ${day}, prev_close,
           GREATEST(prev_close, price) * (1 + random() * volatility * 0.7),
           LEAST(prev_close, price) * (1 - random() * volatility * 0.7),
           price,
           GREATEST(1000, round(shares_outstanding * (0.002 + random() * 0.012)))::bigint
    FROM companies WHERE status = 'active'
    ON CONFLICT (company_id, day) DO NOTHING`;

  // ---- 11. Market & sector indices (cap-weighted average price level) ----
  await sql`
    INSERT INTO index_bars (index_key, day, value)
    SELECT 'COMPOSITE', ${day}, sum(price * shares_outstanding) / 1e9
    FROM companies WHERE status = 'active'
    ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO index_bars (index_key, day, value)
    SELECT 'SECTOR:' || sector_id, ${day}, sum(price * shares_outstanding) / 1e9
    FROM companies WHERE status = 'active' GROUP BY sector_id
    ON CONFLICT DO NOTHING`;

  // ---- 12. Fill crossed limit orders ----
  await fillLimitOrders(day);

  // ---- 12b. Margin calls: force-cover shorts on under-margined accounts ----
  await runMarginCalls(day);

  // ---- 13. Daily portfolio snapshots (for charts + leaderboard) ----
  await sql`
    INSERT INTO portfolio_snapshots (user_id, day, net_worth, cash)
    SELECT p.user_id, ${day},
           p.cash + COALESCE(sum(h.shares * c.price), 0),
           p.cash
    FROM players p
    LEFT JOIN holdings h ON h.user_id = p.user_id
    LEFT JOIN companies c ON c.id = h.company_id
    GROUP BY p.user_id, p.cash
    ON CONFLICT DO NOTHING`;

  // ---- 14. Retention: trim old data ----
  if (day % 10 === 0) {
    await sql`DELETE FROM price_bars WHERE day < ${day - BAR_RETENTION_DAYS}`;
    await sql`DELETE FROM news_items WHERE day < ${day - NEWS_RETENTION_DAYS}`;
  }

  return { regimeDrift, regimeLabel };
}

/**
 * Force-cover short positions for accounts below maintenance margin.
 * Covers the largest short (with a punitive 1% slip) until the account is
 * back above maintenance or has no shorts left.
 */
async function runMarginCalls(day: number) {
  const shortAccounts = (await sql`
    SELECT DISTINCT user_id FROM holdings WHERE shares < 0 LIMIT 200`) as { user_id: string }[];

  for (const { user_id } of shortAccounts) {
    for (let i = 0; i < 5; i++) {
      const state = (await sql`
        SELECT p.cash,
               COALESCE(sum(CASE WHEN h.shares > 0 THEN h.shares * c.price ELSE 0 END), 0) AS long_val,
               COALESCE(sum(CASE WHEN h.shares < 0 THEN -h.shares * c.price ELSE 0 END), 0) AS short_val
        FROM players p
        LEFT JOIN holdings h ON h.user_id = p.user_id
        LEFT JOIN companies c ON c.id = h.company_id
        WHERE p.user_id = ${user_id}
        GROUP BY p.cash`) as { cash: number; long_val: number; short_val: number }[];
      if (state.length === 0) break;
      const { cash, long_val, short_val } = state[0];
      const equity = Number(cash) + Number(long_val) - Number(short_val);
      if (Number(short_val) <= 0 || equity >= MAINTENANCE_MARGIN * Number(short_val)) break;

      const worst = (await sql`
        SELECT h.company_id, h.shares, h.avg_cost, c.price
        FROM holdings h JOIN companies c ON c.id = h.company_id
        WHERE h.user_id = ${user_id} AND h.shares < 0
        ORDER BY h.shares * c.price ASC LIMIT 1`) as {
        company_id: number;
        shares: number;
        avg_cost: number;
        price: number;
      }[];
      if (worst.length === 0) break;
      const w = worst[0];
      const qty = -Number(w.shares);
      const fill = Number(w.price) * 1.01; // punitive liquidation slip
      const pnl = (Number(w.avg_cost) - fill) * qty;
      await sql`UPDATE players SET cash = cash - ${fill * qty}, realized_pnl = realized_pnl + ${pnl}
                WHERE user_id = ${user_id}`;
      await sql`DELETE FROM holdings WHERE user_id = ${user_id} AND company_id = ${w.company_id}`;
      await sql`INSERT INTO trades (user_id, company_id, side, shares, price, realized_pnl, day)
                VALUES (${user_id}, ${w.company_id}, 'cover', ${qty}, ${fill}, ${pnl}, ${day})`;
    }
  }
}

/** Fill open limit orders whose limit crosses the new price. */
async function fillLimitOrders(day: number) {
  const crossed = (await sql`
    SELECT o.id, o.user_id, o.company_id, o.side, o.shares, o.limit_price, c.price
    FROM orders o
    JOIN companies c ON c.id = o.company_id
    WHERE o.status = 'open' AND o.type = 'limit' AND c.status = 'active'
      AND ((o.side = 'buy' AND c.price <= o.limit_price)
        OR (o.side = 'sell' AND c.price >= o.limit_price))
    ORDER BY o.id
    LIMIT 200`) as {
    id: number;
    user_id: string;
    company_id: number;
    side: string;
    shares: number;
    limit_price: number;
    price: number;
  }[];

  for (const o of crossed) {
    // Fill at the better of limit price and market price.
    const fill = o.side === "buy" ? Math.min(o.limit_price, o.price) : Math.max(o.limit_price, o.price);
    if (o.side === "buy") {
      // A limit buy against a short position acts as a cover; it must not
      // cross through zero (cancel instead — avg-cost bookkeeping can't span).
      const posRows = (await sql`
        SELECT shares, avg_cost FROM holdings
        WHERE user_id = ${o.user_id} AND company_id = ${o.company_id}`) as {
        shares: number;
        avg_cost: number;
      }[];
      const pos = posRows.length ? Number(posRows[0].shares) : 0;
      if (pos < 0) {
        if (o.shares > -pos) {
          await sql`UPDATE orders SET status = 'cancelled' WHERE id = ${o.id}`;
          continue;
        }
        const pnl = (Number(posRows[0].avg_cost) - fill) * o.shares;
        await sql`UPDATE players SET cash = cash - ${fill * o.shares}, realized_pnl = realized_pnl + ${pnl}
                  WHERE user_id = ${o.user_id}`;
        await sql`UPDATE holdings SET shares = shares + ${o.shares}
                  WHERE user_id = ${o.user_id} AND company_id = ${o.company_id}`;
        await sql`DELETE FROM holdings WHERE user_id = ${o.user_id} AND company_id = ${o.company_id} AND shares = 0`;
        await sql`INSERT INTO trades (user_id, company_id, side, shares, price, realized_pnl, day)
                  VALUES (${o.user_id}, ${o.company_id}, 'cover', ${o.shares}, ${fill}, ${pnl}, ${day})`;
        await sql`UPDATE orders SET status = 'filled', fill_price = ${fill}, filled_day = ${day} WHERE id = ${o.id}`;
        continue;
      }
      const cost = fill * o.shares;
      const paid = await sql`
        UPDATE players SET cash = cash - ${cost}
        WHERE user_id = ${o.user_id} AND cash >= ${cost} RETURNING user_id`;
      if (paid.length === 0) {
        await sql`UPDATE orders SET status = 'cancelled' WHERE id = ${o.id}`;
        continue;
      }
      await sql`
        INSERT INTO holdings (user_id, company_id, shares, avg_cost)
        VALUES (${o.user_id}, ${o.company_id}, ${o.shares}, ${fill})
        ON CONFLICT (user_id, company_id) DO UPDATE SET
          avg_cost = (holdings.avg_cost * holdings.shares + ${cost}) / (holdings.shares + ${o.shares}),
          shares = holdings.shares + ${o.shares}`;
      await sql`INSERT INTO trades (user_id, company_id, side, shares, price, day)
                VALUES (${o.user_id}, ${o.company_id}, 'buy', ${o.shares}, ${fill}, ${day})`;
    } else {
      const sold = (await sql`
        UPDATE holdings SET shares = shares - ${o.shares}
        WHERE user_id = ${o.user_id} AND company_id = ${o.company_id} AND shares >= ${o.shares}
        RETURNING avg_cost`) as { avg_cost: number }[];
      if (sold.length === 0) {
        await sql`UPDATE orders SET status = 'cancelled' WHERE id = ${o.id}`;
        continue;
      }
      const pnl = (fill - sold[0].avg_cost) * o.shares;
      await sql`UPDATE players SET cash = cash + ${fill * o.shares}, realized_pnl = realized_pnl + ${pnl}
                WHERE user_id = ${o.user_id}`;
      await sql`DELETE FROM holdings WHERE user_id = ${o.user_id} AND company_id = ${o.company_id} AND shares = 0`;
      await sql`INSERT INTO trades (user_id, company_id, side, shares, price, realized_pnl, day)
                VALUES (${o.user_id}, ${o.company_id}, 'sell', ${o.shares}, ${fill}, ${pnl}, ${day})`;
    }
    await sql`UPDATE orders SET status = 'filled', fill_price = ${fill}, filled_day = ${day} WHERE id = ${o.id}`;
  }
}

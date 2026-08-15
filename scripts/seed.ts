/**
 * Seed the StockTycoon universe: sectors, ~5000 companies, 90 days of
 * backfilled price history, and the market state singleton.
 *
 * Usage: DATABASE_URL=postgres://... npm run seed
 * Idempotent-ish: refuses to run if companies already exist (pass --force to wipe).
 */
import { neon } from "@neondatabase/serverless";
import { generateCompanies, SECTOR_DEFS } from "../src/lib/sim/names";
import { TARGET_COMPANIES } from "../src/lib/sim/config";

const BACKFILL_DAYS = 90;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = neon(url);

  const existing = (await sql`SELECT count(*)::int AS n FROM companies`) as { n: number }[];
  if (existing[0].n > 0) {
    if (!process.argv.includes("--force")) {
      console.log(`Database already has ${existing[0].n} companies. Pass --force to wipe and reseed.`);
      return;
    }
    console.log("Wiping existing simulation data...");
    await sql`TRUNCATE price_bars, news_items, trades, orders, holdings, portfolio_snapshots, index_bars, companies, sectors, market_state, players RESTART IDENTITY CASCADE`;
  }

  console.log("Seeding sectors...");
  for (const s of SECTOR_DEFS) {
    await sql`INSERT INTO sectors (name, momentum, base_volatility, base_growth)
              VALUES (${s.name}, 0, ${s.baseVolatility}, ${s.baseGrowth})
              ON CONFLICT (name) DO NOTHING`;
  }
  const sectorRows = (await sql`SELECT id, name FROM sectors`) as { id: number; name: string }[];
  const sectorIdByName = new Map(sectorRows.map((r) => [r.name, r.id]));

  console.log(`Generating ${TARGET_COMPANIES} companies...`);
  const used = new Set<string>();
  const companies = generateCompanies(TARGET_COMPANIES, used);

  console.log("Inserting companies in batches...");
  const BATCH = 250;
  for (let i = 0; i < companies.length; i += BATCH) {
    const batch = companies.slice(i, i + BATCH);
    const values = batch.map((c) => [
      c.symbol,
      c.name,
      sectorIdByName.get(SECTOR_DEFS[c.sectorIndex].name)!,
      c.description,
      "active",
      0,
      c.price,
      c.price,
      c.sharesOutstanding,
      c.revenue,
      c.earnings,
      c.cashReserves,
      c.growthRate,
      c.profitMargin,
      c.volatility,
      c.beta,
      c.quality,
      c.dividendYield,
      c.earningsOffset,
    ]);
    // Build a multi-row parameterized insert.
    const cols =
      "(symbol, name, sector_id, description, status, listed_day, price, prev_close, shares_outstanding, revenue, earnings, cash_reserves, growth_rate, profit_margin, volatility, beta, quality, dividend_yield, earnings_offset)";
    const placeholders = values
      .map(
        (_, r) =>
          `(${Array.from({ length: 19 }, (_, cIdx) => `$${r * 19 + cIdx + 1}`).join(",")})`
      )
      .join(",");
    await sql(`INSERT INTO companies ${cols} VALUES ${placeholders}`, values.flat());
    process.stdout.write(`\r  ${Math.min(i + BATCH, companies.length)}/${companies.length}`);
  }
  console.log("\nBackfilling price history (this can take a minute)...");

  // Random-walk backfill entirely in SQL: recursive CTE walks each company
  // forward BACKFILL_DAYS days, then bars are derived with window functions
  // and companies' live prices are set to the final day's close.
  await sql(`
    WITH RECURSIVE walk AS (
      SELECT id AS company_id, 0 AS day, price AS close, volatility, quality, shares_outstanding
      FROM companies WHERE status = 'active'
      UNION ALL
      SELECT company_id, day + 1,
             GREATEST(0.05, close * exp(quality * 0.0007 + volatility * sqrt(-2*ln(random()+1e-12)) * cos(2*pi()*random()))),
             volatility, quality, shares_outstanding
      FROM walk WHERE day < ${BACKFILL_DAYS}
    ),
    bars AS (
      SELECT company_id, day, close,
             COALESCE(lag(close) OVER (PARTITION BY company_id ORDER BY day), close) AS open,
             volatility, shares_outstanding
      FROM walk
    )
    INSERT INTO price_bars (company_id, day, open, high, low, close, volume)
    SELECT company_id, day, open,
           GREATEST(open, close) * (1 + random() * volatility * 0.7),
           LEAST(open, close) * (1 - random() * volatility * 0.7),
           close,
           GREATEST(1000, round(shares_outstanding * (0.002 + random() * 0.012)))::bigint
    FROM bars
    ON CONFLICT (company_id, day) DO NOTHING
  `);

  await sql(`
    UPDATE companies c SET
      price = pb.close,
      prev_close = pb.open
    FROM price_bars pb
    WHERE pb.company_id = c.id AND pb.day = ${BACKFILL_DAYS}
  `);

  console.log("Initializing analyst coverage...");
  await sql(`
    UPDATE companies SET
      price_target = round((GREATEST(0.5,
        (CASE WHEN earnings > 0 THEN earnings * (14 + GREATEST(0, growth_rate) * 50)
              ELSE revenue * 0.8 END) / shares_outstanding
      ) * (0.85 + random() * 0.4))::numeric, 2),
      rated_day = ${BACKFILL_DAYS}
  `);
  await sql(`
    UPDATE companies SET analyst_rating =
      CASE WHEN price_target / price - 1 > 0.25 THEN 5
           WHEN price_target / price - 1 > 0.08 THEN 4
           WHEN price_target / price - 1 > -0.08 THEN 3
           WHEN price_target / price - 1 > -0.25 THEN 2
           ELSE 1 END
  `);

  console.log("Building index history...");
  await sql(`
    INSERT INTO index_bars (index_key, day, value)
    SELECT 'COMPOSITE', pb.day, sum(pb.close * c.shares_outstanding) / 1e9
    FROM price_bars pb JOIN companies c ON c.id = pb.company_id
    GROUP BY pb.day
    ON CONFLICT DO NOTHING
  `);
  await sql(`
    INSERT INTO index_bars (index_key, day, value)
    SELECT 'SECTOR:' || c.sector_id, pb.day, sum(pb.close * c.shares_outstanding) / 1e9
    FROM price_bars pb JOIN companies c ON c.id = pb.company_id
    GROUP BY c.sector_id, pb.day
    ON CONFLICT DO NOTHING
  `);

  console.log("Initializing market state...");
  // Anchor the epoch so that "now" corresponds to market day BACKFILL_DAYS.
  const dayMs = Number(process.env.SIM_DAY_MS ?? 300000);
  const epoch = Date.now() - BACKFILL_DAYS * dayMs;
  await sql`
    INSERT INTO market_state (id, market_day, epoch_ms, regime_drift, regime_label)
    VALUES (1, ${BACKFILL_DAYS}, ${epoch}, 0.0002, 'neutral')
    ON CONFLICT (id) DO UPDATE SET market_day = ${BACKFILL_DAYS}, epoch_ms = ${epoch}`;

  const openingHeadline = `The StockTycoon Exchange opens for trading with ${TARGET_COMPANIES} listed companies`;
  await sql`INSERT INTO news_items (day, kind, headline)
            VALUES (${BACKFILL_DAYS}, 'macro', ${openingHeadline})`;

  console.log("Done. Market is live.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

# StockTycoon

A large-scale, realistic stock market simulator game. **5,000 procedurally generated companies** live and die in a persistent simulated economy — earnings seasons, dividends, sector rotations, macro regimes, bankruptcies, and IPOs — while players compete to grow $100,000 in starting cash.

Built with **Next.js (App Router) + TypeScript**, **Neon Postgres** (via the serverless HTTP driver + Drizzle schema), and **Neon Auth (Managed Better Auth)**. Designed to deploy on **Vercel** with no always-on server.

## How the simulation works

- **Time**: 1 market day passes every 5 real minutes (`SIM_DAY_MS`, default 300000). A full game year ≈ 21 real hours.
- **Lazy ticks**: the market is anchored to a wall-clock epoch. Any page load or API call advances the simulation to "now" (capped at 15 days per request). An optional hourly Vercel cron (`/api/cron/tick`) keeps the world moving during quiet hours.
- **Tick concurrency**: one invocation ticks at a time, holding an expiring lease (`market_state.tick_lock_until`); everyone else reads the current day and renders immediately. Serverless requests are stateless, so session advisory locks don't hold across calls, and a per-day CAS alone isn't enough — two invocations claiming *different* days would run their bulk `UPDATE companies` concurrently over the same 5,000 rows and deadlock. The lease expires on its own, so a crashed invocation can't wedge the market; the per-day CAS is kept as a second line of defence.
- **Valuation anchoring**: prices are pulled toward fundamental fair value each day. Because the seeded universe starts richly priced relative to that anchor, the composite index drifts down over its first few hundred days as the gap closes — this is the anchor working, and it self-limits as prices converge.
- **Prices**: daily log-returns from a factor model — market regime × beta, sector momentum × beta, idiosyncratic quality drift, a valuation-anchoring term that pulls price toward fundamentals, plus Gaussian noise scaled by per-company volatility. All 5,000 companies update in one set-based SQL statement.
- **Fundamentals**: revenue grows daily; staggered quarterly earnings reports produce surprises that jump prices and re-rate growth/margins.
- **Dividends**: mature profitable companies pay quarterly dividends straight into holders' cash.
- **Failure**: companies in sustained distress (penny-stock prices, negative earnings, empty coffers) go bankrupt — shares are wiped to zero, holdings written off, orders cancelled, news published.
- **Renewal**: IPOs replenish the market toward 5,000 listed companies, with occasional net-new listings.
- **M&A**: large cash-rich companies occasionally acquire smaller ones at a 20-50% premium — long holders are cashed out at the deal price, shorts are forced to cover at it.
- **Splits**: stocks that run past $900 split 4-for-1 (10-for-1 past $3,000); holdings, orders, and full price history are adjusted.
- **Analyst coverage**: every company carries a rating (Sell → Strong Buy) and a price target derived from fundamental fair value; a slice of the market is re-rated daily and big upgrades/downgrades of large caps make the news.
- **News**: macro shocks, sector events, earnings, company events, IPOs, and bankruptcies all generate a live news feed with real price impact.

## Gameplay

- Sign up (Neon Auth) → get **$100,000** simulated cash
- **Market screener**: search, sector filter, sortable columns (price, change, market cap, P/E, dividend yield), plus a bankruptcy graveyard
- **Company pages**: candlestick chart with volume, full fundamentals, company news, trade panel
- **Orders**: market orders (instant fill with spread + square-root size impact) and limit orders (filled when the daily price crosses your limit)
- **Short selling**: borrow and sell with 30% initial margin; accounts below 15% maintenance margin are force-covered at a penalty on the daily tick. Shorts pay dividends, profit fully from bankruptcies, and eat the premium in buyouts
- **Portfolio**: holdings with live P/L, net-worth history chart, dividends, realized P/L, open orders, trade log
- **Leaderboard**: top 100 players by net worth

## Setup

### 1. Database (Neon)

Create a Neon project, then apply the schema and seed the universe:

```bash
npm install
export DATABASE_URL="postgres://...your Neon connection string..."
npm run db:push   # create tables
npm run seed      # 12 sectors, 5000 companies, 90 days of history
```

(`npm run seed -- --force` wipes and reseeds.)

### 2. Auth (Neon Auth / Managed Better Auth)

Enable **Auth** on your Neon project (Console → Branch → Auth → Enable), and copy the Auth URL.

### 3. Environment variables

```bash
DATABASE_URL=postgres://...                 # Neon connection string
NEON_AUTH_BASE_URL=https://ep-xxx.neonauth.<region>.aws.neon.tech/neondb/auth
NEON_AUTH_COOKIE_SECRET=<openssl rand -base64 32>
CRON_SECRET=<any random string>             # optional, protects /api/cron/tick
SIM_DAY_MS=300000                           # optional, real ms per market day
```

### 4. Deploy to Vercel

Push this repo to GitHub, import it into Vercel, and set the env vars above. `vercel.json` schedules an hourly cron tick. After deploying, add your production domain to Neon Auth's **trusted domains** (Console → Auth → Configuration) so sign-in redirects work.

### Local dev

```bash
npm run dev
```

## Project layout

```
src/db/schema.ts          Drizzle schema (companies, bars, news, players, orders, ...)
src/lib/sim/engine.ts     The market engine: catch-up ticks + one-day simulation
src/lib/sim/names.ts      Procedural company generator (used by seed & IPOs)
src/lib/sim/config.ts     Tuning knobs (cadence, retention, frictions)
src/lib/trading.ts        Market/limit order execution, player bootstrap
src/lib/queries.ts        Read-model queries for all pages
src/app/...               Pages: dashboard, market, company, portfolio, leaderboard, news
src/app/api/...           Trade, order-cancel, auth handler, cron tick
scripts/seed.ts           Universe seeder (requires direct DB access)
```

## Notes

- The market only needs Postgres — no queues, no websockets, no background workers. All heavy per-day work is set-based SQL over the Neon HTTP driver.
- Price history is retained for 400 days, news for 120, so storage stays bounded (~500K rows of bars).
- This is a game. No real money, no real securities.

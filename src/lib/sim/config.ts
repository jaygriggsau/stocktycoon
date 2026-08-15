// Simulation cadence & tuning knobs.

// One simulated market day elapses every DAY_MS of real time.
// Default: 5 minutes => ~1 game year (252 trading days) per ~21 real hours.
export const DAY_MS = Number(process.env.SIM_DAY_MS ?? 5 * 60 * 1000);

// Max days simulated in a single request (bounds serverless latency when
// catching up after idle periods; the market keeps catching up on later hits).
export const MAX_CATCHUP_DAYS = 15;

// Target number of listed companies. IPOs replenish toward this.
export const TARGET_COMPANIES = 5000;

// Trading days per quarter / year.
export const QUARTER_DAYS = 63;
export const YEAR_DAYS = 252;

// Starting player cash.
export const STARTING_CASH = 100_000;

// Data retention (days of history kept).
export const BAR_RETENTION_DAYS = 400;
export const NEWS_RETENTION_DAYS = 120;

// Trading frictions.
export const BASE_SPREAD = 0.0005; // 5 bps half-spread on market orders
export const MAX_IMPACT = 0.02; // price impact cap
export const MIN_PRICE = 0.01;

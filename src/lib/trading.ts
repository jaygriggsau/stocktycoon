import { sql } from "@/db";
import { BASE_SPREAD, MAX_IMPACT, STARTING_CASH, INITIAL_MARGIN, MIN_PRICE } from "./sim/config";

export type OrderSide = "buy" | "sell" | "short" | "cover";

export interface TradeResult {
  ok: boolean;
  error?: string;
  fillPrice?: number;
  shares?: number;
  realizedPnl?: number;
}

/** Ensure a player row exists for this auth user. */
export async function ensurePlayer(userId: string, displayName: string) {
  await sql`
    INSERT INTO players (user_id, display_name, cash, starting_cash, created_day)
    VALUES (${userId}, ${displayName}, ${STARTING_CASH}, ${STARTING_CASH},
            COALESCE((SELECT market_day FROM market_state WHERE id = 1), 0))
    ON CONFLICT (user_id) DO UPDATE SET display_name = ${displayName}`;
}

/**
 * Execution price for a market order: mid price adjusted by half-spread plus
 * square-root market impact scaled by order size vs. typical daily volume.
 * Buys and covers pay up; sells and shorts receive less.
 */
function executionPrice(mid: number, side: OrderSide, shares: number, sharesOutstanding: number): number {
  const advShares = Math.max(1000, sharesOutstanding * 0.007); // typical daily volume
  const participation = shares / advShares;
  const impact = Math.min(MAX_IMPACT, 0.01 * Math.sqrt(participation));
  const slip = BASE_SPREAD + impact;
  const up = side === "buy" || side === "cover";
  return Math.max(MIN_PRICE, up ? mid * (1 + slip) : mid * (1 - slip));
}

/** Player margin state: cash, long value, short exposure (all at current prices). */
export async function getMarginState(userId: string) {
  const rows = (await sql`
    SELECT p.cash,
           COALESCE(sum(CASE WHEN h.shares > 0 THEN h.shares * c.price ELSE 0 END), 0) AS long_val,
           COALESCE(sum(CASE WHEN h.shares < 0 THEN -h.shares * c.price ELSE 0 END), 0) AS short_val
    FROM players p
    LEFT JOIN holdings h ON h.user_id = p.user_id
    LEFT JOIN companies c ON c.id = h.company_id
    WHERE p.user_id = ${userId}
    GROUP BY p.cash`) as { cash: number; long_val: number; short_val: number }[];
  if (rows.length === 0) return null;
  const cash = Number(rows[0].cash);
  const longVal = Number(rows[0].long_val);
  const shortVal = Number(rows[0].short_val);
  return { cash, longVal, shortVal, equity: cash + longVal - shortVal };
}

async function getPosition(userId: string, companyId: number): Promise<{ shares: number; avgCost: number }> {
  const rows = (await sql`
    SELECT shares, avg_cost FROM holdings WHERE user_id = ${userId} AND company_id = ${companyId}`) as {
    shares: number;
    avg_cost: number;
  }[];
  if (rows.length === 0) return { shares: 0, avgCost: 0 };
  return { shares: Number(rows[0].shares), avgCost: Number(rows[0].avg_cost) };
}

export async function executeMarketOrder(
  userId: string,
  symbol: string,
  side: OrderSide,
  shares: number
): Promise<TradeResult> {
  if (!Number.isInteger(shares) || shares <= 0 || shares > 1e9) {
    return { ok: false, error: "Invalid share quantity" };
  }

  const rows = (await sql`
    SELECT companies.id, price, shares_outstanding, status, market_day
    FROM companies, market_state
    WHERE symbol = ${symbol} AND market_state.id = 1`) as {
    id: number;
    price: number;
    shares_outstanding: number;
    status: string;
    market_day: number;
  }[];
  if (rows.length === 0) return { ok: false, error: "Unknown symbol" };
  const c = rows[0];
  if (c.status !== "active") return { ok: false, error: "This company is no longer listed" };

  const fill = Math.round(executionPrice(Number(c.price), side, shares, Number(c.shares_outstanding)) * 10000) / 10000;
  const day = c.market_day;
  const pos = await getPosition(userId, c.id);

  switch (side) {
    case "buy": {
      if (pos.shares < 0) return { ok: false, error: "You are short this stock — use Cover to close the position" };
      const cost = fill * shares;
      const paid = await sql`
        UPDATE players SET cash = cash - ${cost}
        WHERE user_id = ${userId} AND cash >= ${cost} RETURNING cash`;
      if (paid.length === 0) return { ok: false, error: "Insufficient cash" };
      await sql`
        INSERT INTO holdings (user_id, company_id, shares, avg_cost)
        VALUES (${userId}, ${c.id}, ${shares}, ${fill})
        ON CONFLICT (user_id, company_id) DO UPDATE SET
          avg_cost = (holdings.avg_cost * holdings.shares + ${cost}) / (holdings.shares + ${shares}),
          shares = holdings.shares + ${shares}`;
      await recordFill(userId, c.id, "buy", shares, fill, day, null);
      return { ok: true, fillPrice: fill, shares };
    }

    case "sell": {
      if (pos.shares <= 0) return { ok: false, error: "You don't own this stock (use Short to bet against it)" };
      if (shares > pos.shares) return { ok: false, error: `You only own ${pos.shares.toLocaleString()} shares` };
      await sql`UPDATE holdings SET shares = shares - ${shares}
                WHERE user_id = ${userId} AND company_id = ${c.id}`;
      const pnl = (fill - pos.avgCost) * shares;
      await sql`UPDATE players SET cash = cash + ${fill * shares}, realized_pnl = realized_pnl + ${pnl}
                WHERE user_id = ${userId}`;
      await sql`DELETE FROM holdings WHERE user_id = ${userId} AND company_id = ${c.id} AND shares = 0`;
      await recordFill(userId, c.id, "sell", shares, fill, day, pnl);
      return { ok: true, fillPrice: fill, shares, realizedPnl: pnl };
    }

    case "short": {
      if (pos.shares > 0) return { ok: false, error: "Close your long position before shorting" };
      const margin = await getMarginState(userId);
      if (!margin) return { ok: false, error: "No player account" };
      const newShortVal = margin.shortVal + shares * fill;
      if (margin.equity < INITIAL_MARGIN * newShortVal) {
        return {
          ok: false,
          error: `Insufficient margin: this short needs ${Math.round(INITIAL_MARGIN * 100)}% equity coverage (${fmtUsd(
            INITIAL_MARGIN * newShortVal
          )} needed, ${fmtUsd(margin.equity)} available)`,
        };
      }
      const proceeds = fill * shares;
      await sql`
        INSERT INTO holdings (user_id, company_id, shares, avg_cost)
        VALUES (${userId}, ${c.id}, ${-shares}, ${fill})
        ON CONFLICT (user_id, company_id) DO UPDATE SET
          avg_cost = (holdings.avg_cost * -holdings.shares + ${proceeds}) / (-holdings.shares + ${shares}),
          shares = holdings.shares - ${shares}`;
      await sql`UPDATE players SET cash = cash + ${proceeds} WHERE user_id = ${userId}`;
      await recordFill(userId, c.id, "short", shares, fill, day, null);
      return { ok: true, fillPrice: fill, shares };
    }

    case "cover": {
      if (pos.shares >= 0) return { ok: false, error: "You have no short position to cover" };
      const shortSize = -pos.shares;
      if (shares > shortSize) return { ok: false, error: `Your short is only ${shortSize.toLocaleString()} shares` };
      const cost = fill * shares;
      const pnl = (pos.avgCost - fill) * shares;
      // Covering may push cash negative (margin debt) — that's allowed.
      await sql`UPDATE players SET cash = cash - ${cost}, realized_pnl = realized_pnl + ${pnl}
                WHERE user_id = ${userId}`;
      await sql`UPDATE holdings SET shares = shares + ${shares}
                WHERE user_id = ${userId} AND company_id = ${c.id}`;
      await sql`DELETE FROM holdings WHERE user_id = ${userId} AND company_id = ${c.id} AND shares = 0`;
      await recordFill(userId, c.id, "cover", shares, fill, day, pnl);
      return { ok: true, fillPrice: fill, shares, realizedPnl: pnl };
    }

    default:
      return { ok: false, error: "Invalid side" };
  }
}

async function recordFill(
  userId: string,
  companyId: number,
  side: OrderSide,
  shares: number,
  fill: number,
  day: number,
  pnl: number | null
) {
  await sql`INSERT INTO trades (user_id, company_id, side, shares, price, realized_pnl, day)
            VALUES (${userId}, ${companyId}, ${side}, ${shares}, ${fill}, ${pnl}, ${day})`;
  await sql`INSERT INTO orders (user_id, company_id, side, type, status, shares, fill_price, placed_day, filled_day)
            VALUES (${userId}, ${companyId}, ${side}, 'market', 'filled', ${shares}, ${fill}, ${day}, ${day})`;
}

function fmtUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export async function placeLimitOrder(
  userId: string,
  symbol: string,
  side: "buy" | "sell",
  shares: number,
  limitPrice: number
): Promise<TradeResult> {
  if (!Number.isInteger(shares) || shares <= 0 || shares > 1e9) {
    return { ok: false, error: "Invalid share quantity" };
  }
  if (!(limitPrice > 0) || limitPrice > 1e7) return { ok: false, error: "Invalid limit price" };

  const rows = (await sql`
    SELECT companies.id, status, market_day FROM companies, market_state
    WHERE symbol = ${symbol} AND market_state.id = 1`) as { id: number; status: string; market_day: number }[];
  if (rows.length === 0) return { ok: false, error: "Unknown symbol" };
  if (rows[0].status !== "active") return { ok: false, error: "This company is no longer listed" };

  const openCount = (await sql`
    SELECT count(*)::int AS n FROM orders WHERE user_id = ${userId} AND status = 'open'`) as { n: number }[];
  if (openCount[0].n >= 50) return { ok: false, error: "Too many open orders (max 50)" };

  await sql`INSERT INTO orders (user_id, company_id, side, type, status, shares, limit_price, placed_day)
            VALUES (${userId}, ${rows[0].id}, ${side}, 'limit', 'open', ${shares}, ${limitPrice}, ${rows[0].market_day})`;
  return { ok: true, shares };
}

export async function cancelOrder(userId: string, orderId: number): Promise<TradeResult> {
  const rows = await sql`
    UPDATE orders SET status = 'cancelled'
    WHERE id = ${orderId} AND user_id = ${userId} AND status = 'open' RETURNING id`;
  if (rows.length === 0) return { ok: false, error: "Order not found or not open" };
  return { ok: true };
}

import { sql } from "@/db";
import { BASE_SPREAD, MAX_IMPACT, STARTING_CASH } from "./sim/config";

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
 */
function executionPrice(mid: number, side: "buy" | "sell", shares: number, sharesOutstanding: number): number {
  const advShares = Math.max(1000, sharesOutstanding * 0.007); // typical daily volume
  const participation = (shares / advShares);
  const impact = Math.min(MAX_IMPACT, 0.01 * Math.sqrt(participation));
  const slip = BASE_SPREAD + impact;
  return side === "buy" ? mid * (1 + slip) : mid * (1 - slip);
}

export async function executeMarketOrder(
  userId: string,
  symbol: string,
  side: "buy" | "sell",
  shares: number
): Promise<TradeResult> {
  if (!Number.isInteger(shares) || shares <= 0 || shares > 1e9) {
    return { ok: false, error: "Invalid share quantity" };
  }

  const rows = (await sql`
    SELECT id, price, shares_outstanding, status, market_day
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

  const fill = Math.round(executionPrice(c.price, side, shares, c.shares_outstanding) * 10000) / 10000;
  const day = c.market_day;

  if (side === "buy") {
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
    await sql`INSERT INTO trades (user_id, company_id, side, shares, price, day)
              VALUES (${userId}, ${c.id}, 'buy', ${shares}, ${fill}, ${day})`;
    await sql`INSERT INTO orders (user_id, company_id, side, type, status, shares, fill_price, placed_day, filled_day)
              VALUES (${userId}, ${c.id}, 'buy', 'market', 'filled', ${shares}, ${fill}, ${day}, ${day})`;
    return { ok: true, fillPrice: fill, shares };
  } else {
    const sold = (await sql`
      UPDATE holdings SET shares = shares - ${shares}
      WHERE user_id = ${userId} AND company_id = ${c.id} AND shares >= ${shares}
      RETURNING avg_cost`) as { avg_cost: number }[];
    if (sold.length === 0) return { ok: false, error: "Not enough shares to sell" };
    const pnl = (fill - sold[0].avg_cost) * shares;
    await sql`UPDATE players SET cash = cash + ${fill * shares}, realized_pnl = realized_pnl + ${pnl}
              WHERE user_id = ${userId}`;
    await sql`DELETE FROM holdings WHERE user_id = ${userId} AND company_id = ${c.id} AND shares = 0`;
    await sql`INSERT INTO trades (user_id, company_id, side, shares, price, realized_pnl, day)
              VALUES (${userId}, ${c.id}, 'sell', ${shares}, ${fill}, ${pnl}, ${day})`;
    await sql`INSERT INTO orders (user_id, company_id, side, type, status, shares, fill_price, placed_day, filled_day)
              VALUES (${userId}, ${c.id}, 'sell', 'market', 'filled', ${shares}, ${fill}, ${day}, ${day})`;
    return { ok: true, fillPrice: fill, shares, realizedPnl: pnl };
  }
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

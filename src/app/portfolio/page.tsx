import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/server";
import { getPortfolio } from "@/lib/queries";
import { ensurePlayer } from "@/lib/trading";
import { LineChart } from "@/components/charts/LineChart";
import { CancelOrderButton } from "@/components/CancelOrderButton";
import { fmtMoney, fmtPct, fmtCompact, changeClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in");

  await ensurePlayer(user.id, user.name);
  const p = await getPortfolio(user.id);
  if (!p) redirect("/");

  const totalReturn = p.netWorth / p.startingCash - 1;
  const unrealized = p.holdings.reduce((s, h) => s + h.unrealized, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold">{p.displayName}&apos;s Portfolio</h1>
        <div className="text-right">
          <div className="text-2xl font-bold">{fmtMoney(p.netWorth)}</div>
          <div className={`text-sm ${changeClass(totalReturn)}`}>{fmtPct(totalReturn)} all time</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-md border border-edge bg-panel px-3 py-2">
          <div className="text-[11px] uppercase text-ink-muted">Cash</div>
          <div className="text-sm font-medium">{fmtMoney(p.cash)}</div>
        </div>
        <div className="rounded-md border border-edge bg-panel px-3 py-2">
          <div className="text-[11px] uppercase text-ink-muted">Invested</div>
          <div className="text-sm font-medium">{fmtMoney(p.holdingsValue)}</div>
        </div>
        <div className="rounded-md border border-edge bg-panel px-3 py-2">
          <div className="text-[11px] uppercase text-ink-muted">Unrealized P/L</div>
          <div className={`text-sm font-medium ${changeClass(unrealized)}`}>{fmtMoney(unrealized)}</div>
        </div>
        <div className="rounded-md border border-edge bg-panel px-3 py-2">
          <div className="text-[11px] uppercase text-ink-muted">Realized P/L</div>
          <div className={`text-sm font-medium ${changeClass(p.realizedPnl)}`}>{fmtMoney(p.realizedPnl)}</div>
        </div>
        <div className="rounded-md border border-edge bg-panel px-3 py-2">
          <div className="text-[11px] uppercase text-ink-muted">Dividends</div>
          <div className="text-sm font-medium">{fmtMoney(p.totalDividends)}</div>
        </div>
      </div>

      {p.shortExposure > 0 && (
        <div
          className={`rounded-lg border p-4 text-sm ${
            p.marginUsage !== null && p.marginUsage < 0.2 ? "border-loss/60 bg-loss/10" : "border-edge bg-panel"
          }`}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">Margin (short positions)</span>
            {p.marginUsage !== null && p.marginUsage < 0.2 && (
              <span className="rounded bg-loss/20 px-2 py-0.5 text-xs font-semibold text-loss">⚠ NEAR MARGIN CALL</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-ink-muted sm:grid-cols-4">
            <div>Short exposure <div className="text-sm font-medium text-ink">{fmtMoney(p.shortExposure)}</div></div>
            <div>Account equity <div className="text-sm font-medium text-ink">{fmtMoney(p.equity)}</div></div>
            <div>Equity / exposure <div className="text-sm font-medium text-ink">{p.marginUsage !== null ? (p.marginUsage * 100).toFixed(1) + "%" : "—"}</div></div>
            <div>Maintenance floor <div className="text-sm font-medium text-ink">15%</div></div>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            If equity falls below 15% of short exposure, positions are force-covered at a penalty on the next market day.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-edge bg-panel p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">Net worth history</h2>
        <LineChart
          data={p.history.length ? p.history : [{ day: 0, value: p.startingCash }, { day: 1, value: p.netWorth }]}
          baseline={p.startingCash}
          valueFormat={(v) => fmtCompact(v)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
        <h3 className="border-b border-edge px-4 py-2 text-sm font-semibold">Holdings ({p.holdings.length})</h3>
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b border-edge text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-right">Shares</th>
              <th className="px-3 py-2 text-right">Avg cost</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Today</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2 text-right">Unrealized P/L</th>
            </tr>
          </thead>
          <tbody>
            {p.holdings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ink-muted">
                  No positions yet. <Link href="/market" className="text-accent">Browse the market</Link> to make your first trade.
                </td>
              </tr>
            )}
            {p.holdings.map((h) => (
              <tr key={h.symbol} className="border-b border-edge/40 last:border-0 hover:bg-panel-hover">
                <td className="px-3 py-1.5">
                  <Link href={`/company/${h.symbol}`} className="font-semibold text-accent">{h.symbol}</Link>
                  {h.shares < 0 && (
                    <span className="ml-1.5 rounded bg-loss/20 px-1.5 py-0.5 text-[10px] font-semibold text-loss">SHORT</span>
                  )}
                  <span className="ml-2 hidden text-xs text-ink-muted lg:inline">{h.name.slice(0, 24)}</span>
                </td>
                <td className="px-3 py-1.5 text-right">{h.shares.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right">{fmtMoney(h.avgCost)}</td>
                <td className="px-3 py-1.5 text-right">{fmtMoney(h.price)}</td>
                <td className={`px-3 py-1.5 text-right ${changeClass(h.dayChange)}`}>{fmtPct(h.dayChange)}</td>
                <td className="px-3 py-1.5 text-right">{fmtMoney(h.value)}</td>
                <td className={`px-3 py-1.5 text-right ${changeClass(h.unrealized)}`}>
                  {fmtMoney(h.unrealized)} ({fmtPct(h.unrealizedPct)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-edge bg-panel">
          <h3 className="border-b border-edge px-4 py-2 text-sm font-semibold">Open limit orders</h3>
          <ul className="divide-y divide-edge/50 text-sm">
            {p.openOrders.length === 0 && <li className="px-4 py-3 text-ink-muted">No open orders.</li>}
            {p.openOrders.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-2">
                <span className={`text-xs font-semibold uppercase ${o.side === "buy" ? "text-gain" : "text-loss"}`}>{o.side}</span>
                <Link href={`/company/${o.symbol}`} className="font-medium text-accent">{o.symbol}</Link>
                <span className="flex-1 text-ink-muted">
                  {o.shares.toLocaleString()} sh @ {o.limitPrice ? fmtMoney(o.limitPrice) : "mkt"} · placed D{o.placedDay}
                </span>
                <CancelOrderButton orderId={o.id} />
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-edge bg-panel">
          <h3 className="border-b border-edge px-4 py-2 text-sm font-semibold">Recent trades</h3>
          <ul className="divide-y divide-edge/50 text-sm">
            {p.recentTrades.length === 0 && <li className="px-4 py-3 text-ink-muted">No trades yet.</li>}
            {p.recentTrades.map((t, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2">
                <span className={`text-xs font-semibold uppercase ${t.side === "buy" || t.side === "cover" ? "text-gain" : "text-loss"}`}>{t.side}</span>
                <Link href={`/company/${t.symbol}`} className="font-medium text-accent">{t.symbol}</Link>
                <span className="flex-1 text-ink-muted">
                  {t.shares.toLocaleString()} @ {fmtMoney(t.price)} · D{t.day}
                </span>
                {t.realizedPnl !== null && (
                  <span className={`text-xs ${changeClass(t.realizedPnl)}`}>{fmtMoney(t.realizedPnl)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

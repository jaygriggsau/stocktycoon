import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompany } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth/server";
import { sql } from "@/db";
import { CandleChart } from "@/components/charts/CandleChart";
import { TradePanel } from "@/components/TradePanel";
import { fmtMoney, fmtPct, fmtCompact, changeClass } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-edge bg-panel px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

export default async function CompanyPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const c = await getCompany(decodeURIComponent(symbol).toUpperCase());
  if (!c) notFound();

  const user = await getSessionUser();
  let ownedShares = 0;
  let cash: number | null = null;
  if (user) {
    const rows = (await sql`
      SELECT h.shares, p.cash FROM players p
      LEFT JOIN holdings h ON h.user_id = p.user_id AND h.company_id = ${c.id}
      WHERE p.user_id = ${user.id}`) as { shares: number | null; cash: number }[];
    if (rows.length) {
      ownedShares = Number(rows[0].shares ?? 0);
      cash = Number(rows[0].cash);
    }
  }

  const change = c.prevClose > 0 ? c.price / c.prevClose - 1 : 0;
  const delisted = c.status !== "active";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {c.name} <span className="text-ink-muted">({c.symbol})</span>
          </h1>
          <p className="text-sm text-ink-muted">
            {c.sector} · listed day {c.listedDay}
            {delisted && <span className="ml-2 rounded bg-loss/20 px-2 py-0.5 text-loss">BANKRUPT — delisted day {c.delistedDay}</span>}
          </p>
        </div>
        {!delisted && (
          <div className="text-right">
            <div className="text-3xl font-bold">{fmtMoney(c.price)}</div>
            <div className={`text-sm ${changeClass(change)}`}>
              {fmtPct(change)} today
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <div className="rounded-lg border border-edge bg-panel p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-muted">Daily price — last {c.bars.length} days</h2>
            <CandleChart bars={c.bars} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Market cap" value={fmtCompact(c.marketCap)} />
            <Stat label="Revenue (TTM)" value={fmtCompact(c.revenue)} />
            <Stat label="Earnings (TTM)" value={fmtCompact(c.earnings)} />
            <Stat label="P/E" value={c.pe ? c.pe.toFixed(1) : "n/a"} />
            <Stat label="EPS" value={fmtMoney(c.eps)} />
            <Stat label="Profit margin" value={fmtPct(c.profitMargin)} />
            <Stat label="Growth rate" value={fmtPct(c.growthRate)} />
            <Stat label="Div yield" value={c.dividendYield > 0 ? (c.dividendYield * 100).toFixed(2) + "%" : "—"} />
            <Stat label="Beta" value={c.beta.toFixed(2)} />
            <Stat label="Volatility (daily)" value={fmtPct(c.volatility)} />
            <Stat label="Shares out" value={fmtCompact(c.sharesOutstanding).replace("$", "")} />
            <Stat label="Prev close" value={fmtMoney(c.prevClose)} />
          </div>

          <div className="rounded-lg border border-edge bg-panel p-4 text-sm text-ink-muted">
            {c.description}
          </div>

          <div className="rounded-lg border border-edge bg-panel">
            <h3 className="border-b border-edge px-4 py-2 text-sm font-semibold">Company news</h3>
            <ul className="divide-y divide-edge/50 text-sm">
              {c.news.length === 0 && <li className="px-4 py-3 text-ink-muted">No recent news.</li>}
              {c.news.map((n) => (
                <li key={n.id} className="flex items-baseline gap-2 px-4 py-2">
                  <span className="text-xs text-ink-muted">D{n.day}</span>
                  <span className="flex-1">{n.headline}</span>
                  {n.priceImpact !== null && (
                    <span className={`text-xs ${changeClass(n.priceImpact)}`}>{fmtPct(n.priceImpact)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          {delisted ? (
            <div className="rounded-lg border border-edge bg-panel p-4 text-sm text-ink-muted">
              This company went bankrupt. Shares were wiped out. The market moves on —{" "}
              <Link href="/market" className="text-accent">find the next winner</Link>.
            </div>
          ) : (
            <TradePanel symbol={c.symbol} price={c.price} signedIn={!!user} ownedShares={ownedShares} cash={cash} />
          )}
        </div>
      </div>
    </div>
  );
}

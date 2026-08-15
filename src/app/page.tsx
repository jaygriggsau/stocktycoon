import Link from "next/link";
import { getMarketOverview } from "@/lib/queries";
import { LineChart } from "@/components/charts/LineChart";
import { fmtMoney, fmtPct, fmtCompact, changeClass } from "@/lib/format";

export const dynamic = "force-dynamic";

function MoverTable({ title, rows }: { title: string; rows: { symbol: string; name: string; price: number; change: number }[] }) {
  return (
    <div className="rounded-lg border border-edge bg-panel">
      <h3 className="border-b border-edge px-4 py-2 text-sm font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-b border-edge/50 last:border-0 hover:bg-panel-hover">
              <td className="px-4 py-1.5">
                <Link href={`/company/${r.symbol}`} className="font-medium text-accent">{r.symbol}</Link>
                <span className="ml-2 hidden text-xs text-ink-muted md:inline">{r.name.slice(0, 28)}</span>
              </td>
              <td className="px-2 py-1.5 text-right">{fmtMoney(r.price)}</td>
              <td className={`px-4 py-1.5 text-right ${changeClass(r.change)}`}>{fmtPct(r.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Home() {
  const m = await getMarketOverview();

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">The StockTycoon Exchange</h1>
          <p className="text-sm text-ink-muted">
            Day {m.day} · {m.activeCount.toLocaleString()} listed companies · regime:{" "}
            <span className={m.regimeLabel === "bull" ? "text-gain" : m.regimeLabel === "bear" ? "text-loss" : ""}>
              {m.regimeLabel}
            </span>
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-muted">TYCOON Composite</div>
          <div className="text-xl font-semibold">
            {m.composite.length ? m.composite[m.composite.length - 1].value.toFixed(2) : "—"}{" "}
            <span className={`text-sm ${changeClass(m.compositeChange)}`}>{fmtPct(m.compositeChange)}</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">TYCOON Composite — last {m.composite.length} days</h2>
        <LineChart data={m.composite} valueFormat={(v) => v.toFixed(1)} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MoverTable title="Top gainers" rows={m.gainers} />
        <MoverTable title="Top losers" rows={m.losers} />
        <MoverTable title="Most active" rows={m.mostActive} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-edge bg-panel">
          <h3 className="border-b border-edge px-4 py-2 text-sm font-semibold">Sector performance (today)</h3>
          <div className="p-4">
            {m.sectors.map((s) => {
              const w = Math.min(100, Math.abs(s.change) * 2500);
              return (
                <div key={s.id} className="mb-1.5 flex items-center gap-2 text-xs">
                  <span className="w-40 shrink-0 text-ink-muted">{s.name}</span>
                  <div className="flex h-3 flex-1 items-center">
                    <div className="flex w-1/2 justify-end">
                      {s.change < 0 && <div className="h-2 rounded-l bg-loss" style={{ width: `${w}%` }} />}
                    </div>
                    <div className="h-3 w-px bg-edge" />
                    <div className="w-1/2">
                      {s.change >= 0 && <div className="h-2 rounded-r bg-gain" style={{ width: `${w}%` }} />}
                    </div>
                  </div>
                  <span className={`w-16 text-right ${changeClass(s.change)}`}>{fmtPct(s.change)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-edge bg-panel">
          <div className="flex items-center justify-between border-b border-edge px-4 py-2">
            <h3 className="text-sm font-semibold">Latest news</h3>
            <Link href="/news" className="text-xs text-accent">All news →</Link>
          </div>
          <ul className="divide-y divide-edge/50 text-sm">
            {m.recentNews.map((n) => (
              <li key={n.id} className="px-4 py-2">
                <span className="mr-2 text-xs uppercase text-ink-muted">D{n.day}</span>
                {n.symbol && (
                  <Link href={`/company/${n.symbol}`} className="mr-1 font-medium text-accent">{n.symbol}</Link>
                )}
                {n.headline}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-lg border border-edge bg-panel p-6 text-center">
        <h2 className="text-lg font-semibold">Start with {fmtMoney(100000, 0)}. Build an empire.</h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-ink-muted">
          {m.activeCount.toLocaleString()} companies live and die in a persistent simulated economy — earnings seasons,
          sector rotations, dividends, bankruptcies and IPOs. Total market value{" "}
          {fmtCompact(m.composite.length ? m.composite[m.composite.length - 1].value * 1e9 : 0)}.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link href="/market" className="rounded-md border border-edge px-4 py-2 text-sm hover:bg-panel-hover">Browse the market</Link>
          <Link href="/auth/sign-up" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface">Play free</Link>
        </div>
      </section>
    </div>
  );
}

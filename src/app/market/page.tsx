import Link from "next/link";
import { screener, getSectors } from "@/lib/queries";
import { fmtMoney, fmtPct, fmtCompact, changeClass } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Search {
  q?: string;
  sector?: string;
  sort?: string;
  dir?: string;
  page?: string;
  status?: string;
}

export default async function MarketPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const page = parseInt(sp.page ?? "1", 10) || 1;
  const [result, sectors] = await Promise.all([
    screener({
      q: sp.q,
      sector: sp.sector ? parseInt(sp.sector, 10) : undefined,
      sort: sp.sort,
      dir: sp.dir === "asc" ? "asc" : "desc",
      page,
      status: sp.status,
    }),
    getSectors(),
  ]);

  const qs = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/market?${params.toString()}`;
  };

  const sortHeader = (key: string, label: string, alignRight = true) => {
    const active = (sp.sort ?? "marketCap") === key;
    const nextDir = active && sp.dir !== "asc" ? "asc" : "desc";
    return (
      <th className={`px-3 py-2 text-xs font-medium text-ink-muted ${alignRight ? "text-right" : "text-left"}`}>
        <Link href={qs({ sort: key, dir: nextDir, page: "1" })} className={active ? "text-ink" : "hover:text-ink"}>
          {label} {active ? (sp.dir === "asc" ? "▲" : "▼") : ""}
        </Link>
      </th>
    );
  };

  const totalPages = Math.max(1, Math.ceil(result.total / result.perPage));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Market Screener</h1>
        <p className="text-sm text-ink-muted">{result.total.toLocaleString()} companies</p>
      </div>

      <form method="GET" action="/market" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search name or ticker..."
          className="w-56 rounded-md border border-edge bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          name="sector"
          defaultValue={sp.sector ?? ""}
          className="rounded-md border border-edge bg-panel px-2 py-1.5 text-sm"
        >
          <option value="">All sectors</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? "active"} className="rounded-md border border-edge bg-panel px-2 py-1.5 text-sm">
          <option value="active">Listed</option>
          <option value="bankrupt">Bankrupt (graveyard)</option>
        </select>
        <button className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-surface">Filter</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-edge">
            <tr>
              {sortHeader("symbol", "Ticker", false)}
              {sortHeader("name", "Company", false)}
              <th className="px-3 py-2 text-left text-xs font-medium text-ink-muted">Sector</th>
              {sortHeader("price", "Price")}
              {sortHeader("change", "Today")}
              {sortHeader("marketCap", "Mkt Cap")}
              {sortHeader("pe", "P/E")}
              {sortHeader("dividend", "Div Yield")}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.symbol} className="border-b border-edge/40 last:border-0 hover:bg-panel-hover">
                <td className="px-3 py-1.5">
                  <Link href={`/company/${r.symbol}`} className="font-semibold text-accent">{r.symbol}</Link>
                </td>
                <td className="max-w-[220px] truncate px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5 text-xs text-ink-muted">{r.sector}</td>
                <td className="px-3 py-1.5 text-right">{r.status === "active" ? fmtMoney(r.price) : "—"}</td>
                <td className={`px-3 py-1.5 text-right ${changeClass(r.change)}`}>
                  {r.status === "active" ? fmtPct(r.change) : "delisted"}
                </td>
                <td className="px-3 py-1.5 text-right">{fmtCompact(r.marketCap)}</td>
                <td className="px-3 py-1.5 text-right">{r.pe ? r.pe.toFixed(1) : "—"}</td>
                <td className="px-3 py-1.5 text-right">{r.dividendYield > 0 ? (r.dividendYield * 100).toFixed(2) + "%" : "—"}</td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-muted">No companies match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-muted">Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          {page > 1 && <Link href={qs({ page: String(page - 1) })} className="rounded-md border border-edge px-3 py-1 hover:bg-panel-hover">← Prev</Link>}
          {page < totalPages && <Link href={qs({ page: String(page + 1) })} className="rounded-md border border-edge px-3 py-1 hover:bg-panel-hover">Next →</Link>}
        </div>
      </div>
    </div>
  );
}

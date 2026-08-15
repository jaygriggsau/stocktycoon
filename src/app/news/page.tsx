import Link from "next/link";
import { getNews } from "@/lib/queries";
import { fmtPct, changeClass } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  earnings: "Earnings",
  ipo: "IPO",
  bankruptcy: "Bankruptcy",
  sector: "Sector",
  macro: "Macro",
  company: "Company",
  merger: "M&A",
  split: "Split",
  rating: "Analysts",
};

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = parseInt(sp.page ?? "1", 10) || 1;
  const news = await getNews(page);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Market News</h1>
      <ul className="divide-y divide-edge/50 rounded-lg border border-edge bg-panel text-sm">
        {news.length === 0 && <li className="px-4 py-8 text-center text-ink-muted">No news yet.</li>}
        {news.map((n) => (
          <li key={n.id} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="w-12 shrink-0 text-xs text-ink-muted">Day {n.day}</span>
            <span className="w-20 shrink-0 rounded bg-panel-hover px-1.5 py-0.5 text-center text-[10px] uppercase tracking-wide text-ink-muted">
              {KIND_LABELS[n.kind] ?? n.kind}
            </span>
            <span className="flex-1">
              {n.symbol && <Link href={`/company/${n.symbol}`} className="mr-1.5 font-semibold text-accent">{n.symbol}</Link>}
              {n.headline}
            </span>
            {n.priceImpact !== null && (
              <span className={`shrink-0 text-xs ${changeClass(n.priceImpact)}`}>{fmtPct(n.priceImpact)}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex justify-between text-sm">
        {page > 1 ? (
          <Link href={`/news?page=${page - 1}`} className="rounded-md border border-edge px-3 py-1 hover:bg-panel-hover">← Newer</Link>
        ) : <span />}
        {news.length === 40 && (
          <Link href={`/news?page=${page + 1}`} className="rounded-md border border-edge px-3 py-1 hover:bg-panel-hover">Older →</Link>
        )}
      </div>
    </div>
  );
}

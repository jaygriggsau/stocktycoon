import { getLeaderboard } from "@/lib/queries";
import { fmtMoney, fmtPct, changeClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const rows = await getLeaderboard();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Leaderboard</h1>
      <p className="text-sm text-ink-muted">Top 100 tycoons by net worth. Everyone starts with $100,000.</p>
      <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="border-b border-edge text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Trader</th>
              <th className="px-3 py-2 text-right">Net worth</th>
              <th className="px-3 py-2 text-right">Total return</th>
              <th className="px-3 py-2 text-right">Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-muted">No traders yet — be the first.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-edge/40 last:border-0 hover:bg-panel-hover">
                <td className="px-3 py-1.5 font-semibold text-ink-muted">{r.rank}</td>
                <td className="px-3 py-1.5 font-medium">{r.displayName}</td>
                <td className="px-3 py-1.5 text-right">{fmtMoney(r.netWorth)}</td>
                <td className={`px-3 py-1.5 text-right ${changeClass(r.returnPct)}`}>{fmtPct(r.returnPct)}</td>
                <td className="px-3 py-1.5 text-right text-xs text-ink-muted">Day {r.createdDay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

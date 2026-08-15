"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtMoney } from "@/lib/format";

interface Props {
  symbol: string;
  price: number;
  signedIn: boolean;
  ownedShares: number;
  cash: number | null;
}

export function TradePanel({ symbol, price, signedIn, ownedShares, cash }: Props) {
  const router = useRouter();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [shares, setShares] = useState("");
  const [limitPrice, setLimitPrice] = useState(price.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!signedIn) {
    return (
      <div className="rounded-lg border border-edge bg-panel p-4 text-sm">
        <p className="mb-3 text-ink-muted">Sign in to trade this stock with $100,000 in starting cash.</p>
        <a href="/auth/sign-up" className="block rounded-md bg-accent px-3 py-2 text-center font-medium text-surface">
          Create free account
        </a>
      </div>
    );
  }

  const qty = parseInt(shares, 10) || 0;
  const estPrice = type === "limit" ? parseFloat(limitPrice) || price : price;
  const estCost = qty * estPrice;

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          type,
          shares: qty,
          limitPrice: type === "limit" ? parseFloat(limitPrice) : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg({
          ok: true,
          text:
            type === "market"
              ? `${side === "buy" ? "Bought" : "Sold"} ${qty.toLocaleString()} ${symbol} @ ${fmtMoney(data.fillPrice)}`
              : `Limit order placed: ${side} ${qty.toLocaleString()} @ ${fmtMoney(parseFloat(limitPrice))}`,
        });
        setShares("");
        router.refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? "Trade failed" });
      }
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  const tab = (active: boolean) =>
    `flex-1 rounded-md py-1.5 text-sm font-medium transition ${
      active ? "bg-panel-hover text-ink" : "text-ink-muted hover:text-ink"
    }`;

  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="mb-3 flex gap-1 rounded-md border border-edge p-1">
        <button className={tab(side === "buy")} onClick={() => setSide("buy")}>Buy</button>
        <button className={tab(side === "sell")} onClick={() => setSide("sell")}>Sell</button>
      </div>
      <div className="mb-3 flex gap-1 rounded-md border border-edge p-1">
        <button className={tab(type === "market")} onClick={() => setType("market")}>Market</button>
        <button className={tab(type === "limit")} onClick={() => setType("limit")}>Limit</button>
      </div>

      <label className="mb-1 block text-xs text-ink-muted">Shares</label>
      <input
        type="number"
        min={1}
        step={1}
        value={shares}
        onChange={(e) => setShares(e.target.value)}
        placeholder="0"
        className="mb-3 w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />

      {type === "limit" && (
        <>
          <label className="mb-1 block text-xs text-ink-muted">Limit price</label>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            className="mb-3 w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </>
      )}

      <div className="mb-3 space-y-1 text-xs text-ink-muted">
        <div className="flex justify-between"><span>Est. {side === "buy" ? "cost" : "proceeds"}</span><span className="text-ink">{fmtMoney(estCost)}</span></div>
        {cash !== null && <div className="flex justify-between"><span>Cash available</span><span>{fmtMoney(cash)}</span></div>}
        <div className="flex justify-between"><span>You own</span><span>{ownedShares.toLocaleString()} sh</span></div>
        {type === "market" && <div>Market orders fill instantly with a small spread & size impact.</div>}
        {type === "limit" && <div>Limit orders fill when the daily price crosses your limit.</div>}
      </div>

      <button
        disabled={busy || qty <= 0}
        onClick={submit}
        className={`w-full rounded-md py-2 text-sm font-semibold text-surface transition disabled:opacity-40 ${
          side === "buy" ? "bg-gain hover:opacity-90" : "bg-loss hover:opacity-90"
        }`}
      >
        {busy ? "Working..." : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
      </button>

      {msg && (
        <p className={`mt-3 text-xs ${msg.ok ? "text-gain" : "text-loss"}`} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}

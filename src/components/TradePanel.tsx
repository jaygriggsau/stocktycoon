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

type Side = "buy" | "sell" | "short" | "cover";

export function TradePanel({ symbol, price, signedIn, ownedShares, cash }: Props) {
  const router = useRouter();
  const [side, setSide] = useState<Side>("buy");
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
  const limitAllowed = side === "buy" || side === "sell";
  const effType = limitAllowed ? type : "market";
  const estPrice = effType === "limit" ? parseFloat(limitPrice) || price : price;
  const estCost = qty * estPrice;
  const isShort = ownedShares < 0;
  const receivesCash = side === "sell" || side === "short";

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
          type: effType,
          shares: qty,
          limitPrice: effType === "limit" ? parseFloat(limitPrice) : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const verb = { buy: "Bought", sell: "Sold", short: "Shorted", cover: "Covered" }[side];
        setMsg({
          ok: true,
          text:
            effType === "market"
              ? `${verb} ${qty.toLocaleString()} ${symbol} @ ${fmtMoney(data.fillPrice)}`
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
      <div className="mb-3 grid grid-cols-4 gap-1 rounded-md border border-edge p-1">
        <button className={tab(side === "buy")} onClick={() => setSide("buy")}>Buy</button>
        <button className={tab(side === "sell")} onClick={() => setSide("sell")}>Sell</button>
        <button className={tab(side === "short")} onClick={() => setSide("short")}>Short</button>
        <button className={tab(side === "cover")} onClick={() => setSide("cover")}>Cover</button>
      </div>
      {limitAllowed && (
        <div className="mb-3 flex gap-1 rounded-md border border-edge p-1">
          <button className={tab(type === "market")} onClick={() => setType("market")}>Market</button>
          <button className={tab(type === "limit")} onClick={() => setType("limit")}>Limit</button>
        </div>
      )}

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

      {effType === "limit" && (
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
        <div className="flex justify-between"><span>Est. {receivesCash ? "proceeds" : "cost"}</span><span className="text-ink">{fmtMoney(estCost)}</span></div>
        {cash !== null && <div className="flex justify-between"><span>Cash available</span><span>{fmtMoney(cash)}</span></div>}
        <div className="flex justify-between">
          <span>Position</span>
          <span className={isShort ? "text-loss" : undefined}>
            {isShort ? `${Math.abs(ownedShares).toLocaleString()} sh short` : `${ownedShares.toLocaleString()} sh`}
          </span>
        </div>
        {effType === "market" && side !== "short" && <div>Market orders fill instantly with a small spread & size impact.</div>}
        {effType === "limit" && <div>Limit orders fill when the daily price crosses your limit.</div>}
        {side === "short" && (
          <div>Shorting borrows shares to sell. Requires 30% equity margin; positions are force-covered below 15%. Shorts pay dividends and must cover at the deal price in buyouts.</div>
        )}
      </div>

      <button
        disabled={busy || qty <= 0}
        onClick={submit}
        className={`w-full rounded-md py-2 text-sm font-semibold text-surface transition disabled:opacity-40 ${
          side === "buy" || side === "cover" ? "bg-gain hover:opacity-90" : "bg-loss hover:opacity-90"
        }`}
      >
        {busy ? "Working..." : `${{ buy: "Buy", sell: "Sell", short: "Short", cover: "Cover" }[side]} ${symbol}`}
      </button>

      {msg && (
        <p className={`mt-3 text-xs ${msg.ok ? "text-gain" : "text-loss"}`} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}

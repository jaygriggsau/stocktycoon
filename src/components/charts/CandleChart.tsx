"use client";

import { useMemo, useRef, useState } from "react";
import { fmtMoney, fmtCompact } from "@/lib/format";

export interface Bar {
  day: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Daily OHLC candlestick chart with a volume strip and crosshair tooltip.
 * Up days use the gain color, down days the loss color; each candle also
 * carries direction in its shape (open/close body vs. wicks).
 */
export function CandleChart({ bars, height = 320 }: { bars: Bar[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 800;
  const H = height;
  const VOL_H = 48;
  const PAD = { l: 8, r: 56, t: 10, b: 18 };

  const model = useMemo(() => {
    if (bars.length < 2) return null;
    const min = Math.min(...bars.map((b) => b.low));
    const max = Math.max(...bars.map((b) => b.high));
    const span = max - min || 1;
    const plotH = H - PAD.t - PAD.b - VOL_H;
    const x = (i: number) => PAD.l + ((i + 0.5) / bars.length) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - min - span * 0) / span) * plotH;
    const maxVol = Math.max(...bars.map((b) => b.volume));
    const vy = (v: number) => H - PAD.b - (v / maxVol) * (VOL_H - 6);
    const bw = Math.max(1.5, ((W - PAD.l - PAD.r) / bars.length) * 0.62);
    const ticks = Array.from({ length: 4 }, (_, i) => min + ((i + 0.5) / 4) * span);
    return { x, y, vy, bw, ticks, plotBottom: PAD.t + plotH };
  }, [bars, H]);

  if (!model) {
    return <div className="flex h-40 items-center justify-center text-sm text-ink-muted">Not enough data yet</div>;
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.floor(((px - PAD.l) / (W - PAD.l - PAD.r)) * bars.length);
    setHover(Math.max(0, Math.min(bars.length - 1, idx)));
  }

  const hb = hover !== null ? bars[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="price candlestick chart"
      >
        {model.ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={model.y(t)} y2={model.y(t)} stroke="var(--color-edge)" strokeWidth={1} />
            <text x={W - PAD.r + 6} y={model.y(t) + 4} fontSize={11} fill="var(--color-ink-muted)">
              {t >= 1000 ? fmtCompact(t) : fmtMoney(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const up = b.close >= b.open;
          const c = up ? "var(--color-gain)" : "var(--color-loss)";
          const cx = model.x(i);
          const top = model.y(Math.max(b.open, b.close));
          const bot = model.y(Math.min(b.open, b.close));
          return (
            <g key={b.day}>
              <line x1={cx} x2={cx} y1={model.y(b.high)} y2={model.y(b.low)} stroke={c} strokeWidth={1} />
              <rect
                x={cx - model.bw / 2}
                y={top}
                width={model.bw}
                height={Math.max(1, bot - top)}
                fill={c}
                opacity={up ? 1 : 0.85}
              />
              <rect
                x={cx - model.bw / 2}
                y={model.vy(b.volume)}
                width={model.bw}
                height={H - PAD.b - model.vy(b.volume)}
                fill={c}
                opacity={0.3}
              />
            </g>
          );
        })}
        {hover !== null && (
          <line
            x1={model.x(hover)}
            x2={model.x(hover)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="var(--color-ink-muted)"
            strokeWidth={1}
          />
        )}
      </svg>
      {hb && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-edge bg-panel px-2 py-1 text-xs shadow-lg"
          style={{ left: `${Math.min(80, (model.x(hover!) / W) * 100)}%` }}
        >
          <div className="text-ink-muted">Day {hb.day}</div>
          <div>O {fmtMoney(hb.open)} · H {fmtMoney(hb.high)}</div>
          <div>L {fmtMoney(hb.low)} · C {fmtMoney(hb.close)}</div>
          <div className="text-ink-muted">Vol {hb.volume.toLocaleString()}</div>
        </div>
      )}
    </div>
  );
}

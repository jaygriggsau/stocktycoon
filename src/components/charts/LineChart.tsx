"use client";

import { useMemo, useRef, useState } from "react";
import { fmtCompact, fmtMoney } from "@/lib/format";

interface Point {
  day: number;
  value: number;
}

/**
 * Axis/tooltip number format. This is a string key rather than a function
 * because a Server Component cannot pass functions across the client boundary.
 */
export type ValueFormat = "index" | "compact" | "money";

interface Props {
  data: Point[];
  height?: number;
  color?: string; // defaults to accent; pass gain/loss for signed series
  valueFormat?: ValueFormat;
  baseline?: number; // optional reference line (e.g. starting cash)
}

const FORMATTERS: Record<ValueFormat, (v: number) => string> = {
  index: (v) => v.toFixed(1),
  compact: (v) => fmtCompact(v),
  money: (v) => fmtMoney(v),
};

/**
 * Single-series SVG line chart with area fill, recessive grid,
 * and a crosshair + tooltip hover layer.
 */
export function LineChart({ data, height = 220, color, valueFormat, baseline }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 800;
  const H = height;
  const PAD = { l: 8, r: 56, t: 10, b: 20 };

  const fmt = FORMATTERS[valueFormat ?? "index"];

  const model = useMemo(() => {
    if (data.length < 2) return null;
    const vals = data.map((d) => d.value);
    let min = Math.min(...vals, baseline ?? Infinity);
    let max = Math.max(...vals, baseline ?? -Infinity);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
    const x = (i: number) => PAD.l + (i / (data.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
    const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
    const area = `${path}L${x(data.length - 1).toFixed(1)},${H - PAD.b}L${PAD.l},${H - PAD.b}Z`;
    // ~4 horizontal gridlines
    const ticks = Array.from({ length: 4 }, (_, i) => min + ((i + 0.5) / 4) * (max - min));
    return { x, y, path, area, ticks, min, max };
  }, [data, H, baseline]);

  if (!model) {
    return <div className="flex h-40 items-center justify-center text-sm text-ink-muted">Not enough data yet</div>;
  }

  const up = data[data.length - 1].value >= data[0].value;
  const stroke = color ?? (up ? "var(--color-gain)" : "var(--color-loss)");
  const hi = hover !== null ? Math.max(0, Math.min(data.length - 1, hover)) : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (data.length - 1));
    setHover(idx);
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="line chart"
      >
        {model.ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={model.y(t)} y2={model.y(t)} stroke="var(--color-edge)" strokeWidth={1} />
            <text x={W - PAD.r + 6} y={model.y(t) + 4} fontSize={11} fill="var(--color-ink-muted)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {baseline !== undefined && (
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={model.y(baseline)}
            y2={model.y(baseline)}
            stroke="var(--color-ink-muted)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        <path d={model.area} fill={stroke} opacity={0.12} />
        <path d={model.path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
        {hi !== null && (
          <g>
            <line x1={model.x(hi)} x2={model.x(hi)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-muted)" strokeWidth={1} />
            <circle cx={model.x(hi)} cy={model.y(data[hi].value)} r={4} fill={stroke} stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hi !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-edge bg-panel px-2 py-1 text-xs shadow-lg"
          style={{ left: `${Math.min(85, (model.x(hi) / W) * 100)}%` }}
        >
          <div className="text-ink-muted">Day {data[hi].day}</div>
          <div className="font-medium">{fmt(data[hi].value)}</div>
        </div>
      )}
    </div>
  );
}

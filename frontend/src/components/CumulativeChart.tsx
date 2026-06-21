import { useMemo } from "react";
import type { MinuteRow } from "../types";
import { fmt } from "../format";

// Cumulative output tokens (area) + per-minute tool time (bars) over session
// minutes. Pure SVG, dual vertical scales.
export function CumulativeChart({ minutes, width }: { minutes: MinuteRow[]; width: number }) {
  const H = 200, padL = 56, padR = 52, padT = 12, padB = 24;
  const view = useMemo(() => {
    if (!minutes.length) return null;
    const xs = minutes.map((m) => m.minute);
    const minX = Math.min(...xs), maxX = Math.max(...xs) || 1;
    let acc = 0;
    const cum = minutes.map((m) => (acc += m.out_tokens || 0));
    const maxCum = Math.max(1, ...cum);
    const maxMs = Math.max(1, ...minutes.map((m) => m.tool_ms || 0));
    const cw = Math.max(50, width - padL - padR);
    const ch = H - padT - padB;
    const x = (mi: number) => padL + ((mi - minX) / (maxX - minX || 1)) * cw;
    const yTok = (v: number) => padT + ch - (v / maxCum) * ch;
    const yMs = (v: number) => padT + ch - (v / maxMs) * ch;
    const barW = Math.max(1, cw / Math.max(minutes.length, 1) - 1);
    const area = `M ${x(minX)},${padT + ch} ` +
      minutes.map((m, i) => `L ${x(m.minute)},${yTok(cum[i])}`).join(" ") +
      ` L ${x(maxX)},${padT + ch} Z`;
    const line = minutes.map((m, i) => `${i ? "L" : "M"} ${x(m.minute)},${yTok(cum[i])}`).join(" ");
    return { minX, maxX, cum, maxCum, maxMs, ch, x, yTok, yMs, barW, area, line };
  }, [minutes, width]);

  if (!view) return <p className="muted">No timeline data.</p>;
  const { maxCum, maxMs, ch, x, yMs, barW, area, line } = view;
  const yTicks = [0, 0.5, 1];

  return (
    <svg width={width} height={H} className="cum-chart">
      {yTicks.map((f, i) => {
        const y = padT + ch - f * ch;
        return (
          <g key={i}>
            <line className="wf-grid" x1={padL} y1={y} x2={width - padR} y2={y} />
            <text className="wf-axis" x={4} y={y + 3} fill="#d97757">{fmt(maxCum * f)}</text>
            <text className="wf-axis" x={width - padR + 4} y={y + 3} fill="#3fb950">{fmt(maxMs * f)}</text>
          </g>
        );
      })}
      {minutes.map((m, i) => m.tool_ms > 0 && (
        <rect key={i} x={x(m.minute) - barW / 2} y={yMs(m.tool_ms)} width={barW}
          height={padT + ch - yMs(m.tool_ms)} fill="#3fb950" opacity={0.55} />
      ))}
      <path d={area} fill="rgba(217,119,87,.14)" />
      <path d={line} fill="none" stroke="#d97757" strokeWidth={1.6} />
      <text className="wf-axis" x={padL} y={H - 6}>min {view.minX}</text>
      <text className="wf-axis" x={width - padR - 30} y={H - 6}>min {view.maxX}</text>
    </svg>
  );
}

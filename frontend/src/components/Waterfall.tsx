import { useMemo, useRef, useState } from "react";
import type { EventRow } from "../types";
import { catColor, fmt, fmtDur, fmtMs } from "../format";

export type WfMode = "seq" | "real";
export type WfScale = "log" | "lin";

interface Props {
  events: EventRow[];
  mode: WfMode;
  scale: WfScale;
  kindFilter: "all" | "tool" | "assistant";
  errorsOnly?: boolean;
  width: number;
}

interface Tip { x: number; y: number; ev: EventRow; }

const ROW_H = 18;
const PAD_L = 240;
const PAD_R = 40;
const PAD_T = 26;
const CAP = 1000;

export function Waterfall({ events, mode, scale, kindFilter, errorsOnly, width }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const evs = useMemo(() => {
    let f = kindFilter === "all" ? events : events.filter((e) => e.kind === kindFilter);
    if (errorsOnly) f = f.filter((e) => e.is_error);
    return f.slice(0, CAP);
  }, [events, kindFilter, errorsOnly]);

  const layout = useMemo(() => {
    const chartW = Math.max(200, width - PAD_L - PAD_R);
    const dur = (e: EventRow) => Math.max(0, e.duration_ms ?? 0);
    let starts: number[];
    let maxX: number;
    if (mode === "seq") {
      let acc = 0;
      starts = evs.map((e) => { const s = acc; acc += dur(e); return s; });
      maxX = acc || 1;
    } else {
      starts = evs.map((e) => (e.offset_sec || 0) * 1000);
      maxX = Math.max(1, ...evs.map((e, i) => starts[i] + dur(e)));
    }
    const log = scale === "log";
    const tx = (t: number) =>
      log ? (Math.log10(1 + t) / Math.log10(1 + maxX)) * chartW : (t / maxX) * chartW;
    return { chartW, dur, starts, maxX, tx };
  }, [evs, mode, scale, width]);

  if (!evs.length) return <p className="muted">No events for this filter.</p>;

  const { dur, starts, maxX, tx } = layout;
  const height = PAD_T + evs.length * ROW_H + 10;
  const ticks = scale === "log"
    ? [0, maxX * 0.001, maxX * 0.01, maxX * 0.1, maxX]
    : [0, maxX * 0.25, maxX * 0.5, maxX * 0.75, maxX];

  return (
    <div className="wf-wrap">
      <svg ref={ref} width={width} height={height} className="wf-svg"
        onMouseLeave={() => setTip(null)}>
        {ticks.map((t, i) => {
          const x = PAD_L + tx(t);
          return (
            <g key={i}>
              <line className="wf-grid" x1={x} y1={PAD_T - 4} x2={x} y2={height - 6} />
              <text className="wf-axis" x={x + 2} y={PAD_T - 8}>{fmtMs(t)}</text>
            </g>
          );
        })}
        {evs.map((e, i) => {
          const y = PAD_T + i * ROW_H;
          const isPrompt = e.kind === "prompt";
          const bx = PAD_L + tx(starts[i]);
          const bw = isPrompt ? 4 : Math.max(2, tx(starts[i] + dur(e)) - tx(starts[i]));
          const h = isPrompt ? 4 : ROW_H - 8;
          const sub = e.kind === "assistant" && e.output_tokens ? `+${fmt(e.output_tokens)} tok` : "";
          return (
            <g key={e.seq}
              onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY, ev: e })}
              onMouseEnter={(ev) => setTip({ x: ev.clientX, y: ev.clientY, ev: e })}>
              <rect x={0} y={y} width={width} height={ROW_H} fill="transparent" />
              <rect x={6} y={y + 5} width={8} height={8} fill={catColor(e.category)} />
              <text className="wf-label" x={20} y={y + 13}>
                {e.seq}. {(e.label || e.kind).slice(0, 34)}
              </text>
              <rect x={bx} y={y + (ROW_H - h) / 2} width={bw} height={h} rx={2}
                fill={catColor(e.category)}
                stroke={e.is_error ? "#f85149" : "none"} strokeWidth={e.is_error ? 1.5 : 0} />
              {sub && <text className="wf-sub" x={bx + bw + 4} y={y + 13}>{sub}</text>}
            </g>
          );
        })}
      </svg>

      {tip && (
        <div className="wf-tip" style={{
          left: Math.min(tip.x + 14, window.innerWidth - 360),
          top: tip.y + 14,
        }}>
          <b>#{tip.ev.seq} {tip.ev.kind} · {tip.ev.category}</b><br />
          {tip.ev.label}<br />
          {tip.ev.duration_ms != null && <>duration: {fmtMs(tip.ev.duration_ms)}<br /></>}
          {tip.ev.output_tokens > 0 && <>output: {fmt(tip.ev.output_tokens)} tok<br /></>}
          {tip.ev.total_tokens > 0 && <>turn total: {fmt(tip.ev.total_tokens)} tok<br /></>}
          at +{fmtDur(tip.ev.offset_sec)} from start
          {tip.ev.is_error && <><br /><span style={{ color: "#f85149" }}>ERROR</span></>}
        </div>
      )}
    </div>
  );
}

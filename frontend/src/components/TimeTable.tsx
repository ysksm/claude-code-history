import { fmt, fmtMs, catColor } from "../format";
import type { TimeRow } from "../types";

// Time-share breakdown as a readable list: a full-width bar per row with the
// label (truncated, full text on hover), total time + %, and a meta line.
// grandTotal is the denominator for %.
export function TimeTable({ rows, grandTotal, dimLabel }: {
  rows: TimeRow[]; grandTotal: number; dimLabel: string;
}) {
  const total = grandTotal || 1;
  if (!rows.length) return <p className="muted">no data</p>;
  return (
    <div className="tb-list">
      {rows.map((r) => {
        const pct = (r.total_ms / total) * 100;
        const color = dimLabel === "category" ? catColor(r.key) : "var(--accent)";
        return (
          <div className="tb-row" key={r.key}>
            <div className="tb-head">
              <span className="tb-label" title={r.key}>{r.key || <span className="muted">(empty)</span>}</span>
              <span className="tb-time"><b>{fmtMs(r.total_ms)}</b> <span className="muted">{pct.toFixed(1)}%</span></span>
            </div>
            <div className="tb-track"><span className="tb-fill" style={{ width: `${Math.max(1, pct)}%`, background: color }} /></div>
            <div className="tb-meta muted">
              {fmt(r.calls)} 回 · 1回あたり中央値 {fmtMs(r.p50_ms)}
              {r.errors ? <> · <span className="del">{r.errors} エラー</span></> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { fmt, fmtMs } from "../format";
import type { TimeRow } from "../types";

// Renders a time-share breakdown table. grandTotal is the denominator for %.
export function TimeTable({ rows, grandTotal, dimLabel }: {
  rows: TimeRow[]; grandTotal: number; dimLabel: string;
}) {
  const total = grandTotal || 1;
  return (
    <table>
      <thead>
        <tr><th>{dimLabel}</th><th>share</th><th>total time</th><th>%</th><th>calls</th><th>p50</th><th>err</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const pct = (r.total_ms / total) * 100;
          return (
            <tr key={r.key}>
              <td className="title">{r.key || <span className="muted">(empty)</span>}</td>
              <td className="bar-cell"><span className="time-bar" style={{ width: `${Math.max(2, pct)}%` }} /></td>
              <td>{fmtMs(r.total_ms)}</td>
              <td>{pct.toFixed(1)}%</td>
              <td>{fmt(r.calls)}</td>
              <td>{fmtMs(r.p50_ms)}</td>
              <td>{r.errors ? <span className="del">{r.errors}</span> : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

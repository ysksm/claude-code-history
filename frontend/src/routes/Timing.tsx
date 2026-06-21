import { useState } from "react";
import { api } from "../api";
import { fmt, fmtMs } from "../format";
import { useAsync } from "../useAsync";
import { usePeriodFilter } from "../period";

type Dim = "category" | "tool" | "command";

export function Timing() {
  const { from, to, control } = usePeriodFilter();
  const [dim, setDim] = useState<Dim>("command");
  const range = { from, to };

  // category breakdown is always fetched: its sum is the grand total tool time.
  const cat = useAsync(() => api.timeBreakdown("category", range), [from, to]);
  const rows = useAsync(() => api.timeBreakdown(dim, range), [dim, from, to]);
  const daily = useAsync(() => api.timeDaily(range), [from, to]);

  const grandTotal = (cat.data ?? []).reduce((s, r) => s + r.total_ms, 0) || 1;
  const maxDay = Math.max(1, ...(daily.data ?? []).map((d) => d.tool_ms));

  const Btn = ({ d, label }: { d: Dim; label: string }) => (
    <button className={dim === d ? "active" : ""} onClick={() => setDim(d)}>{label}</button>
  );

  return (
    <div className="page">
      <div className="toolbar">{control}</div>

      <div className="panel">
        <h2>Where time goes <small>tool execution time (wall-clock call→result)</small></h2>
        <div className="acc-filters">
          <span className="seg">
            <Btn d="category" label="by category" />
            <Btn d="tool" label="by tool" />
            <Btn d="command" label="by command" />
          </span>
          <span className="muted">total tool time: {fmtMs(grandTotal)}</span>
        </div>

        {rows.loading && <p className="muted">loading…</p>}
        {rows.error && <p className="error">{rows.error}</p>}

        <table>
          <thead>
            <tr><th>{dim}</th><th>share</th><th>total time</th><th>%</th><th>calls</th><th>p50</th><th>err</th></tr>
          </thead>
          <tbody>
            {rows.data?.map((r) => {
              const pct = (r.total_ms / grandTotal) * 100;
              return (
                <tr key={r.key}>
                  <td className="title">{r.key || <span className="muted">(empty)</span>}</td>
                  <td className="bar-cell">
                    <span className="time-bar" style={{ width: `${Math.max(2, pct)}%` }} />
                  </td>
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
      </div>

      <div className="panel">
        <h2>Tool time per day <small>chronological</small></h2>
        {daily.data?.map((d) => (
          <div className="day-row" key={d.day}>
            <span className="day-label">{d.day}</span>
            <span className="day-bar" style={{ width: `${(d.tool_ms / maxDay) * 100}%` }} />
            <span className="muted">{fmtMs(d.tool_ms)} · {fmt(d.calls)} calls</span>
          </div>
        ))}
        <p className="hint">セッション内の詳細な時系列フローは各セッションの Waterfall を参照してください。</p>
      </div>
    </div>
  );
}

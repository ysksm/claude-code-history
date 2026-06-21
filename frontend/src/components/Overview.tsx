import { useMemo, useState } from "react";
import { api } from "../api";
import { fmt } from "../format";
import { useAsync } from "../useAsync";
import { Cards } from "./Cards";
import { DiffStat } from "./DiffStat";

type Period = "all" | "today" | "week" | "month" | "custom";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Resolve a preset period into a {from,to} date range (empty = unbounded).
function presetRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const d = new Date(now);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    return { from: ymd(d), to: today };
  }
  if (period === "month") {
    return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  return { from: "", to: "" };
}

export function Overview({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [period, setPeriod] = useState<Period>("all");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");

  const { from, to } = useMemo(
    () => (period === "custom" ? { from: cFrom, to: cTo } : presetRange(period)),
    [period, cFrom, cTo],
  );
  const range = { from, to };

  const ov = useAsync(() => api.overview(range), [from, to]);
  const pr = useAsync(() => api.projects(range), [from, to]);
  const ss = useAsync(() => api.sessions(range), [from, to]);

  const o = ov.data;
  const Btn = ({ p, label }: { p: Period; label: string }) => (
    <button className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>{label}</button>
  );

  return (
    <div className="page">
      <div className="toolbar">
        <span className="seg">
          <Btn p="all" label="All" />
          <Btn p="today" label="Today" />
          <Btn p="week" label="This week" />
          <Btn p="month" label="This month" />
          <Btn p="custom" label="Custom" />
        </span>
        {period === "custom" && (
          <span className="filt-group">
            <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
            <span className="muted">→</span>
            <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
          </span>
        )}
        {(from || to) && <span className="muted">{from || "…"} → {to || "…"}</span>}
      </div>

      {ov.error && <p className="error">{ov.error}</p>}
      {o && (
        <Cards cards={[
          { label: "Sessions", value: fmt(o.sessions), sub: `${o.projects} projects` },
          { label: "Prompts", value: fmt(o.prompts), sub: `${fmt(o.slash_commands)} slash commands` },
          { label: "Tool calls", value: fmt(o.tool_calls), sub: `${fmt(o.plugin_tool_calls)} via plugins · ${fmt(o.subagent_calls)} subagent` },
          { label: "Code changes", value: <DiffStat added={o.code_added} removed={o.code_removed} />, sub: "lines written / changed (Write+Edit)" },
          { label: "Output tokens", value: fmt(o.output_tokens), sub: "generated" },
          { label: "Total tokens", value: fmt(o.total_tokens), sub: "incl. cache re-reads" },
        ]} />
      )}

      <div className="panel">
        <h2>Projects</h2>
        <table>
          <thead><tr><th>project</th><th>sessions</th><th>tool calls</th><th>code</th><th>output</th><th>total tokens</th></tr></thead>
          <tbody>
            {pr.data?.map((p) => (
              <tr key={p.project_slug}>
                <td>{p.project}</td><td>{fmt(p.sessions)}</td><td>{fmt(p.tool_calls)}</td>
                <td><DiffStat added={p.code_added} removed={p.code_removed} /></td>
                <td>{fmt(p.output_tokens)}</td><td>{fmt(p.total_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Recent / largest sessions <small>click to open timeline</small></h2>
        <table>
          <thead><tr><th>title</th><th>project</th><th>day</th><th>tools</th><th>total tokens</th></tr></thead>
          <tbody>
            {ss.data?.slice(0, 15).map((s) => (
              <tr key={s.session_id} className="clickable" onClick={() => onOpenSession(s.session_id)}>
                <td>{s.ai_title || s.session_id.slice(0, 8)}</td>
                <td>{s.project}</td><td>{s.day}</td><td>{fmt(s.tool_calls)}</td><td>{fmt(s.total_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

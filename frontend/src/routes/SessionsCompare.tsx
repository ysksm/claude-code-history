import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { fmt, fmtDur, fmtDateTime } from "../format";
import { useAsync } from "../useAsync";
import { Cards } from "../components/Cards";
import { Breadcrumb } from "../components/Breadcrumb";
import { DiffStat } from "../components/DiffStat";
import { loadModel, estimate, fmtMoney } from "../valueModel";
import type { SessionMeta } from "../types";

// Compare rows: one metric per row, one column per session.
const METRICS: [string, (m: SessionMeta) => string][] = [
  ["Project", (m) => m.project],
  ["Day", (m) => m.day],
  ["Span", (m) => `${fmtDateTime(m.first_ms)} → ${fmtDateTime(m.last_ms)}`],
  ["Duration", (m) => fmtDur(m.duration_sec)],
  ["Prompts", (m) => fmt(m.prompts)],
  ["Assistant turns", (m) => fmt(m.turns)],
  ["Tool calls", (m) => fmt(m.tools)],
  ["Subagent msgs", (m) => fmt(m.n_subagent_msgs)],
  ["Output tokens", (m) => fmt(m.output_tokens)],
  ["Input+cache", (m) => fmt(m.input_tokens + m.cache_read)],
  ["Total tokens", (m) => fmt(m.total_tokens)],
  ["Models", (m) => m.models ?? ""],
];

const title = (m: SessionMeta) => m.ai_title || m.session_id.slice(0, 8);

export function SessionsCompare() {
  const [sp] = useSearchParams();
  const ids = (sp.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const [mode, setMode] = useState<"compare" | "aggregate">("compare");
  const vm = loadModel();

  const ov = useAsync(
    () => Promise.all(ids.map((id) => api.sessionMeta(id))),
    [sp.toString()],
  );

  if (ids.length === 0) {
    return (
      <div className="page">
        <p className="muted">No sessions selected. <Link to="/sessions">choose sessions</Link></p>
      </div>
    );
  }
  if (ids.length === 1) {
    return <Navigate to={`/sessions/${ids[0]}`} replace />;
  }

  const rows: SessionMeta[] = (ov.data ?? []).filter((m): m is SessionMeta => Boolean(m));

  const agg = rows.reduce(
    (a, m) => ({
      duration_sec: a.duration_sec + m.duration_sec,
      prompts: a.prompts + m.prompts,
      turns: a.turns + m.turns,
      tools: a.tools + m.tools,
      n_subagent_msgs: a.n_subagent_msgs + m.n_subagent_msgs,
      code_added: a.code_added + m.code_added,
      code_removed: a.code_removed + m.code_removed,
      input_tokens: a.input_tokens + m.input_tokens,
      output_tokens: a.output_tokens + m.output_tokens,
      cache_read: a.cache_read + m.cache_read,
      total_tokens: a.total_tokens + m.total_tokens,
    }),
    { duration_sec: 0, prompts: 0, turns: 0, tools: 0, n_subagent_msgs: 0, code_added: 0, code_removed: 0, input_tokens: 0, output_tokens: 0, cache_read: 0, total_tokens: 0 },
  );

  return (
    <div className="page">
      <Breadcrumb items={[{ label: "Sessions", to: "/sessions" }, { label: `Compare (${ids.length})` }]} />

      <div className="seg">
        <button className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")}>Compare</button>
        <button className={mode === "aggregate" ? "active" : ""} onClick={() => setMode("aggregate")}>Aggregate</button>
      </div>

      {ov.error && <p className="error">{ov.error}</p>}
      {ov.loading && <p className="muted">Loading…</p>}

      {!ov.loading && !ov.error && mode === "compare" && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>metric</th>
                {rows.map((m) => (
                  <th key={m.session_id}>
                    <Link to={`/sessions/${m.session_id}`}>{title(m)}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(([label, get]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {rows.map((m) => <td key={m.session_id}>{get(m)}</td>)}
                </tr>
              ))}
              <tr>
                <td>Code changes</td>
                {rows.map((m) => (
                  <td key={m.session_id}><DiffStat added={m.code_added} removed={m.code_removed} /></td>
                ))}
              </tr>
              <tr>
                <td>Est. value</td>
                {rows.map((m) => (
                  <td key={m.session_id}>{fmtMoney(estimate(m.code_added, vm).money, vm.currency)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!ov.loading && !ov.error && mode === "aggregate" && (
        <Cards cards={[
          { label: "Sessions", value: fmt(rows.length), sub: "combined" },
          { label: "Duration", value: fmtDur(agg.duration_sec), sub: "sum of spans" },
          { label: "Prompts", value: fmt(agg.prompts), sub: `${fmt(agg.turns)} assistant turns` },
          { label: "Tool calls", value: fmt(agg.tools), sub: `${fmt(agg.n_subagent_msgs)} subagent msgs` },
          { label: "Code changes", value: <DiffStat added={agg.code_added} removed={agg.code_removed} />, sub: "lines (Write+Edit)" },
          { label: "Est. value", value: fmtMoney(estimate(agg.code_added, vm).money, vm.currency), sub: `~${estimate(agg.code_added, vm).hours.toFixed(1)}h saved` },
          { label: "Output tokens", value: fmt(agg.output_tokens), sub: "generated" },
          { label: "Total tokens", value: fmt(agg.total_tokens), sub: "incl. cache re-reads" },
        ]} />
      )}
    </div>
  );
}

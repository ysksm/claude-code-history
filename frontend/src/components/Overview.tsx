import { useState } from "react";
import { api } from "../api";
import { fmt } from "../format";
import { useAsync } from "../useAsync";
import { usePeriodFilter } from "../period";
import { Cards } from "./Cards";
import { DiffStat } from "./DiffStat";
import { ValueModelEditor } from "./ValueModelEditor";
import { loadModel, estimate, fmtMoney } from "../valueModel";

export function Overview({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const { from, to, control } = usePeriodFilter();
  const [model, setModel] = useState(loadModel);
  const range = { from, to };

  const ov = useAsync(() => api.overview(range), [from, to]);
  const pr = useAsync(() => api.projects(range), [from, to]);
  const ss = useAsync(() => api.sessions(range), [from, to]);

  const o = ov.data;

  return (
    <div className="page">
      <div className="toolbar">{control}</div>

      <div className="toolbar">
        <ValueModelEditor model={model} onChange={setModel} />
      </div>

      {ov.error && <p className="error">{ov.error}</p>}
      {o && (() => {
        const est = estimate(o.code_added, model);
        return (
          <Cards cards={[
            { label: "Sessions", value: fmt(o.sessions), sub: `${o.projects} projects` },
            { label: "Tool calls", value: fmt(o.tool_calls), sub: `${fmt(o.plugin_tool_calls)} via plugins · ${fmt(o.subagent_calls)} subagent` },
            { label: "Code changes", value: <DiffStat added={o.code_added} removed={o.code_removed} />, sub: "lines written / changed (Write+Edit)" },
            { label: "Est. value", value: fmtMoney(est.money, model.currency), sub: `~${est.hours.toFixed(1)}h saved · ${fmt(o.code_added)} added lines ÷ ${model.linesPerHour}/h` },
            { label: "Output tokens", value: fmt(o.output_tokens), sub: "generated" },
            { label: "Total tokens", value: fmt(o.total_tokens), sub: "incl. cache re-reads" },
          ]} />
        );
      })()}

      <div className="panel">
        <h2>Projects</h2>
        <table>
          <thead><tr><th>project</th><th>sessions</th><th>tool calls</th><th>code (lines)</th><th>output (tok)</th><th>total (tok)</th></tr></thead>
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
          <thead><tr><th>title</th><th>project</th><th>day</th><th>tools</th><th>total (tok)</th></tr></thead>
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

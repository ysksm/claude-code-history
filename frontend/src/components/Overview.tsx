import { api } from "../api";
import { fmt } from "../format";
import { useAsync } from "../useAsync";
import { Cards } from "./Cards";

export function Overview({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const ov = useAsync(() => api.overview(), []);
  const pr = useAsync(() => api.projects(), []);
  const ss = useAsync(() => api.sessions(), []);

  const o = ov.data;
  return (
    <div className="page">
      {ov.error && <p className="error">{ov.error}</p>}
      {o && (
        <Cards cards={[
          { label: "Sessions", value: fmt(o.sessions), sub: `${o.projects} projects` },
          { label: "Prompts", value: fmt(o.prompts), sub: `${fmt(o.slash_commands)} slash commands` },
          { label: "Tool calls", value: fmt(o.tool_calls), sub: `${fmt(o.plugin_tool_calls)} via plugins · ${fmt(o.subagent_calls)} subagent` },
          { label: "Output tokens", value: fmt(o.output_tokens), sub: "generated" },
          { label: "Input+cache", value: fmt(o.input_tokens + o.cache_read_tokens), sub: "processed (incl. cache)" },
          { label: "Total tokens", value: fmt(o.total_tokens), sub: "incl. cache re-reads" },
        ]} />
      )}

      <div className="panel">
        <h2>Projects</h2>
        <table>
          <thead><tr><th>project</th><th>sessions</th><th>tool calls</th><th>output</th><th>total tokens</th></tr></thead>
          <tbody>
            {pr.data?.map((p) => (
              <tr key={p.project_slug}>
                <td>{p.project}</td><td>{fmt(p.sessions)}</td><td>{fmt(p.tool_calls)}</td>
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

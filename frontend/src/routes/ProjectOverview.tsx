import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { fmt, fmtDur } from "../format";
import { useAsync } from "../useAsync";
import { Breadcrumb } from "../components/Breadcrumb";
import { Cards } from "../components/Cards";
import { DiffStat } from "../components/DiffStat";
import { loadModel, estimate, fmtMoney } from "../valueModel";

export function ProjectOverview() {
  const { slug } = useParams();
  const nav = useNavigate();

  if (!slug) {
    return (
      <div className="page">
        <p className="muted">No project selected. <Link to="/projects">back to projects</Link></p>
      </div>
    );
  }

  const ov = useAsync(() => api.overview({ project: slug }), [slug]);
  const ss = useAsync(() => api.sessions({ project: slug }), [slug]);

  const o = ov.data;
  return (
    <div className="page">
      <Breadcrumb items={[{ label: "Projects", to: "/projects" }, { label: slug }]} />

      {ov.loading && <p className="muted">loading…</p>}
      {ov.error && <p className="error">{ov.error}</p>}
      {o && (
        <Cards cards={[
          { label: "Sessions", value: fmt(o.sessions), sub: `${o.projects} projects` },
          { label: "Prompts", value: fmt(o.prompts), sub: `${fmt(o.slash_commands)} slash commands` },
          { label: "Tool calls", value: fmt(o.tool_calls), sub: `${fmt(o.plugin_tool_calls)} via plugins · ${fmt(o.subagent_calls)} subagent` },
          { label: "Code changes", value: <DiffStat added={o.code_added} removed={o.code_removed} />, sub: "lines (Write+Edit)" },
          { label: "Est. value", value: fmtMoney(estimate(o.code_added, loadModel()).money, loadModel().currency), sub: `~${estimate(o.code_added, loadModel()).hours.toFixed(1)}h saved` },
          { label: "Output tokens", value: fmt(o.output_tokens), sub: "tokens generated" },
          { label: "Input+cache", value: fmt(o.input_tokens + o.cache_read_tokens), sub: "tokens (incl. cache)" },
          { label: "Total tokens", value: fmt(o.total_tokens), sub: "incl. cache re-reads" },
        ]} />
      )}

      <div className="panel">
        <h2>Sessions <small>click to open timeline</small></h2>
        {ss.loading && <p className="muted">loading…</p>}
        {ss.error && <p className="error">{ss.error}</p>}
        <table>
          <thead>
            <tr>
              <th>title</th><th>day</th><th>duration</th><th>prompts</th><th>tools</th><th>total (tok)</th>
            </tr>
          </thead>
          <tbody>
            {ss.data?.map((s) => (
              <tr key={s.session_id} className="clickable" onClick={() => nav(`/sessions/${s.session_id}`)}>
                <td className="title">{s.ai_title || <span className="muted">{s.session_id.slice(0, 8)}</span>}</td>
                <td>{s.day}</td>
                <td>{fmtDur(s.duration_sec)}</td>
                <td>{fmt(s.prompts)}</td>
                <td>{fmt(s.tool_calls)}</td>
                <td>{fmt(s.total_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

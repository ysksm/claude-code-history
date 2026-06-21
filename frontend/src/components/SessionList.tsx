import { useMemo, useState } from "react";
import { api } from "../api";
import { fmt, fmtDur } from "../format";
import { useAsync } from "../useAsync";
import type { SessionRow } from "../types";

type SortKey = keyof Pick<SessionRow, "total_tokens" | "tool_calls" | "prompts" | "duration_sec" | "day">;

export function SessionList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, error, loading } = useAsync(() => api.sessions(), []);
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [sort, setSort] = useState<SortKey>("total_tokens");

  const projects = useMemo(
    () => [...new Set((data ?? []).map((s) => s.project))].sort(),
    [data],
  );

  const rows = useMemo(() => {
    let r = data ?? [];
    if (project) r = r.filter((s) => s.project === project);
    if (q.trim()) {
      const k = q.toLowerCase();
      r = r.filter((s) => (s.ai_title || "").toLowerCase().includes(k) ||
        s.project.toLowerCase().includes(k) || s.session_id.includes(k));
    }
    return [...r].sort((a, b) => Number(b[sort]) - Number(a[sort]));
  }, [data, q, project, sort]);

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="sortable" onClick={() => setSort(k)}>{label}{sort === k ? " ▾" : ""}</th>
  );

  return (
    <div className="page">
      <div className="toolbar">
        <input placeholder="Search title / project / id…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="muted">{rows.length} sessions</span>
      </div>

      {loading && <p className="muted">loading…</p>}
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>title</th><th>project</th>
              <Th k="day" label="day" />
              <Th k="duration_sec" label="duration" />
              <Th k="prompts" label="prompts" />
              <Th k="tool_calls" label="tools" />
              <Th k="total_tokens" label="total tokens" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.session_id} className="clickable" onClick={() => onSelect(s.session_id)}>
                <td className="title">{s.ai_title || <span className="muted">{s.session_id.slice(0, 8)}</span>}</td>
                <td>{s.project}</td>
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

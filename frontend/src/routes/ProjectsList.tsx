import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { fmt, fmtDur } from "../format";
import { useAsync } from "../useAsync";
import { usePeriodFilter } from "../period";
import { DiffStat } from "../components/DiffStat";
import type { SessionRow } from "../types";

export function ProjectsList() {
  const { from, to, control } = usePeriodFilter();
  const { data, error, loading } = useAsync(() => api.projects({ from, to }), [from, to]);
  const sessions = useAsync(() => api.sessions({ from, to }), [from, to]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  const selectedSlugs = useMemo(
    () => Object.keys(selected).filter((s) => selected[s]),
    [selected],
  );

  // SessionRow carries the display name, not the slug; group sessions by project name.
  const sessionsByName = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const s of sessions.data ?? []) {
      const list = map.get(s.project) ?? [];
      list.push(s);
      map.set(s.project, list);
    }
    return map;
  }, [sessions.data]);

  const toggleSelect = (slug: string) =>
    setSelected((prev) => ({ ...prev, [slug]: !prev[slug] }));

  const toggleExpand = (slug: string) =>
    setExpanded((prev) => ({ ...prev, [slug]: !prev[slug] }));

  const expandAll = () =>
    setExpanded(Object.fromEntries((data ?? []).map((p) => [p.project_slug, true])));

  const collapseAll = () => setExpanded({});

  const compare = () =>
    navigate(`/projects/compare?slugs=${selectedSlugs.join(",")}`);

  return (
    <div className="page">
      <div className="toolbar">{control}</div>
      <div className="toolbar">
        <button
          className="btn-primary"
          disabled={selectedSlugs.length < 2}
          onClick={compare}
        >
          Compare selected
        </button>
        <span className="muted">{selectedSlugs.length} selected</span>
        <button onClick={expandAll}>Expand all</button>
        <button onClick={collapseAll}>Collapse all</button>
      </div>

      {loading && <p className="muted">loading…</p>}
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th></th><th>project</th><th>sessions</th><th>tool calls</th><th>code (lines)</th><th>output (tok)</th><th>total (tok)</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((p) => {
              const isOpen = !!expanded[p.project_slug];
              const rows = sessionsByName.get(p.project) ?? [];
              return [
                <tr key={p.project_slug}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!selected[p.project_slug]}
                      onChange={() => toggleSelect(p.project_slug)}
                    />
                  </td>
                  <td className="title">
                    <span
                      className="tree-caret"
                      role="button"
                      aria-label={isOpen ? "collapse" : "expand"}
                      onClick={() => toggleExpand(p.project_slug)}
                    >
                      {isOpen ? "▾" : "▸"}
                    </span>{" "}
                    <Link to={`/projects/${p.project_slug}`}>{p.project}</Link>
                  </td>
                  <td>{fmt(p.sessions)}</td>
                  <td>{fmt(p.tool_calls)}</td>
                  <td><DiffStat added={p.code_added} removed={p.code_removed} /></td>
                  <td>{fmt(p.output_tokens)}</td>
                  <td>{fmt(p.total_tokens)}</td>
                </tr>,
                ...(isOpen
                  ? rows.length > 0
                    ? rows.map((s) => (
                        <tr
                          key={`${p.project_slug}:${s.session_id}`}
                          className="tree-child clickable"
                          onClick={() => navigate(`/sessions/${s.session_id}`)}
                        >
                          <td></td>
                          <td className="title">
                            {s.ai_title || <span className="muted">{s.session_id.slice(0, 8)}</span>}
                            {s.max_parallel >= 2 && (
                              <span className="par-badge" title={`up to ${s.max_parallel} subagents ran in parallel`}>∥{s.max_parallel}</span>
                            )}
                            <span className="meta"> · {s.day} · {fmtDur(s.duration_sec)}</span>
                          </td>
                          <td></td>
                          <td className="meta">{fmt(s.tool_calls)}</td>
                          <td><DiffStat added={s.code_added} removed={s.code_removed} /></td>
                          <td></td>
                          <td className="meta">{fmt(s.total_tokens)}</td>
                        </tr>
                      ))
                    : [
                        <tr key={`${p.project_slug}:empty`} className="tree-empty">
                          <td></td>
                          <td colSpan={6}>no sessions</td>
                        </tr>,
                      ]
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

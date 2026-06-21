import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { fmt } from "../format";
import { useAsync } from "../useAsync";
import { aggregateOverviews } from "../lib/aggregate";
import { Cards } from "../components/Cards";
import { Breadcrumb } from "../components/Breadcrumb";
import { DiffStat } from "../components/DiffStat";
import type { Overview } from "../types";

export function ProjectsCompare() {
  const [sp] = useSearchParams();
  const slugs = (sp.get("slugs") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const [mode, setMode] = useState<"compare" | "aggregate">("compare");

  const ov = useAsync(
    () => Promise.all(slugs.map((s) => api.overview({ project: s }))),
    [sp.toString()]
  );

  if (slugs.length === 0) {
    return (
      <div className="page">
        <p className="muted">No projects selected. <Link to="/projects">choose projects</Link></p>
      </div>
    );
  }
  if (slugs.length === 1) {
    return <Navigate to={`/projects/${slugs[0]}`} replace />;
  }

  const rows: Overview[] = (ov.data ?? []).filter((o): o is Overview => Boolean(o));

  return (
    <div className="page">
      <Breadcrumb items={[{ label: "Projects", to: "/projects" }, { label: `Compare (${slugs.length})` }]} />

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
                {slugs.map((s) => <th key={s}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                ["Sessions", (o: Overview) => o.sessions],
                ["Prompts", (o: Overview) => o.prompts],
                ["Tool calls", (o: Overview) => o.tool_calls],
                ["Output tokens", (o: Overview) => o.output_tokens],
                ["Input+cache (tok)", (o: Overview) => o.input_tokens + o.cache_read_tokens],
                ["Total tokens", (o: Overview) => o.total_tokens],
              ] as [string, (o: Overview) => number][]).map(([label, get]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {rows.map((o, i) => <td key={slugs[i]}>{fmt(get(o))}</td>)}
                </tr>
              ))}
              <tr>
                <td>Code changes</td>
                {rows.map((o, i) => (
                  <td key={slugs[i]}><DiffStat added={o.code_added} removed={o.code_removed} /></td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!ov.loading && !ov.error && mode === "aggregate" && (() => {
        const c = aggregateOverviews(rows);
        return (
          <Cards cards={[
            { label: "Sessions", value: fmt(c.sessions), sub: `${c.projects} projects combined` },
            { label: "Prompts", value: fmt(c.prompts), sub: `${fmt(c.slash_commands)} slash commands` },
            { label: "Tool calls", value: fmt(c.tool_calls), sub: `${fmt(c.plugin_tool_calls)} via plugins · ${fmt(c.subagent_calls)} subagent` },
            { label: "Code changes", value: <DiffStat added={c.code_added} removed={c.code_removed} />, sub: "lines (Write+Edit)" },
            { label: "Output tokens", value: fmt(c.output_tokens), sub: "generated" },
            { label: "Input+cache", value: fmt(c.input_tokens + c.cache_read_tokens), sub: "tokens (incl. cache)" },
            { label: "Total tokens", value: fmt(c.total_tokens), sub: "incl. cache re-reads" },
          ]} />
        );
      })()}
    </div>
  );
}

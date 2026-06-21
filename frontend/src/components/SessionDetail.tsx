import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { fmt, fmtDur, fmtMs, fmtClock, fmtDateTime, catColor } from "../format";
import { useAsync } from "../useAsync";
import { Cards } from "./Cards";
import { CumulativeChart } from "./CumulativeChart";
import { Waterfall, type WfMode, type WfScale } from "./Waterfall";

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const update = () => ref.current && setW(ref.current.clientWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return { ref, w };
}

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <span className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? "active" : ""} onClick={() => onChange(v)}>{label}</button>
      ))}
    </span>
  );
}

export function SessionDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [sidechain, setSidechain] = useState(true);
  const [mode, setMode] = useState<WfMode>("seq");
  const [scale, setScale] = useState<WfScale>("log");
  const [kindFilter, setKindFilter] = useState<"all" | "tool" | "assistant">("all");
  const [wfOpen, setWfOpen] = useState(true);
  const [wfErr, setWfErr] = useState(false);
  const [etOpen, setEtOpen] = useState(true);
  const [etKind, setEtKind] = useState<"all" | "prompt" | "assistant" | "tool">("all");
  const [etErr, setEtErr] = useState(false);
  const [etSearch, setEtSearch] = useState("");
  const { ref, w } = useWidth();

  const meta = useAsync(() => api.sessionMeta(id), [id]);
  const events = useAsync(() => api.events(id, sidechain), [id, sidechain]);
  const minutes = useAsync(() => api.minutes(id), [id]);

  const tableRows = useMemo(() => {
    let r = events.data ?? [];
    if (etKind !== "all") r = r.filter((e) => e.kind === etKind);
    if (etErr) r = r.filter((e) => e.is_error);
    if (etSearch.trim()) {
      const k = etSearch.toLowerCase();
      r = r.filter((e) => (e.label || "").toLowerCase().includes(k) || e.category.toLowerCase().includes(k));
    }
    return r;
  }, [events.data, etKind, etErr, etSearch]);

  const m = meta.data;
  return (
    <div className="page" ref={ref}>
      <div className="detail-head">
        <button onClick={onBack}>← back</button>
        <h2>{m?.ai_title || id}{m ? ` · ${m.project}` : ""}</h2>
        <label className="chk">
          <input type="checkbox" checked={sidechain} onChange={(e) => setSidechain(e.target.checked)} />
          include subagents
        </label>
      </div>

      {meta.error && <p className="error">{meta.error}</p>}
      {m && (
        <p className="hint">{fmtDateTime(m.first_ms)} → {fmtDateTime(m.last_ms)}</p>
      )}
      {m && (
        <Cards cards={[
          { label: "Duration", value: fmtDur(m.duration_sec), sub: `${fmtClock(m.first_ms)}–${fmtClock(m.last_ms)}` },
          { label: "Prompts", value: fmt(m.prompts), sub: `${fmt(m.turns)} assistant turns` },
          { label: "Tool calls", value: fmt(m.tools), sub: `${fmt(m.n_subagent_msgs)} subagent msgs` },
          { label: "Output tokens", value: fmt(m.output_tokens), sub: "generated" },
          { label: "Input+cache", value: fmt(m.input_tokens + m.cache_read), sub: "processed (incl. cache)" },
          { label: "Models", value: "", sub: m.models ?? "" },
        ]} />
      )}

      <div className="panel">
        <h2>Cumulative output tokens & tool time / minute <small>(from session start)</small></h2>
        {minutes.data && <CumulativeChart minutes={minutes.data} width={w - 28} />}
        <div className="legend">
          <span style={{ color: "#d97757" }}>■ cumulative output tokens</span>
          <span style={{ color: "#3fb950" }}>■ tool ms / minute</span>
        </div>
      </div>

      <div className="panel">
        <div className="acc-head" role="button" onClick={() => setWfOpen((o) => !o)}>
          <span className="acc-caret">{wfOpen ? "▾" : "▸"}</span>
          <h2>Waterfall <small>bar length = duration</small></h2>
        </div>
        {wfOpen && (
          <>
            <div className="acc-filters">
              <Seg value={mode} onChange={setMode} options={[["seq", "sequential"], ["real", "real-time"]]} />
              <Seg value={scale} onChange={setScale} options={[["log", "log"], ["lin", "linear"]]} />
              <Seg value={kindFilter} onChange={setKindFilter}
                options={[["all", "all"], ["tool", "tools"], ["assistant", "assistant"]]} />
              <label className="chk">
                <input type="checkbox" checked={wfErr} onChange={(e) => setWfErr(e.target.checked)} />
                errors only
              </label>
            </div>
            <p className="hint">
              {mode === "seq"
                ? "x = cumulative wall-clock duration (idle gaps removed)"
                : "x = real time from session start (shows idle gaps)"} · {scale} scale
            </p>
            {events.loading && <p className="muted">loading events…</p>}
            {events.error && <p className="error">{events.error}</p>}
            {events.data && <Waterfall events={events.data} mode={mode} scale={scale} kindFilter={kindFilter} errorsOnly={wfErr} width={w - 28} />}
          </>
        )}
      </div>

      <div className="panel">
        <div className="acc-head" role="button" onClick={() => setEtOpen((o) => !o)}>
          <span className="acc-caret">{etOpen ? "▾" : "▸"}</span>
          <h2>Event table <small>{tableRows.length} of {events.data?.length ?? 0} events</small></h2>
        </div>
        {etOpen && (
          <>
            <div className="acc-filters">
              <input type="text" placeholder="Search label / category…" value={etSearch}
                onChange={(e) => setEtSearch(e.target.value)} />
              <Seg value={etKind} onChange={setEtKind}
                options={[["all", "all"], ["prompt", "prompt"], ["assistant", "assistant"], ["tool", "tool"]]} />
              <label className="chk">
                <input type="checkbox" checked={etErr} onChange={(e) => setEtErr(e.target.checked)} />
                errors only
              </label>
            </div>
            <table>
              <thead><tr><th>seq</th><th>t</th><th>start</th><th>end</th><th>kind</th><th>label</th><th>category</th><th>tokens</th><th>duration</th><th>err</th></tr></thead>
              <tbody>
                {tableRows.slice(0, 800).map((e) => (
                  <tr key={e.seq} className={e.is_error ? "row-error" : ""}>
                    <td>{e.seq}</td><td>{fmtDur(e.offset_sec)}</td>
                    <td>{fmtClock(e.ts_ms)}</td>
                    <td>{e.duration_ms != null ? fmtClock(e.ts_ms + e.duration_ms) : ""}</td>
                    <td>{e.kind}</td>
                    <td className="title">
                      <span className="dot" style={{ background: catColor(e.category) }} />{e.label}
                    </td>
                    <td>{e.category}</td>
                    <td>{e.total_tokens ? fmt(e.total_tokens) : ""}</td>
                    <td>{e.duration_ms != null ? fmtMs(e.duration_ms) : ""}</td>
                    <td>{e.is_error ? "⚠" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

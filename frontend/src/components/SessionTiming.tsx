import { useState } from "react";
import { api } from "../api";
import { fmtMs } from "../format";
import { useAsync } from "../useAsync";
import { TimeTable } from "./TimeTable";

type Dim = "category" | "tool" | "command";

// Per-session "where time goes" breakdown.
export function SessionTiming({ sessionId }: { sessionId: string }) {
  const [dim, setDim] = useState<Dim>("category");
  const cat = useAsync(() => api.timeBreakdown("category", { session: sessionId }), [sessionId]);
  const rows = useAsync(() => api.timeBreakdown(dim, { session: sessionId }), [dim, sessionId]);
  const grandTotal = (cat.data ?? []).reduce((s, r) => s + r.total_ms, 0) || 1;

  const Btn = ({ d, label }: { d: Dim; label: string }) => (
    <button className={dim === d ? "active" : ""} onClick={() => setDim(d)}>{label}</button>
  );

  return (
    <>
      <div className="acc-filters">
        <span className="seg">
          <Btn d="category" label="by category" />
          <Btn d="tool" label="by tool" />
          <Btn d="command" label="by command" />
        </span>
        <span className="muted">total tool time: {fmtMs(grandTotal)}</span>
      </div>
      {rows.error && <p className="error">{rows.error}</p>}
      <TimeTable rows={rows.data ?? []} grandTotal={grandTotal} dimLabel={dim} />
    </>
  );
}

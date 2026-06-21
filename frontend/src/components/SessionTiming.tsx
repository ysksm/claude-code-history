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
          <Btn d="category" label="カテゴリ別" />
          <Btn d="tool" label="ツール別" />
          <Btn d="command" label="コマンド別" />
        </span>
        <span className="muted">合計ツール時間: {fmtMs(grandTotal)}</span>
      </div>
      <p className="hint">合計時間は承認待ち・アイドルを含みます。実処理の重さは「1回あたり中央値」を目安に。</p>
      {rows.error && <p className="error">{rows.error}</p>}
      <TimeTable rows={rows.data ?? []} grandTotal={grandTotal} dimLabel={dim} />
    </>
  );
}

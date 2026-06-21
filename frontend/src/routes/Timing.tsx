import { useState } from "react";
import { api } from "../api";
import { fmt, fmtMs } from "../format";
import { useAsync } from "../useAsync";
import { usePeriodFilter } from "../period";
import { TimeTable } from "../components/TimeTable";

type Dim = "category" | "tool" | "command";

export function Timing() {
  const { from, to, control } = usePeriodFilter();
  const [dim, setDim] = useState<Dim>("command");
  const range = { from, to };

  // category breakdown is always fetched: its sum is the grand total tool time.
  const cat = useAsync(() => api.timeBreakdown("category", range), [from, to]);
  const rows = useAsync(() => api.timeBreakdown(dim, range), [dim, from, to]);
  const daily = useAsync(() => api.timeDaily(range), [from, to]);

  const grandTotal = (cat.data ?? []).reduce((s, r) => s + r.total_ms, 0) || 1;
  const maxDay = Math.max(1, ...(daily.data ?? []).map((d) => d.tool_ms));

  const Btn = ({ d, label }: { d: Dim; label: string }) => (
    <button className={dim === d ? "active" : ""} onClick={() => setDim(d)}>{label}</button>
  );

  return (
    <div className="page">
      <div className="toolbar">{control}</div>

      <div className="panel">
        <h2>何に時間が掛かっているか <small>ツール実行時間の内訳</small></h2>
        <div className="acc-filters">
          <span className="seg">
            <Btn d="category" label="カテゴリ別" />
            <Btn d="tool" label="ツール別" />
            <Btn d="command" label="コマンド別" />
          </span>
          <span className="muted">合計ツール時間: {fmtMs(grandTotal)}</span>
        </div>
        <p className="hint">
          バーの長さ＝合計時間の割合。<b>合計時間</b>は呼び出し〜結果のウォールクロックで、承認待ち・アイドルを含むため大きく出ることがあります。
          実処理の重さは<b>「1回あたり中央値(p50)」</b>を目安にしてください。
          「コマンド別」では <code>npm run lint</code> 等が時間に占める割合が分かります。
        </p>

        {rows.loading && <p className="muted">loading…</p>}
        {rows.error && <p className="error">{rows.error}</p>}

        <TimeTable rows={rows.data ?? []} grandTotal={grandTotal} dimLabel={dim} />
      </div>

      <div className="panel">
        <h2>Tool time per day <small>chronological</small></h2>
        {daily.data?.map((d) => (
          <div className="day-row" key={d.day}>
            <span className="day-label">{d.day}</span>
            <span className="day-bar" style={{ width: `${(d.tool_ms / maxDay) * 100}%` }} />
            <span className="muted">{fmtMs(d.tool_ms)} · {fmt(d.calls)} calls</span>
          </div>
        ))}
        <p className="hint">セッション内の詳細な時系列フローは各セッションの Waterfall を参照してください。</p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { api } from "../api";
import { fmt, fmtDateTime } from "../format";
import { useAsync } from "../useAsync";
import type { UsageWindows } from "../types";

const H5_MS = 5 * 3600 * 1000;
const WK_MS = 7 * 24 * 3600 * 1000;
const KEY = "cch.usageLimits";

interface Limits { h5: number; weekly: number }
function loadLimits(): Limits {
  try { return { h5: 0, weekly: 0, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { h5: 0, weekly: 0 }; }
}

function Window({ title, from, now, lastMs, windowMs, total, output, input, sessions, limit, onLimit }: {
  title: string; from: number; now: number; lastMs: number; windowMs: number;
  total: number; output: number; input: number; sessions: number;
  limit: number; onLimit: (n: number) => void;
}) {
  const pct = limit > 0 ? Math.min(100, (total / limit) * 100) : 0;
  const over = limit > 0 && total > limit;
  const clearAt = lastMs + windowMs;
  const idleCleared = now > clearAt;
  const barColor = over ? "#f85149" : pct > 80 ? "#d29922" : "#3fb950";
  return (
    <div className="panel">
      <h2>{title} <small>{fmtDateTime(from)} → now</small></h2>
      <div className="usage-big">{fmt(total)} <span className="muted">tokens</span></div>
      <div className="muted usage-sub">
        output {fmt(output)} · input+cache {fmt(input)} · {fmt(sessions)} sessions
      </div>
      {limit > 0 && (
        <>
          <div className="usage-bar"><span style={{ width: `${Math.max(2, pct)}%`, background: barColor }} /></div>
          <div className="muted">
            {pct.toFixed(1)}% of {fmt(limit)} · {over ? <span className="del">over by {fmt(total - limit)}</span> : `${fmt(limit - total)} remaining`}
          </div>
        </>
      )}
      <div className="muted usage-reset">
        {idleCleared
          ? "現在この期間内の活動はありません(ウィンドウは空)"
          : <>アイドルが続けば <b>{fmtDateTime(clearAt)}</b> に消費がクリアされます</>}
      </div>
      <label className="usage-limit">
        <span className="muted">limit (tokens):</span>
        <input type="number" min={0} step={100000} value={limit || ""} placeholder="未設定"
          onChange={(e) => onLimit(Number(e.target.value))} />
      </label>
    </div>
  );
}

export function Usage() {
  const u = useAsync(() => api.usageWindows(), []);
  const [limits, setLimits] = useState<Limits>(loadLimits);

  const setLimit = (patch: Partial<Limits>) => {
    const next = { ...limits, ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    setLimits(next);
  };

  const d = u.data as UsageWindows | undefined;
  return (
    <div className="page">
      {u.error && <p className="error">{u.error}</p>}
      {!d && !u.error && <p className="muted">loading…</p>}
      {d && (
        <div className="usage-grid">
          <Window title="5-hour window" from={d.h5_from} now={d.now_ms} lastMs={d.last_ms} windowMs={H5_MS}
            total={d.h5_total} output={d.h5_output} input={d.h5_input} sessions={d.h5_sessions}
            limit={limits.h5} onLimit={(n) => setLimit({ h5: n })} />
          <Window title="Weekly window" from={d.wk_from} now={d.now_ms} lastMs={d.last_ms} windowMs={WK_MS}
            total={d.wk_total} output={d.wk_output} input={d.wk_input} sessions={d.wk_sessions}
            limit={limits.weekly} onLimit={(n) => setLimit({ weekly: n })} />
        </div>
      )}
      <p className="hint">
        ※ ここに表示する消費量はローカルのトランスクリプトから集計した推定値(直近5時間 / 直近7日のローリングウィンドウ、サブエージェント込み)です。
        Anthropic 公式の制限しきい値・正確なリセット時刻は Claude Code の <code>/usage</code> で確認してください。
        limit を設定すると使用率と残量を表示します。
      </p>
    </div>
  );
}

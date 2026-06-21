import { useEffect, useState } from "react";
import { api } from "../api";
import type { McpServerStatus } from "../types";

export function McpView() {
  const [st, setSt] = useState<McpServerStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => api.mcpServer().then(setSt).catch((e) => setError(String(e.message ?? e)));
  useEffect(() => { load(); }, []);

  const toggle = async () => {
    if (!st) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.mcpServerSet(!st.installed);
      setSt(next);
      if (next.action_ok === false) {
        setError(next.action_error || next.action_output || "command failed");
      }
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!st) return;
    await navigator.clipboard.writeText(st.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="page">
      <div className="panel">
        <h2>MCP server <small>レポート / 振り返りを Claude Code から呼び出す</small></h2>
        <p className="muted">
          cch を MCP サーバとして登録すると、Claude Code から <code>overview</code> /
          <code> list_projects</code> / <code>list_sessions</code> / <code>session_retrospective</code> /
          <code> daily_retrospective</code> / <code>report</code> のツールが使えます。
        </p>

        {error && <p className="error">{error}</p>}
        {!st && !error && <p className="muted">loading…</p>}

        {st && (
          <>
            <div className="mcp-status">
              <span className={st.installed ? "par-badge" : "muted"}>
                {st.installed ? "● 登録済み (ON)" : "○ 未登録 (OFF)"}
              </span>
              <button className="btn-primary" disabled={busy || !st.claude_available} onClick={toggle}>
                {busy ? "…" : st.installed ? "OFF にする (remove)" : "ON にする (add)"}
              </button>
              {!st.claude_available && (
                <span className="muted">claude CLI が見つからないため、下のコマンドを手動で実行してください</span>
              )}
            </div>

            <h3>追加コマンド</h3>
            <div className="mcp-cmd">
              <pre>{st.command}</pre>
              <button onClick={copy}>{copied ? "copied!" : "copy"}</button>
            </div>
            <p className="muted">解除: <code>{st.remove_command}</code></p>
            <p className="muted">binary: <code>{st.binary}</code></p>

            {st.action_output && (
              <>
                <h3>実行結果</h3>
                <pre className="mcp-out">{st.action_output}</pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { catColor } from "../format";

// Event kind: the top-level shape of a timeline row.
const KINDS: [string, string][] = [
  ["prompt", "ユーザー入力(プロンプト / スラッシュコマンド)"],
  ["assistant", "アシスタント(モデル)の応答ターン"],
  ["tool", "ツール呼び出し(下の category に細分類)"],
];

// Tool category: how each tool call is classified (drives the bar colors).
const CATEGORIES: [string, string][] = [
  ["file", "ファイル操作 — Read / Write / Edit / MultiEdit / NotebookEdit"],
  ["search", "検索 — Grep / Glob / LS"],
  ["bash", "シェル実行 — Bash / BashOutput / KillShell"],
  ["agent", "サブエージェント起動 — Agent(Task) / Workflow"],
  ["skill", "スキル実行 — Skill"],
  ["task", "バックグラウンドタスク管理 — TaskCreate / Update / List / Stop など"],
  ["web", "Web — WebSearch / WebFetch"],
  ["mcp", "MCP サーバ経由ツール — mcp__*(例: chrome-devtools)"],
  ["plan", "計画 / ワークツリー — EnterPlanMode / ExitPlanMode / EnterWorktree"],
  ["toolsearch", "遅延ツールのスキーマ取得 — ToolSearch"],
  ["interaction", "ユーザーへの問い合わせ — AskUserQuestion"],
  ["lsp", "言語サーバ — LSP(定義ジャンプ・診断)"],
  ["assistant", "アシスタントの応答(イベント行)"],
  ["user", "ユーザー発話(イベント行)"],
  ["other", "その他 / 未分類 — Monitor など"],
];

export function Legend() {
  return (
    <div className="legend-tables">
      <div>
        <h3>kind <small>イベントの種類</small></h3>
        <table>
          <tbody>
            {KINDS.map(([k, desc]) => (
              <tr key={k}>
                <td className="legend-name">{k}</td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>category <small>ツールの分類(色)</small></h3>
        <table>
          <tbody>
            {CATEGORIES.map(([c, desc]) => (
              <tr key={c}>
                <td className="legend-name">
                  <span className="dot" style={{ background: catColor(c) }} />{c}
                </td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

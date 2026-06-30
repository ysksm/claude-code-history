# 仕様

入力データ、正規化スキーマ、DuckDB のテーブル/ビュー、HTTP API、MCP プロトコルの詳細仕様。

---

## 1. 入力データ（`~/.claude`）

`internal/source/source.go` が読み取り元と作業ディレクトリを解決する。

### パス解決

| 用途 | 既定値 | 上書き |
|---|---|---|
| Claude ホーム | `~/.claude` | `--claude` フラグ → `CLAUDE_HOME` 環境変数 → 既定 |
| 作業ディレクトリ | `~/.cache/cch`（`os.UserCacheDir()` 配下） | `--data` フラグ → `CCH_DATA` 環境変数 → 既定 |
| セッション転写 | `<claude>/projects/` | — |
| 設定 | `<claude>/settings.json` | — |
| プラグイン | `<claude>/plugins/` | — |
| DuckDB DB | `<data>/cch.duckdb` | — |

### セッション転写ファイル（JSONL）

`<claude>/projects/<project-slug>/<session-uuid>.jsonl` が 1 セッション、1 行 1 レコードの JSONL。サブエージェント転写は `<session-uuid>/subagents/*.jsonl` に別ファイルで存在し、親セッションへロールアップされ `is_sidechain = true` として扱われる。

#### レコード形式（`parse.Record`）

利用するフィールドのみを抽出する（その他は無視）。

| フィールド | JSON キー | 用途 |
|---|---|---|
| Type | `type` | `assistant` / `user` / `ai-title` を処理 |
| UUID / ParentUUID | `uuid` / `parentUuid` | メッセージの親子関係 |
| SessionID | `sessionId` | セッション ID（レコード優先） |
| Timestamp | `timestamp` | ISO-8601。epoch ミリ秒へ変換 |
| CWD | `cwd` | 実作業ディレクトリ（プロジェクト名の正確な復元に使用） |
| GitBranch / Version | `gitBranch` / `version` | メタ情報 |
| IsSidechain | `isSidechain` | サブエージェント判定 |
| PromptSource | `promptSource` | プロンプト由来 |
| AITitle | `aiTitle` | セッションの AI 生成タイトル |
| Message | `message` | 内側ペイロード（raw のまま型別にデコード） |

#### メッセージペイロード（`parse.Message`）

- `role`, `model`, `content`（文字列 **または** ブロック配列）, `usage`
- **`content` が文字列** = 実ユーザープロンプト or スラッシュコマンド
- **`content` が配列** = `text` / `thinking` / `tool_use` / `tool_result` ブロックの並び

#### トークン会計（`parse.Usage`）

`input_tokens`・`output_tokens`・`cache_read_input_tokens`・`cache_creation_input_tokens`・`service_tier`・`server_tool_use.{web_search_requests, web_fetch_requests}`。`total_tokens` は 4 種トークンの合算として算出する。

### 設定・プラグイン（`extract.go`）

- `settings.json` から `model`・`effortLevel`・`permissions.defaultMode`・`enabledPlugins`（`name@marketplace` → bool）を読む。
- `plugins/cache/<marketplace>/<plugin>/` ディレクトリを走査し、設定に無いプラグインも `enabled=false` として補完する。
- プラグイン名集合は MCP ツール名の分割（後述）に使われる。

---

## 2. ツール分類（`parse/classify.go`）

各 `tool_use` を `ToolInfo{Category, Plugin, MCPServer, Skill, Subagent}` に分類する。

### カテゴリ対応表

| カテゴリ | 代表ツール |
|---|---|
| `file` | Read, Write, Edit, MultiEdit, NotebookEdit |
| `search` | Grep, Glob, LS |
| `bash` | Bash, BashOutput, KillBash, KillShell |
| `agent` | Agent, Workflow |
| `skill` | Skill |
| `task` | TaskCreate/Update/List/Get/Output/Stop |
| `web` | WebSearch, WebFetch |
| `plan` | ExitPlanMode, EnterPlanMode, EnterWorktree, ExitWorktree |
| `toolsearch` | ToolSearch |
| `interaction` | AskUserQuestion |
| `lsp` | LSP |
| `mcp` | `mcp__*`（名前で判定。表外に優先） |
| `other` | 上記以外（Monitor 等） |

### 特殊処理

- **Agent / Workflow**: `subagent_type` を `Subagent` に格納。
- **Skill**: `skill` を格納。`:` を含めば前半をプラグイン名とみなす（例 `superpowers:brainstorming`）。
- **MCP**（`mcp__` 接頭辞）: `parseMCP` が `mcp__<server>__<tool>` を分解。`server` が `plugin_<plugin>_<server>` 形式なら、既知プラグイン名の**最長一致**で `(plugin, server)` に分割。未知プラグインは rest 全体をプラグイン名とする（既知の制約、architecture.md 参照）。

### ツール詳細（`ToolDetail`）

ツール入力から 1 行のサマリ（最大 300 文字）と、書き込み系ツールの追加/削除行数（GitHub 風）を抽出する。Bash は `command`、Write/Edit は `file_path`＋行数、Grep/Glob は `pattern`、WebFetch は `url`、MCP は `url/query/uid/selector/command/function` のいずれか。

### スラッシュコマンド検出（`SlashCommand`）

ユーザー文字列中の `<command-name>/name</command-name>` を抽出、または改行を含まない `/name ...` 先頭一致で検出する。

---

## 3. 正規化テーブル（NDJSON → DuckDB）

`extract.Run` が `<data>/` に 7 つの NDJSON ファイルを書き出し、`ddb.Build` が `schema.sql` でテーブルとして読み込む。列型を明示するため空ファイルでもロードが堅牢。

| テーブル | 主な列 |
|---|---|
| `sessions` | session_id, project_slug, project_path, project, file, ai_title |
| `messages` | uuid, parent_uuid, session_id, project_slug, ts, ts_ms, type, role, model, input_tokens, output_tokens, cache_read, cache_creation, total_tokens, service_tier, web_search, web_fetch, n_tool_use, n_thinking, text_len, is_sidechain, git_branch, version |
| `tool_calls` | id, session_id, project_slug, ts, ts_ms, assistant_uuid, name, category, plugin, mcp_server, skill, subagent, is_sidechain, input_len, detail, in_lines, del_lines, model |
| `tool_results` | tool_use_id, session_id, project_slug, ts, ts_ms, is_error, output_len, is_sidechain |
| `prompts` | session_id, project_slug, ts, ts_ms, kind（prompt/command）, command, text_len, source, is_sidechain |
| `plugins` | name, marketplace, enabled |
| `meta` | generated_at, model, effort_level, default_mode, n_sessions, n_projects, claude_home |

`ts_ms` は epoch ミリ秒。DuckDB の `to_timestamp` は秒を取るため、ビューでは `ts_ms / 1000.0` で変換する。

---

## 4. DuckDB ビュー（`views.sql`）

集計ロジックは全てビューに集約される。

| ビュー | 役割 | サイドチェーン扱い |
|---|---|---|
| `v_messages` | メッセージにウォールクロック・day・hour・セッション内ステップ遅延（`step_ms`）を付与 | 行を保持 |
| `v_tool_timing` | `tool_calls` と `tool_results` を `id` で結合し `duration_ms`（call→result）を算出 | 行を保持 |
| `v_session_rollup` | セッション単位の集約（期間・プロンプト/ターン/ツール数・トークン・モデル） | n_user/n_assistant は `NOT is_sidechain`、トークン/ツールは含む |
| `v_project_rollup` | プロジェクト単位の集約（display name でグループ化） | 上の rollup を継承 |
| `v_daily` | 日次トレンド | prompts のみ `NOT is_sidechain` |
| `v_model_usage` | モデル別トークン（assistant ターン） | **含む** |
| `v_tool_usage` | ツール別の呼び出し/エラー/avg/p50/p95/出力バイト | **含む** |
| `v_category_usage` | カテゴリ別の呼び出し/avg/全体比 | **含む** |
| `v_plugin_usage` | プラグイン別の呼び出し/エラー/p95（plugin 列が設定された tool_call） | **含む** |
| `v_plugin_adoption` | 導入プラグイン ⟕ 実利用（未使用プラグインの発見） | 上を継承 |
| `v_skill_usage` | スキル別（組み込み/プラグイン） | **含む** |
| `v_subagent_usage` | サブエージェント別 | **含む** |
| `v_command_usage` | スラッシュコマンド別 | `NOT is_sidechain` |
| `v_mcp_usage` | MCP サーバ別（プラグイン/ユーザ・グローバル） | **含む** |
| `v_tool_transitions` | セッション内の連続ツールカテゴリ遷移ペア | **含む** |
| `v_timing_summary` | assistant_step と tool_duration のレイテンシ要約（avg/p50/p95/max） | **含む** |
| `v_overview` | 単一行の総計。prompts/slash_commands は `NOT is_sidechain` | 混在 |
| `v_events` | セッション横断の時系列イベント列（prompt/assistant/tool を統合、累積トークン・経過秒付き） | 行を保持（クエリ側で除外） |
| `v_session_minutes` | セッション×分のタイムスライス（トークン・ツール時間・累積） | `v_events` を継承 |

> **重要な注意**: ダッシュボード API は既定でサブエージェント込み（`sidechain=include`）、CLI ビューはビューごとにサイドチェーン方針が混在する。このため同一データでも CLI とダッシュボードで数値がずれることがある（ANALYSIS.md「8. 計測上の注意」、architecture.md「既知の制約」参照）。

### 計測上の前提

- **`duration_ms` / `step_ms` はトランスクリプトのタイムスタンプ差によるウォールクロック**で、ユーザの待機・バックグラウンド処理・確認待ちを含む。平均値は外れ値で大きく歪むため、判断は **p50/p95** で行う。
- パーセンタイルは `duration_ms >= 0`（call と result が揃った）行のみで計算する。

---

## 5. HTTP API（`internal/server/server.go`）

`serve` が `127.0.0.1:<port>` で SPA（`/`）と JSON API（`/api/*`）を提供する。全 API は JSON 配列（または単一オブジェクト）を返す。

### 共通クエリパラメータ（`cond`）

| パラメータ | 意味 |
|---|---|
| `from` / `to` | 日付範囲（`YYYY-MM-DD`）。該当タイムスタンプ列に対する範囲条件 |
| `project` | `project_slug` による絞り込み |
| `sidechain` | `include` でサブエージェントを含める。それ以外は `is_sidechain = FALSE` |

### エンドポイント

| パス | 返すもの |
|---|---|
| `/api/filters` | プロジェクト一覧・日付範囲・モデル一覧（フィルタ UI 用） |
| `/api/overview` | 総計（フィルタ適用、コード増減行数含む） |
| `/api/daily` | 日次トークン/ツール/プロンプト/セッション |
| `/api/projects` | プロジェクト別集計（コード増減含む） |
| `/api/models` | モデル別トークン |
| `/api/tools` | ツール別（上位 50） |
| `/api/categories` | カテゴリ別 |
| `/api/plugins` | プラグイン別（導入 ⟕ 利用） |
| `/api/skills` | スキル別 |
| `/api/subagents` | サブエージェント別 |
| `/api/commands` | スラッシュコマンド別 |
| `/api/mcp` | MCP サーバ別 |
| `/api/workflow` | ツール遷移ペア（上位 40） |
| `/api/timing` | レイテンシ要約 |
| `/api/sessions` | セッション一覧（最大並列サブエージェント数・コード増減含む、上位 100） |
| `/api/session?id=` | 1 セッションのイベント列（`v_events`、上限 2000） |
| `/api/session_meta?id=` | 1 セッションのメタ・サマリ |
| `/api/session_minutes?id=` | 1 セッションの分単位タイムスライス |
| `/api/usage_windows` | 直近 5 時間・7 日間のトークン消費推定 |
| `/api/time_breakdown` | 実行時間の分解（`dim`=category/tool/command, `session`） |
| `/api/time_daily` | 日次のツール実行時間合計 |
| `/api/mcp_server` | GET: cch MCP 登録状況 / POST `{enabled}`: 登録・解除 |

各クエリは 30 秒タイムアウト。SQL リテラルは `lit()`（シングルクオートのエスケープ）で組み立てる。SPA ハンドラはファイルに対応しないパスを `index.html` にフォールバック（SPA 対応）。

### 使用量ウィンドウの注意

`usage_windows` はローカル転写から **消費量を推定**するもの。Anthropic 公式の上限しきい値や正確なリセット時刻はローカルに保存されないため（API ヘッダ / `/usage` 由来）含まれない。リミットは全活動を数えるためサブエージェント込みで計算する。

---

## 6. MCP プロトコル（`internal/mcpserver/mcpserver.go`）

- **トランスポート**: 改行区切り JSON-RPC 2.0（stdin/stdout）。診断は全て stderr へ（stdout はプロトコル専用）。
- **プロトコルバージョン**: `2024-11-05`。`serverInfo` は `{name: "cch", version: "0.1.0"}`。
- **対応メソッド**: `initialize` / `ping` / `tools/list` / `tools/call` / `notifications/*`（応答不要）。未知メソッドは `-32601`。
- **ツール**: features.md「4. MCP サーバ」の 8 ツール。各ツールは `inputSchema`（JSON Schema）を持ち、引数は `argStr` / `argInt` でデコード。クエリは 30 秒タイムアウト。
- **session_id 解決**: `resolveID` が前方一致で完全 ID に展開する。

---

## 7. DuckDB 連携（`internal/ddb/ddb.go`）

CGO ドライバではなく、インストール済みの **DuckDB CLI をサブプロセス起動**して利用する。

| 関数 | 動作 |
|---|---|
| `Available()` | PATH 上の `duckdb` を確認 |
| `Build(paths)` | DB を削除して再作成。`schema.sql` + `views.sql` を stdin で流し込む（作業ディレクトリを `cmd.Dir` にして相対パスを解決） |
| `Formatted(paths, sql, mode)` | `-readonly -<mode>` でクエリし DuckDB のレンダリングを返す |
| `QueryJSON(ctx, paths, sql)` | `-readonly -json` でクエリし `[]map[string]any` にデコード |

クエリは常に `-readonly` で実行され、元データを破壊しない。`mustDuckDB()` が未インストール時に `brew install duckdb` を案内する。
</content>

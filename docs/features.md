# 機能一覧

`cch` が提供する機能のカタログ。CLI サブコマンド、レポート、Web ダッシュボード、MCP サーバの 4 つの出力面で構成される。

---

## 1. CLI サブコマンド

エントリポイントは `cmd/cch/main.go`。`cch <subcommand> [args]` の形式で実行する。

| サブコマンド | 概要 | 主なオプション |
|---|---|---|
| `ingest` | `~/.claude` を解析し DuckDB データベースを構築する。**最初に必ず実行する** | `--claude DIR`（Claude ホーム、既定 `~/.claude`）、`--data DIR`（作業ディレクトリ、既定 `~/.cache/cch`） |
| `report [NAME\|all]` | 名前付き分析レポートを表示（既定 `overview`） | `--format`（box/markdown/csv/json）、`--out FILE`、`--data DIR` |
| `export` | 全レポート（ビュー/テーブル）をファイルへ一括ダンプ | `--format`（csv/json/parquet）、`--out DIR`（既定 `cch-export`）、`--data DIR` |
| `serve` | インタラクティブ Web ダッシュボードを起動 | `--port N`（既定 8080）、`--data DIR` |
| `mcp` | MCP サーバ（stdio）を起動。レポート/レトロスペクティブ用 | `--data DIR` |
| `session ID`（別名 `timeline`） | 1 セッションのタイムライン（イベント列 / タイムスライス）を表示 | `--bucket SEC`、`--format`、`--sidechain`、`--limit`（既定 400）、`--data DIR` |
| `sql "SELECT ..."` | 任意の SQL を DuckDB に対して直接実行 | `--format`、`--data DIR` |
| `-h` / `--help` / `help` | 使い方を表示 | — |

### 出力形式（FORMATS）

`box`（既定・ASCII 罫線）、`markdown`、`csv`、`json`。DuckDB CLI のレンダリング機能（`-box` / `-markdown` / `-csv` / `-json`）をそのまま利用する。

### `session` サブコマンドの 2 モード

- **イベントモード**（既定）: プロンプト → アシスタントターン → ツール呼び出しを時刻順に列挙。各行に `seq`・経過秒・種別・ラベル・カテゴリ・トークン・実行時間・エラー有無を表示。
- **タイムスライスモード**（`--bucket N`）: N 秒単位のバケットに集約し、バケットごとのツール数/プロンプト数/ターン数/トークン/ツール実行時間/累積トークンを表示。

セッション ID は**前方一致**で解決される（例: `cch session 587c2e98`）。既定ではサブエージェント（サイドチェーン）イベントを除外し、`--sidechain` で含められる。

---

## 2. レポート（`cch report` / API / MCP 共通）

レポートは `internal/report/report.go` の `All` で一元定義され、CLI・ダッシュボード・MCP の `report` ツールから共通利用される。各レポートは DuckDB ビューに対する SQL クエリ 1 本で実装される。

| key | タイトル | 内容 | 背後のビュー |
|---|---|---|---|
| `overview` | Overview | 全期間の総計（セッション/プロンプト/ツール/トークン/稼働時間） | `v_overview` |
| `tokens` | Token usage by model | モデル別の input/output/cache トークン | `v_model_usage` |
| `projects` | Projects | プロジェクト別のセッション数・ツール数・トークン | `v_project_rollup` |
| `daily` | Daily trend | 日次の活動量とトークン | `v_daily` |
| `tools` | Tool usage | ツール別の呼び出し数・エラー率・実行時間（上位 40） | `v_tool_usage` |
| `categories` | Tool categories | ツールカテゴリ別（file/bash/mcp/agent…）の集計 | `v_category_usage` |
| `plugins` | Plugin adoption | **導入済みプラグイン vs 実利用**（未使用プラグインの発見） | `v_plugin_adoption` |
| `skills` | Skill usage | スキル呼び出し（組み込み/プラグイン） | `v_skill_usage` |
| `subagents` | Subagent usage | サブエージェント（Agent ツール）利用 | `v_subagent_usage` |
| `commands` | Slash commands | スラッシュコマンド頻度 | `v_command_usage` |
| `mcp` | MCP servers | MCP サーバ利用（プラグイン/ユーザ/グローバル） | `v_mcp_usage` |
| `workflow` | Tool transitions | 連続するツールカテゴリの遷移ペア（上位 30） | `v_tool_transitions` |
| `timing` | Timing summary | アシスタント応答間隔・ツール実行時間のレイテンシ（ms） | `v_timing_summary` |
| `sessions` | Top sessions | トークン量上位セッション（上位 30） | `v_session_rollup` |

`cch report all` は上記を表示順に一括出力する。`cch export` は全レポートをそれぞれ `<key>.<ext>` ファイルへ書き出す。

---

## 3. Web ダッシュボード（`cch serve`）

React + TypeScript（Vite ビルド）の SPA。ビルド成果物 `internal/web/dist` を `go:embed` で Go バイナリに同梱し、`http://127.0.0.1:<port>` で配信する。ルーティングは react-router-dom v7。

### 画面（ルート）

| パス | 画面 | 機能 |
|---|---|---|
| `/` | Overview | 全プロジェクトのグローバルサマリ（カード＋プロジェクト/セッション表） |
| `/projects` | ProjectsList | プロジェクト一覧。複数選択 → 「compare selected」 |
| `/projects/:slug` | ProjectOverview | 単一プロジェクトのサマリ＋セッション一覧 |
| `/projects/compare?slugs=a,b,c` | ProjectsCompare | 複数プロジェクトの比較/合算（クライアント側集計） |
| `/sessions` | SessionList | プロジェクト横断のフラットなセッション一覧（検索・絞り込み・列ソート） |
| `/sessions/:id` | SessionDetail | セッションのタイムライン詳細（メイン機能） |
| `/timing` | Timing | 実行時間の分解ビュー（カテゴリ/ツール/コマンド別） |
| `/usage` | Usage | 直近 5 時間・7 日間のトークン消費ウィンドウ推定 |
| `/mcp` | McpView | cch MCP サーバの登録状況の確認・有効化/無効化 |

### Session timeline（メイン機能）の構成要素

- **ヘッダカード**: 時間/プロンプト/ツール/出力トークン/入力+キャッシュ/モデル。サブエージェント込み切替。
- **累積チャート**: 累積 output トークンとツール時間/分を SVG・2 軸で描画。
- **ウォーターフォール**: 各イベント（プロンプト/アシスタント/ツール）を横バーで時系列表示。バー長=実行時間、色=カテゴリ、ホバーで詳細。`sequential`/`real-time`・`log`/`linear`・`all`/`tools`/`assistant` を切替。
- **イベント表**: 全イベントの明細。

### 共通フィルタ

期間（from/to）、プロジェクト、サブエージェント込み/除外（`sidechain=include`）を各 API がクエリパラメータで受け付ける。ダッシュボードの既定はサブエージェントを**含める**（`api.ts` で `sidechain: "include"` を付与）。

---

## 4. MCP サーバ（`cch mcp`）

`internal/mcpserver/mcpserver.go`。stdio 上の JSON-RPC 2.0 で MCP（プロトコルバージョン `2024-11-05`）を話し、MCP クライアント（Claude Code 等）から分析データを引けるようにする。日次/セッションのレトロスペクティブ用途を想定。

### 提供ツール（tools/list）

| ツール名 | 概要 | 引数 |
|---|---|---|
| `overview` | 全履歴の総計（セッション/プロンプト/ツール/トークン＋コード増減行数） | なし |
| `list_projects` | 全プロジェクトをトークン降順で一覧 | なし |
| `list_sessions` | セッション一覧。project（表示名）/day（YYYY-MM-DD）/limit で絞り込み | `project`, `day`, `limit`（既定 30） |
| `session_retrospective` | 単一セッションの詳細データ（サマリ・カテゴリ別内訳・実行時間・遅いコマンド・書き込みファイル・コマンド・エラー・スキル/サブエージェント） | `session_id`（前方一致可、必須） |
| `daily_retrospective` | 1 日分の詳細（日次総計・対象セッション・カテゴリ内訳・実行時間・遅いコマンド・エラー・変更ファイル） | `day`（YYYY-MM-DD、必須） |
| `time_breakdown` | 実行時間の分解（category/tool/command）。session_id か day で絞り込み可 | `dim`, `session_id`, `day` |
| `usage_windows` | 直近 5 時間・7 日間のトークン消費推定（サブエージェント込み） | なし |
| `report` | 名前付きレポートを実行して行を返す（上記レポート一覧と同一） | `name`（必須） |

### ダッシュボードからの MCP 登録（`/api/mcp_server`）

`serve` の `/mcp` 画面と `/api/mcp_server` エンドポイントから、`claude` CLI 経由で cch MCP サーバを Claude Code（user スコープ）に登録/解除できる。

- 登録コマンド: `claude mcp add --scope user cch -- <cchバイナリ> mcp`
- 解除コマンド: `claude mcp remove --scope user cch`
- GET で登録状況（`claude` の有無・登録済みか）を取得、POST `{enabled}` で登録/解除を実行。

---

## 5. 起動スクリプト

ビルドと実行をまとめたラッパー。

| スクリプト | 用途 |
|---|---|
| `run.sh` / `run.bat` | ビルド → `ingest` → `serve` を一気に実行。引数で任意のサブコマンドを転送 |
| `dev.sh` / `dev.bat` | 開発モード。Go API（`serve`）＋ Vite dev サーバ（HMR, `http://localhost:5173`、`/api` を `:8080` にプロキシ） |
</content>

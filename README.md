# cch — Claude Code History Analyzer

`~/.claude` 配下のセッション履歴を解析し、**プラグイン導入の是非・ワークフロー・トークン使用量・実行時間・効果**を可視化するツール。

Go でデータを正規化 → **DuckDB** に取り込み SQL で集計 → CLI / Markdown / CSV / JSON / **React + TypeScript のインタラクティブダッシュボード**で出力する。ダッシュボードは Go の単一バイナリに `go:embed` で同梱される。

```
~/.claude/projects/**/*.jsonl ─┐
~/.claude/settings.json        ├─ [Go extract] ─→ *.ndjson ─→ [DuckDB] ─→ report / serve / export
~/.claude/plugins/             ─┘
```

## 必要環境

- Go 1.22+
- DuckDB CLI（`brew install duckdb`）— SQL エンジンとして利用
- Node.js 18+ / npm — ダッシュボード（React/TS）をソースからビルドする場合のみ

## インストール / ビルド

```sh
go build -o cch ./cmd/cch
# もしくは
go install ./cmd/cch
```

### 起動スクリプト（ビルド込み）

ビルドと実行をまとめたラッパー。引数なしで `ingest` → ダッシュボード起動まで一気に行う。

```sh
# macOS / Linux
./run.sh                    # ビルド → ingest → serve
./run.sh report all         # 任意のサブコマンドを転送
./run.sh serve --port 9000
```

```bat
REM Windows
run.bat
run.bat report all
run.bat serve --port 9000
```

## 使い方

```sh
# 1) ~/.claude を解析して DuckDB を構築（最初に必ず実行）
cch ingest

# 2) レポートを表示
cch report                 # overview（既定）
cch report plugins         # プラグイン導入状況 vs 実利用
cch report all             # 全レポートを一括表示

# 出力形式を変える
cch report tokens --format markdown
cch report tools  --format csv --out tools.csv
cch report all    --format markdown --out report.md

# 3) インタラクティブ・ダッシュボード（フィルタ・ドリルダウン・グラフ＋表）
cch serve            # http://127.0.0.1:8080
cch serve --port 9000

# 4) 全データセットをエクスポート
cch export --format csv     --out cch-export
cch export --format parquet --out cch-export

# 5) 1 セッションの時系列（イベント / タイムスライス）
cch report sessions              # まずセッション一覧で id を確認
cch session 587c2e98            # プロンプト→アシスタント→ツールを時刻順に表示（id は前方一致でOK）
cch session 587c2e98 --bucket 300   # 5分バケットでトークン/ツール時間を集計（タイムスライス）

# 6) 任意の SQL を直接実行（DuckDB の全テーブル/ビューが使える）
cch sql "SELECT * FROM v_plugin_adoption"
cch sql "SELECT * FROM v_daily WHERE day >= '2026-06-01'" --format markdown
```

## レポート一覧

| name | 内容 |
|---|---|
| `overview` | 全期間の総計（セッション/プロンプト/ツール/トークン） |
| `tokens` | モデル別トークン（input / output / cache） |
| `projects` | プロジェクト別の利用状況とトークン |
| `daily` | 日次トレンド |
| `tools` | ツール別の呼び出し数・エラー率・実行時間 |
| `categories` | ツールカテゴリ別（file/bash/mcp/agent…） |
| `plugins` | **導入済みプラグイン vs 実際の利用**（未使用プラグインの発見） |
| `skills` | スキル呼び出し（組み込み / プラグイン） |
| `subagents` | サブエージェント（Agent ツール）利用 |
| `commands` | スラッシュコマンド頻度 |
| `mcp` | MCP サーバ利用 |
| `workflow` | 連続するツールカテゴリの遷移（ワークフローの型） |
| `timing` | アシスタント応答間隔・ツール実行時間のレイテンシ |
| `sessions` | トークン量上位セッション |

## ダッシュボード（React + TypeScript）

`cch serve` で起動（`http://127.0.0.1:8080`）。フロントは `frontend/`（Vite + React + TS）にあり、
ビルド成果物 `internal/web/dist` を Go バイナリに同梱している。

- **Sessions**: セッション一覧。検索（タイトル/プロジェクト/id）・プロジェクト絞り込み・列ソート。
  行クリックで **タイムラインビュー** へ
- **Session timeline（メイン機能）**:
  - ヘッダカード（時間/プロンプト/ツール/出力トークン/入力+キャッシュ/モデル）、サブエージェント込み切替
  - **累積 output トークン & ツール時間/分**チャート（SVG, 2軸）
  - **ウォーターフォール**: 各イベント（プロンプト/アシスタント/ツール）を横バーで時系列表示。
    バー長=実行時間、色=カテゴリ、ホバーで詳細。`sequential`/`real-time`・`log`/`linear`・
    `all`/`tools`/`assistant` を切替
  - イベント表
- **Overview**: 全体サマリのカードとプロジェクト/セッション表

### フロントエンド開発

```sh
cd frontend
npm install
npm run dev        # http://localhost:5173 （/api は :8080 の cch serve にプロキシ）
# 別ターミナルで:  cch serve
npm run build      # → internal/web/dist に出力（その後 go build で同梱）
```

> 全レポート（Tool usage / Plugin adoption / Timing / Tool transitions など）は CLI の
> `cch report <name>` で参照できる。ダッシュボードはセッション・タイムラインの可視化に特化。

### サブエージェントの扱い

`include subagents`（既定 ON）でサブエージェント（sidechain）の活動を集計に含める。トークン総量や
ツールコール数はサブエージェントを含めた値が CLI レポートと一致する。スラッシュコマンド数などユーザ
起点の指標は常にサブエージェントを除外して数える。プロジェクト名はレコードの実 `cwd` から取得する
（slug 復元のダッシュ衝突で `go-jira`/`rs-jira` が同一視される問題を回避）。

## データモデル（DuckDB）

`cch ingest` が以下を構築する（`~/.cache/cch/cch.duckdb`）。

**テーブル**: `sessions` `messages` `tool_calls` `tool_results` `prompts` `plugins` `meta`

**ビュー**: `v_overview` `v_model_usage` `v_project_rollup` `v_daily` `v_tool_usage`
`v_category_usage` `v_plugin_usage` `v_plugin_adoption` `v_skill_usage`
`v_subagent_usage` `v_command_usage` `v_mcp_usage` `v_tool_transitions`
`v_tool_timing` `v_timing_summary` `v_session_rollup` `v_messages`

サブエージェントの記録は `<session>/subagents/*.jsonl` という別ファイルにあり、親セッションへ
ロールアップしたうえで `is_sidechain = true` として扱う。

## 計測上の注意（重要）

- **実行時間は「トランスクリプトのタイムスタンプ差」によるウォールクロック**で、ユーザの
  待機時間・バックグラウンド処理・確認待ちを含む。**平均値（avg_ms）は外れ値で大きく歪む**
  ため、実態は **p50_ms** を参照すること（例: `Bash` avg 42s / p50 1.7s）。
- プラグインへのトークン帰属は「そのプラグインのツール呼び出し」ベースであり、厳密な課金額
  ではない（1 アシスタントターンが複数ツールを呼ぶため）。
- プロジェクトパスは `/` を `-` で符号化したディレクトリ名から復元するため表示は近似。
- OTEL（`~/.claude/telemetry`）は未設定でも動作する。本ツールは JSONL を主データ源とする。

## 設計メモ

- DuckDB は CGO ドライバではなく **インストール済み CLI をサブプロセス起動**して利用
  （依存ゼロ・ビルド安定）。出力整形は DuckDB の `-box/-markdown/-csv/-json` を活用。
- ダッシュボードの静的アセットと uPlot は `go:embed` で単一バイナリに同梱。

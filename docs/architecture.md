# 技術情報（アーキテクチャ）

`cch` の内部構造、技術スタック、データパイプライン、ビルド/実行手順、設計上の決定と既知の制約。

---

## 1. アーキテクチャ概要

```
                         ┌──────────────────────────────────────────┐
~/.claude/projects/**.jsonl ──┐                                      │
~/.claude/settings.json     ──┼─→ [extract] ─→ <data>/*.ndjson ──→ [ddb.Build] ─→ cch.duckdb
~/.claude/plugins/          ──┘   (Go で正規化)    (7 テーブル)      (DuckDB CLI)   (テーブル+ビュー)
                                                                          │
                            ┌──────────────┬──────────────┬──────────────┘
                            ▼              ▼              ▼
                      [report/export]  [server]       [mcpserver]
                       CLI 出力        HTTP+SPA        MCP (stdio)
```

データを一度 DuckDB に正規化し、**集計ロジックを SQL ビューに集約**することで、CLI・Web・MCP の 3 つの出力面が同じビュー/レポート定義を共有する。

---

## 2. パッケージ構成

| パッケージ | 責務 |
|---|---|
| `cmd/cch` | エントリポイント。サブコマンドのディスパッチとフラグ解析 |
| `internal/source` | パス解決（`~/.claude` と作業ディレクトリ）、プロジェクト slug のデコード |
| `internal/parse` | JSONL レコードのデコード、ツール分類（`classify.go`）、詳細抽出 |
| `internal/extract` | `~/.claude` を走査し正規化 NDJSON を書き出す |
| `internal/ddb` | DuckDB CLI のラッパー。`schema.sql` / `views.sql` を `go:embed` で同梱 |
| `internal/report` | 名前付きレポート（key + title + SQL）の一元定義 |
| `internal/server` | ダッシュボードの HTTP サーバ＋ JSON API |
| `internal/web` | ビルド済みフロントエンド（`dist`）を `go:embed` で同梱 |
| `internal/mcpserver` | MCP（JSON-RPC 2.0 / stdio）サーバ |
| `frontend/` | React + TypeScript ダッシュボード（Vite） |

`internal/report` がレポート定義の単一の真実源（single source of truth）で、CLI・API・MCP がこれを参照する。

---

## 3. データパイプライン

### 抽出（`extract.Run`）

1. プラグイン名・設定を先に読む（MCP ツール名分割のため）。
2. `projects/<slug>/` を**再帰的に**walk。`<session>/subagents/*.jsonl` は親セッション ID へロールアップし `is_sidechain = true` を強制。
3. 各 JSONL を 1 行ずつデコード（スキャナバッファ最大 64 MB）。`assistant` / `user` / `ai-title` を処理。
   - **assistant**: ブロックを走査して `tool_use` を `tool_calls` に、usage を含む 1 行を `messages` に書く。
   - **user**: `content` が文字列なら `prompts`（prompt/command）＋ `messages`、ブロック配列なら `tool_result` を `tool_results` に書く。
4. プロジェクト名は**レコードの実 `cwd` を優先**（slug デコードの曖昧さ回避、後述）。
5. `plugins` / `meta` を書き出す。

出力は `bufio.Writer`（256 KB）でバッファした 7 つの NDJSON。

### ロード（`ddb.Build`）

`schema.sql`（列型明示の `read_json`）＋ `views.sql` を DuckDB CLI に stdin で流し込み、テーブルとビューを構築する。DB は毎回削除して再作成（冪等）。

### クエリ

`Formatted`（人間向けレンダリング）と `QueryJSON`（API/MCP 用）の 2 経路。いずれも `-readonly`。

---

## 4. 技術スタック

### バックエンド

- **言語**: Go 1.25（`go.mod` の `go 1.25.0`。README は最低 1.22+ を要件とする）
- **外部依存**: 標準ライブラリのみ（Go モジュール依存ゼロ）。実行時に **DuckDB CLI** を要求
- **データエンジン**: DuckDB（CLI をサブプロセス起動）
- **埋め込み**: `go:embed` で `schema.sql` / `views.sql` / フロントエンド `dist` を単一バイナリに同梱

### フロントエンド（`frontend/`）

- **フレームワーク**: React 18 + TypeScript 5
- **ルーティング**: react-router-dom v7
- **ビルド**: Vite 5（`@vitejs/plugin-react`）
- **チャート**: SVG ベースの自前描画（ウォーターフォール・累積チャート）。npm 依存はランタイム 3 つ（react / react-dom / react-router-dom）のみで軽量
- **API クライアント**: `src/api.ts`（`fetch` ラッパー、既定 `sidechain: "include"`）

---

## 5. ビルドと実行

### 必要環境

- Go 1.22+（このリポジトリは 1.25 でビルド確認済み）
- DuckDB CLI（`brew install duckdb`）— SQL エンジンとして実行時に必須
- Node.js 18+ / npm — フロントエンドをソースからビルドする場合のみ

### ビルド手順

```sh
# フロントエンド（変更時のみ。dist はコミット済み）
npm --prefix frontend install
npm --prefix frontend run build      # → internal/web/dist

# Go バイナリ（dist を埋め込む）
go build -o cch ./cmd/cch
# または
go install ./cmd/cch
```

### 実行フロー

```sh
cch ingest          # 1) ~/.claude → DuckDB 構築（最初に必須）
cch report overview # 2) レポート
cch serve           # 3) ダッシュボード（http://127.0.0.1:8080）
cch mcp             # 4) MCP サーバ（stdio）
```

ラッパー: `run.sh`（build→ingest→serve）、`dev.sh`（API + Vite HMR）。Windows は `run.bat` / `dev.bat`。

### 検証

`go vet ./...` および `go build ./...` がパスする（DuckDB CLI が無い環境でもビルド・vet は通る。実行時のみ DuckDB を要求）。

---

## 6. 設計上の決定

| 決定 | 理由 |
|---|---|
| **DuckDB を CGO ドライバでなく CLI サブプロセスで利用** | 依存ゼロ・ビルド安定。ユーザの既存 DuckDB を活用。出力整形も DuckDB の `-box/-markdown/-csv/-json` に委譲 |
| **集計を SQL ビューに集約** | CLI・API・MCP の 3 面で同一ロジックを共有。Go 側は SQL の組み立てと整形に専念 |
| **クエリは常に `-readonly`** | 元データを破壊しない |
| **フロントエンドを `go:embed` で同梱** | 単一バイナリで配布可能 |
| **プロジェクト名はレコードの実 `cwd` を優先** | slug デコードの曖昧さ（後述）を回避 |
| **サブエージェントを親セッションへロールアップ** | トークン/ツール総量を CLI レポートと一致させる |
| **レポート定義の単一真実源（`report.All`）** | CLI/API/MCP で名前と SQL がぶれない |

---

## 7. 既知の制約

実データ解析で確認された、数値解釈時に踏まえるべきツール側の論点（詳細は [../ANALYSIS.md](../ANALYSIS.md) の「8. 計測上の注意」）。

- **【HIGH】CLI とダッシュボードでサイドチェーン方針が不一致**。ダッシュボード API（`server.go`）は既定で全エンドポイントに `is_sidechain=FALSE` を注入してサブエージェントを除外する一方（クライアントは `include` を付ける）、CLI ビュー（`views.sql`）はビューごとに方針が混在する。サブエージェント活動を含む履歴では CLI 側のトークン総計・ツール数がダッシュボード既定と食い違う。**最も信頼を損なう論点で、方針統一が望ましい**。
- **【HIGH】サブエージェント起動が幻のプロンプトを注入**。サブエージェント最初の `user` レコード（注入タスク文字列）が `prompts`/`messages` に `is_sidechain=true` で書かれる。`v_overview.prompts` は `NOT is_sidechain` で正しく除外するが、`v_command_usage` にはサイドチェーンフィルタがあるものの、`sidechain=include` 時にプロンプト数が水増しされ得る。
- **【MEDIUM】`v_tool_timing` の join がセッション未スコープ**。`tool_results` を `id` のみで結合するため、セッション再開/compaction で `id` が複数ファイルに現れると join がファンアウトし得る（現データでは重複ゼロで安全）。
- **【MEDIUM】サブエージェント集約が「親ディレクトリ名＝セッション ID」前提**。命名規約が変わると subagent メッセージが `sessions` 行に対応せず rollup から静かに欠落する脆さ。
- **【LOW】`parseMCP` が未知プラグインのサーバーを落とす**。`enabledPlugins` + `plugins/cache` に無いプラグインは server="" になる。既知プラグインは正しい。
- **【LOW】プロジェクト slug デコードの衝突**。`DecodeProjectSlug` は全 `-` を `/` に置換するため、`go-jira` と `rs-jira` が表示ラベル `jira` に潰れる。**安全キーは `project_slug`**（display name ではなく slug でグループ化すべき箇所がある）。実 `cwd` 優先により多くは緩和されるが、ロールアップ表示には残る。

### 解釈の原則

- **実行時間は p50/p95 で判断**（平均は確認待ち・夜間アイドル等の外れ値で激しく歪む）。
- **トークン帰属はツールコール単位の近似**で、正確な課金額ではない。
- **「効果」指標（編集数・低エラー率等）はプロキシ**であり、生成物の正しさ・目標達成は測れない。

---

## 8. ディレクトリツリー

```
.
├── cmd/cch/main.go              # CLI エントリポイント・サブコマンド
├── internal/
│   ├── source/source.go         # パス解決・slug デコード
│   ├── parse/
│   │   ├── parse.go             # JSONL デコード・スラッシュコマンド検出
│   │   └── classify.go          # ツール分類・詳細抽出
│   ├── extract/extract.go       # ~/.claude → NDJSON 正規化
│   ├── ddb/
│   │   ├── ddb.go               # DuckDB CLI ラッパー
│   │   ├── schema.sql           # テーブル定義（go:embed）
│   │   └── views.sql            # 分析ビュー定義（go:embed）
│   ├── report/report.go         # 名前付きレポート定義
│   ├── server/server.go         # HTTP API + SPA 配信
│   ├── web/embed.go             # フロントエンド dist 埋め込み
│   └── mcpserver/mcpserver.go   # MCP (JSON-RPC/stdio) サーバ
├── frontend/                    # React + TS ダッシュボード（Vite）
│   └── src/{App.tsx, api.ts, types.ts, components/, routes/, lib/}
├── docs/                        # 本ドキュメント群
├── run.sh / run.bat            # build→ingest→serve ラッパー
├── dev.sh / dev.bat            # 開発モード（API + Vite HMR）
├── README.md / ANALYSIS.md     # 概要・分析サンプル
└── go.mod                       # module github.com/ysksm/claude-code-history
```
</content>

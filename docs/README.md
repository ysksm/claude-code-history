# cch ドキュメント

`cch`（Claude Code History Analyzer）の設計ドキュメント集。`~/.claude` 配下のセッション履歴を解析し、トークン使用量・実行時間・ツール/プラグイン利用状況を CLI / Markdown / CSV / JSON / Web ダッシュボード / MCP で可視化するツール。

## ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| [features.md](./features.md) | **機能一覧** — CLI サブコマンド、レポート、ダッシュボード、MCP ツールの機能カタログ |
| [specification.md](./specification.md) | **仕様** — 入力データ形式、正規化スキーマ、DuckDB テーブル/ビュー定義、HTTP API、MCP プロトコルの詳細仕様 |
| [architecture.md](./architecture.md) | **技術情報** — アーキテクチャ、パッケージ構成、データパイプライン、技術スタック、ビルド/実行手順、設計上の決定と既知の制約 |

## 関連資料

- [../README.md](../README.md) — プロジェクト概要・クイックスタート
- [../ANALYSIS.md](../ANALYSIS.md) — 実データに対する総合分析レポートのサンプル
- [superpowers/specs/](./superpowers/specs/) — 個別機能の設計スペック

## 一言まとめ

```
~/.claude/projects/**/*.jsonl ─┐
~/.claude/settings.json        ├─ [Go extract] ─→ *.ndjson ─→ [DuckDB] ─→ report / serve / mcp / export
~/.claude/plugins/             ─┘
```

Go でデータを正規化し、DuckDB CLI をサブプロセス起動して SQL 集計、結果を複数のフロントエンド（CLI / Web / MCP）で出力する。外部依存は DuckDB CLI のみ（CGO ドライバ不使用）。ダッシュボードは `go:embed` で単一バイナリに同梱される。
</content>
</invoke>

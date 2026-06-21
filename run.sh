#!/usr/bin/env bash
# cch launcher (macOS / Linux)
#
#   ./run.sh                 -> ビルド後、ingest してダッシュボードを起動
#   ./run.sh ingest          -> 任意のサブコマンドを実行
#   ./run.sh report all
#   ./run.sh serve --port 9000
set -euo pipefail

cd "$(dirname "$0")"

BIN="./cch"

# 依存チェック
command -v go >/dev/null 2>&1 || { echo "error: go が見つかりません" >&2; exit 1; }
if ! command -v duckdb >/dev/null 2>&1; then
  echo "error: duckdb CLI が見つかりません。'brew install duckdb' を実行してください" >&2
  exit 1
fi

# フロントエンド（React/TS）をビルド（dist が無い／src が新しいとき）
if command -v npm >/dev/null 2>&1; then
  if [ ! -f internal/web/dist/index.html ] || [ -n "$(find frontend/src frontend/index.html -newer internal/web/dist/index.html 2>/dev/null | head -1)" ]; then
    echo ">> building frontend ..."
    [ -d frontend/node_modules ] || (cd frontend && npm install)
    (cd frontend && npm run build)
  fi
else
  echo "warn: npm が無いため frontend をビルドできません（同梱済み dist を使用）" >&2
fi

# バイナリが無い／Go ソースか dist が新しい場合のみビルド
if [ ! -x "$BIN" ] || [ -n "$(find cmd internal -newer "$BIN" 2>/dev/null | head -1)" ]; then
  echo ">> building cch ..."
  go build -o "$BIN" ./cmd/cch
fi

# 引数なし: 取り込み → ダッシュボード
if [ "$#" -eq 0 ]; then
  "$BIN" ingest
  echo ">> starting dashboard (Ctrl-C で終了) ..."
  exec "$BIN" serve
fi

exec "$BIN" "$@"

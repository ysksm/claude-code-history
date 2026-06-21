#!/usr/bin/env bash
# cch dev launcher — HMR 開発モード（macOS / Linux）
#
# Go の API バックエンド（cch serve :8080）と Vite dev サーバ（:5173, HMR）を
# 同時に起動する。フロントの編集は :5173 で即時反映（ホットリロード）。
# /api は Vite が :8080 の cch serve にプロキシする（frontend/vite.config.ts）。
#
#   ./dev.sh            -> API + Vite dev を起動（http://localhost:5173 を開く）
#   ./dev.sh --ingest   -> 起動前に ~/.claude を再取り込み（DB 更新）
#   API_PORT=9000 ./dev.sh   -> API ポートを変更（vite.config.ts のプロキシ先も合わせて変更が必要）
#
# Ctrl-C で Vite と API の両方を停止する。
set -euo pipefail

cd "$(dirname "$0")"

API_PORT="${API_PORT:-8080}"
BIN="./cch"

# --- 依存チェック ---
command -v go  >/dev/null 2>&1 || { echo "error: go が見つかりません" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "error: npm が見つかりません" >&2; exit 1; }
command -v duckdb >/dev/null 2>&1 || {
  echo "error: duckdb CLI が見つかりません。'brew install duckdb' を実行してください" >&2; exit 1; }

# --- Go バックエンドをビルド（Go ソースが新しい場合のみ） ---
if [ ! -x "$BIN" ] || [ -n "$(find cmd internal -name '*.go' -newer "$BIN" 2>/dev/null | head -1)" ]; then
  echo ">> building cch (API) ..."
  go build -o "$BIN" ./cmd/cch
fi

# --- 任意: データ再取り込み ---
if [ "${1:-}" = "--ingest" ]; then
  echo ">> ingesting ~/.claude ..."
  "$BIN" ingest
fi

# --- フロント依存をインストール（未導入時のみ） ---
[ -d frontend/node_modules ] || { echo ">> npm install ..."; (cd frontend && npm install); }

# --- API をバックグラウンド起動 ---
echo ">> starting API: $BIN serve --port $API_PORT"
"$BIN" serve --port "$API_PORT" &
API_PID=$!

# 終了（正常終了・Ctrl-C・kill）時に API と Vite の両方を確実に停止。
# Vite は npm -> node -> esbuild と子を持つため、ツリーごと再帰的に停止する。
VITE_PID=""
kill_tree() {
  local p=$1 c
  for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done
  kill "$p" 2>/dev/null || true
}
cleanup() {
  echo
  echo ">> stopping ..."
  [ -n "$VITE_PID" ] && kill_tree "$VITE_PID"
  kill_tree "$API_PID"
}
trap cleanup EXIT INT TERM

# API が起動するまで少し待つ
sleep 1
if ! kill -0 "$API_PID" 2>/dev/null; then
  echo "error: API の起動に失敗しました（ポート $API_PORT が使用中かも）" >&2; exit 1
fi

echo ">> starting Vite dev server (HMR) -> http://localhost:5173"
echo "   (/api は :$API_PORT にプロキシ。Ctrl-C で両方停止)"
# Vite をバックグラウンドで起動し wait。シグナルでも自然終了でも trap で後始末する。
(cd frontend && npm run dev) &
VITE_PID=$!
wait "$VITE_PID"

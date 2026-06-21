@echo off
REM cch dev launcher — HMR 開発モード（Windows）
REM
REM Go の API（cch serve :8080）を別ウィンドウで起動し、Vite dev サーバ
REM （:5173, HMR）を本ウィンドウで起動する。フロントの編集は :5173 で即時反映。
REM /api は Vite が :8080 の cch serve にプロキシする（frontend/vite.config.ts）。
REM
REM   dev.bat            -> API + Vite dev を起動（http://localhost:5173 を開く）
REM   dev.bat --ingest   -> 起動前に ~/.claude を再取り込み（DB 更新）
REM
REM Vite を Ctrl-C で止めると、API ウィンドウも自動で閉じる。
setlocal
cd /d "%~dp0"

set "BIN=cch.exe"

where go >nul 2>nul || ( echo error: go が見つかりません 1>&2 & exit /b 1 )
where npm >nul 2>nul || ( echo error: npm が見つかりません 1>&2 & exit /b 1 )
where duckdb >nul 2>nul || ( echo error: duckdb CLI が見つかりません。https://duckdb.org からインストールしてください 1>&2 & exit /b 1 )

echo ^>^> building cch (API) ...
go build -o "%BIN%" .\cmd\cch
if errorlevel 1 exit /b 1

if "%~1"=="--ingest" (
  echo ^>^> ingesting ~/.claude ...
  "%BIN%" ingest
  if errorlevel 1 exit /b 1
)

if not exist "frontend\node_modules" (
  echo ^>^> npm install ...
  pushd frontend & npm install & popd
)

echo ^>^> starting API ^(:8080^) in a new window ...
start "cch API" "%BIN%" serve --port 8080

echo ^>^> starting Vite dev server ^(HMR^) -^> http://localhost:5173
echo    ^(/api は :8080 にプロキシ。Ctrl-C で Vite と API を停止^)
pushd frontend
call npm run dev
popd

REM Vite 終了後に API ウィンドウを閉じる
taskkill /FI "WINDOWTITLE eq cch API*" /T /F >nul 2>nul
endlocal

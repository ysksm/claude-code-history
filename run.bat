@echo off
REM cch launcher (Windows)
REM
REM   run.bat                  -> ビルド後、ingest してダッシュボードを起動
REM   run.bat ingest           -> 任意のサブコマンドを実行
REM   run.bat report all
REM   run.bat serve --port 9000
REM   run.bat mcp              -> MCP サーバ（stdio）を起動
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "BIN=cch.exe"

where go >nul 2>nul
if errorlevel 1 (
  echo error: go が見つかりません 1>&2
  exit /b 1
)
where duckdb >nul 2>nul
if errorlevel 1 (
  echo error: duckdb CLI が見つかりません。https://duckdb.org からインストールしてください 1>&2
  exit /b 1
)

REM フロントエンド（React/TS）をビルド（dist が無ければ）
where npm >nul 2>nul
if not errorlevel 1 (
  if not exist "internal\web\dist\index.html" (
    echo ^>^> building frontend ...
    if not exist "frontend\node_modules" ( pushd frontend & npm install & popd )
    pushd frontend & npm run build & popd
  )
)

REM cch を毎回ビルド（go build はキャッシュが効くため高速。更新が確実に反映される）
echo ^>^> building cch ...
go build -o "%BIN%" .\cmd\cch
if errorlevel 1 exit /b 1

REM 引数なし: 取り込み → ダッシュボード
if "%~1"=="" (
  "%BIN%" ingest
  if errorlevel 1 exit /b 1
  echo ^>^> starting dashboard ^(Ctrl-C で終了^) ...
  "%BIN%" serve
  exit /b %errorlevel%
)

"%BIN%" %*
exit /b %errorlevel%

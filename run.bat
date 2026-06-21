@echo off
REM cch launcher (Windows)
REM
REM   run.bat                  -> ビルド後、ingest してダッシュボードを起動
REM   run.bat ingest           -> 任意のサブコマンドを実行
REM   run.bat report all
REM   run.bat serve --port 9000
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

REM バイナリが無ければビルド（最新化したい場合は cch.exe を削除）
if not exist "%BIN%" (
  echo ^>^> building cch ...
  go build -o "%BIN%" .\cmd\cch
  if errorlevel 1 exit /b 1
)

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

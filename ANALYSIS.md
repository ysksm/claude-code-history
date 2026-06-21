# Claude Code 利用状況 総合分析レポート

対象データ: 17 セッション / 8 プロジェクト / 266 プロンプト / 7,069–7,096 ツールコール / 累計 4.1B トークン（うち cache_read 約 98%）。
データソース DB: `/Users/kasamatsu/Library/Caches/cch/cch.duckdb`（プロンプト中のパスは未置換テンプレート文字列 `undefined` だったため、`~/.claude` トランスクリプトから再構築した既定 DB を使用）。

> 注: 数値が分析間でわずかに揺れる（例: ツールコール 7,069 vs 7,096）のは、サイドチェーン（サブエージェント）行を含めるか否かでビュー定義が一貫していないため。詳細は「8. 計測上の注意 / ツールの既知の問題」を参照。

---

## 1. エグゼクティブサマリ

- **コストはほぼ「キャッシュ再読み込み」で決まる。** 全トークン 4.108B のうち cache_read が **97.8%（4.017B）**、output 0.45%、input 0.06%。キャッシュヒット率は 95–99% と良好で、問題はヒット率ではなく**保持コンテキストの巨大さと再読み込み回数**。概算コストの約 98% が Opus 4.8、その内訳は cache_read（約 \$5.4K）> output（約 \$1.2K）> cache_creation（約 \$1.1K）。
- **コストは 1 セッションに極端に集中。** `my-app-builder` の単一セッション（2026-06-12, 125 プロンプト, 4,161 ツールコール, 約 145 時間稼働）だけで**全トークンの 81%（3.34B）**。3 日間（06-13/14/15）で全体の約 65%。ここだけ最適化すればほぼ全請求に効く。
- **プラグインは「1 稼働 + 3 死蔵 + 1 無効の宝」。** 有効化 4 個のうち実際に呼ばれたのは **chrome-devtools-mcp のみ（514 コール）**。rust-analyzer-lsp / swift-lsp / ddd-plugin は **0 コール**、高レバレッジな superpowers は**無効**のまま。
- **自動化・委譲レイヤーがほぼ未活用。** 7,069 ツールコールに対し、スラッシュコマンド 29（大半が `exit`/`model` の定型）、サブエージェント 36（約 0.5%）、スキル実質 1 回。手作業中心の Read→Edit→…→Bash 反復ループが支配的。
- **信頼性は概ね良好（全体エラー率 約 3%）。** 弱点は MCP/ブラウザ自動化（6.1%、最悪は `list_pages` 66.7% / `select_page` 100% / `take_screenshot` 13.2%）と、Edit のリトライ（56 失敗中 29 が連続失敗 = 主たる摩擦シグナル）。
- **真のマシン時間は Bash と chrome-devtools に集中。** ファイル I/O（Read/Edit/Write）は p50 16–32ms で実質瞬時。平均値は承認待ち・夜間アイドル（最大 14.6 時間の 1 件）で激しく歪むため、**判断は p50/p95 で行うこと**。

---

## 2. プラグイン: 導入すべきか・どう使うか

現状の利用実態（`v_plugin_adoption`）:

| plugin | enabled | calls | sessions | projects |
|---|---|---|---|---|
| chrome-devtools-mcp | true | **514** | 6 | 4 |
| ddd-plugin | true | 0 | 0 | 0 |
| rust-analyzer-lsp | true | 0 | 0 | 0 |
| swift-lsp | true | 0 | 0 | 0 |
| superpowers | false | 0 | 0 | 0 |

**KEEP — chrome-devtools-mcp（唯一の実働プラグイン）**
- 514 コール / 9 稼働日（2026-05-31〜06-17）/ 4 プロジェクト。全ツールコールの約 7%。
- レイテンシ p50 3.68s / avg 9.12s（外れ値で偏り）/ p95 14.2s。エラー率 5.6%（29/514）。`evaluate_script` が半数（256 コール）で、DOM/JS 検証・スクリプティングのハーネスとして実機能。
- 利用の 87% は my-app-builder（448 コール）。rs-jira はエラー率 24.5%（13/53）と不安定。
- 使いどころ: Web UI デバッグ、`evaluate_script` での DOM/JS 検査、スクショ、フォーム/クリック自動化。エラー裾を減らすには、状態取得は `take_screenshot`（13% エラー）より **`take_snapshot`（0% エラー, p50 2.2s）**を優先し、タブ操作前に `list_pages`/`select_page` を防御的に再実行する。

**DROP / DISABLE — swift-lsp, rust-analyzer-lsp（各 0 コール）**
- 履歴に Swift/Rust 作業の痕跡なし。起動・コンテキストのオーバーヘッドのみで効果ゼロ。
- 再有効化は実際に Cargo/Rust リポ・Swift/Xcode プロジェクトを開いたときだけ。

**TRY-THEN-DECIDE — ddd-plugin（有効だが 0 コール）**
- `implement-domain`（値オブジェクト/エンティティ/集約/ドメインイベント）は実用機能。app/backend 作業が多いユーザーには効きうる。
- 次の 1–2 セッションのドメインモデリング作業で意図的に 1 回試し、効かなければ無効化。

**ENABLE & ADOPT — superpowers（現在無効・最大の機会損失）**
- 多段ビルド/デバッグを大量にこなすのにスキル利用がほぼゼロ。`brainstorming` → `writing-plans` → `test-driven-development`、`systematic-debugging`、`verification-before-completion`、`using-git-worktrees` を提供。
- まず ON にする。非自明な機能着手前と、バグ遭遇時（場当たり修正でなく systematic-debugging）に使う。

**結論:** chrome-devtools は維持、LSP 2 つは無効化、ddd-plugin は 1 回トライ、superpowers を ON。これでインストール構成が「8 割死蔵」から無駄のない実用セットに転換する。

---

## 3. ワークフロー: 設計/テスト/ツール/コマンドとの組み合わせ方

**支配的ループ（`v_category_usage` / `v_tool_transitions`）**
- ツール構成: file **54.4%（3,849）** / bash **34.1%（2,411）** / mcp 7.7%（541, ほぼ chrome-devtools）。Edit/Read/Write = 1,864 / 1,301 / 687。
- 遷移は自己ループ優勢: `file→file` 2,846（Edit→Edit 1,154 等）、`bash→bash` 1,308、`file↔bash` 936+870。実体は **Read → Edit → Edit → … → Bash（実行）→ また Edit** の密な「手コーディング」反復。Edit(1,864) >> Read(1,301) かつ Edit→Edit 優勢 = 新規リード無しのチェイン編集が多い。

**テスト/ビルドは Bash に表れる（入力テキストは保存されないので推定）**
- Bash p50 1,764ms / p95 11,796ms。1–12s 帯はテストスイート・`go build`・dev サーバチェックの典型シグネチャ。エラー率 2.8% と低い。`file↔bash` 1,806 遷移が edit→build/test→fix サイクルと整合。

**自動化レイヤーは過少利用**
- サブエージェント 36（general-purpose 17 / Explore 14 / default 4 / Plan 1）。全ツールコールの約 0.5%。builder は 4,161 コールに対し Agent 派遣 9 のみ。
- スラッシュコマンド 29 は大半が定型（`exit` 11 / `model` 10 / `add-dir` 4）。ワークフロー系は `run-skill-generator` 1 のみ。カスタムプロジェクトコマンドは未運用。
- plan カテゴリ 3 コール、AskUserQuestion 14。ボリュームに対し事前計画がほぼ無い。

**推奨（組み合わせ方）**
1. **探索はサブエージェントに委譲。** Read→Read(603) の手探り偵察は Explore（既に 14 回成功）へ。大型タスクでサブエージェント比率を 0.5% → 5%+ へ。
2. **33 コール/プロンプトのスプリント前に計画。** builder/history は 33–42 コール/プロンプトで plan は計 3。Plan/brainstorming を先に置けば長い Edit チェインの軌道修正を減らせる。
3. **edit→build→test ループをコマンド/フック化。** `/check`（build+test+lint）スラッシュコマンド、または Edit/Write の PostToolUse フックで自動実行。
4. **遊休ツールを起動。** LSP（go-to-def/diagnostics）で Read+grep を削減、superpowers の TDD/検証スキルで test-first を補強。
5. **Read-before-Edit 衛生。** LSP/Explore で編集を裏付け、長い Edit チェインの手戻りを削減。
6. **chrome-devtools を定型化。** navigate→screenshot→evaluate の検証列を `/verify-ui` 1 コマンドにまとめ、約 10 回の手動 MCP コールを 1 ステップ化。

---

## 4. トークン使用量

**全体（`v_overview`）**
| 区分 | トークン | 比率 |
|---|---|---|
| input | 2,476,572 | 0.06% |
| output | 18,424,373 | 0.45% |
| cache_read | **4,017,075,049** | **97.8%** |
| total | 4,108,080,403 | 100% |

整合性検証済み: `sum(v_project_rollup.total_tokens)` = 4,108,080,403 で `v_overview` と完全一致。

**モデル別（`v_model_usage`）** — Opus 4.8 が全体を支配（90%, 8,464 ターン）
| model | turns | input | output | cache_read | total |
|---|---|---|---|---|---|
| claude-opus-4-8 | 8,464 | 2.33M | 15.5M | **3.61B** | 3.69B (89.7%) |
| claude-fable-5 | 756 | 129K | 1.87M | 201M | 206M |
| claude-sonnet-4-6 | 1,288 | 10K | 732K | 128M | 134M |
| claude-haiku-4-5 | 1,586 | 7.6K | 259K | 74M | 78M |
| claude-opus-4-7 | 117 | 252 | 44K | 4.3M | 5M |

**プロジェクト別（`v_project_rollup`）** — builder 単体で 81%
| project | sessions | cache_read | total |
|---|---|---|---|
| builder (my-app-builder) | 1 | 3.29B | **3.34B (81%)** |
| jira | 9 | 559M | 599M (15%) |
| project (my-basic-project) | 3 | 58.8M | 61M |
| その他 (j-spec/history) | 各 1 | 12–40M | 14–41M |

**キャッシュヒット比（cache_read / fresh_input）**: opus-4-8 1,549×、fable-5 1,555×、sonnet-4-6 12,648×、haiku-4-5 9,765×。ヒット率 95–99% でキャッシュは設計通り機能。

**概算コスト（公開リスト単価, 相対構造が要点で正確な請求額ではない）**
| model | total \$ |
|---|---|
| opus-4-8 | **~7,707** |
| fable-5 | 98 |
| sonnet-4-6 | 67 |
| opus-4-7 | 22 |
| haiku-4-5 | 14 |

**削減レバー**
1. **再読み込み量を減らす（ヒット率ではなく容量）。** `/compact`、早期の要約/剪定、超長時間セッションの分割。145 時間 1 本のセッションが巨額の再読みを生む。
2. **品質が許す範囲でモデルをダウンティア。** j-spec で sonnet/haiku が 1% 未満コストで実作業をこなしている。探索/定型/長時間ビルドは Sonnet/Haiku へ。
3. **サブエージェントのファンアウト管理。** builder は 1,116 サブエージェントメッセージを内包し cache_read を増幅。コンテキスト制限や安価モデル実行を。
4. **集中＝容易な勝ち筋。** 81% が 1 セッション。my-app-builder のコンテキスト縮小・定期 compact・反復 UI 生成での安価モデル化で請求のほぼ全体に効く。

> 注意: トークン帰属はツールコール単位の近似で正確な請求ではない。ドル額は公開リスト単価による方向値。

---

## 5. 実行時間

**全体分布（`v_timing_summary`）** — 平均は外れ値で激しく歪む。**p50/p95 を信頼すること。**
| metric | n | avg_ms | p50_ms | p95_ms | max_ms |
|---|---|---|---|---|---|
| assistant_step | 12,219 | 16,340 | **2,957** | 24,159 | 52,677,457 |
| tool_duration | 7,094 | 32,413 | **36** | 8,007 | 52,661,072 |

max は約 52.7M ms（約 14.6 時間）の夜間アイドル 1 件で、これが全平均を引き上げる（約 7.4s/call 相当）。

**本当に遅い処理（p50 基準）= MCP ブラウザ自動化**
| tool | calls | p50 | p95 | err% |
|---|---|---|---|---|
| evaluate_script | 256 | **5,089** | 13,807 | 1.6 |
| click | 41 | 2,892 | 10,266 | 7.3 |
| fill | 14 | 2,814 | 15,261 | 0 |
| new_page | 27 | 2,605 | 8,818 | 11.1 |
| navigate_page | 83 | 2,601 | 7,328 | 8.4 |
| take_screenshot | 53 | 2,542 | 62,618 | 13.2 |
| Bash | 2,435 | 1,778 | 11,983 | 2.8 |

p95 最悪は `take_screenshot` 62.6s（フルページ/タイムアウト）、`mcp__rs-jira__data_query` 38.9s（p50 11ms のバイモーダル＝コールド/キャッシュ）。

**アイドル偏重（avg >> p50, 平均は無視）**: Write avg 7,561ms/p50 32ms(236×)、Edit avg 2,528/p50 32(79×)、Bash avg 41,812/p50 1,778(24×)、AskUserQuestion avg 4.5M/p50 304,933。これらの数秒〜分の平均は差分承認待ち等の計測アーティファクト。

**アイドルの実態**: 60s 超は 7,094 中 116（1.64%）、5 分超は 46（0.65%）のみ。件数は稀だが規模が巨大で全平均を歪める。

**短縮余地**
1. ブラウザ自動化が唯一の一貫した重ワークロード。DOM 読み取りを `evaluate_script` に集約、状態取得は `take_snapshot` 優先、ページ生成（`new_page` 11% err）を削減。
2. ブラウザツールのエラー（8–13%）削減。操作前の明示的 `wait_for` で p95 裾を圧縮。
3. Bash p95 約 12s（全体の 34%）。独立コマンドの並列化、高コストセットアップの再実行回避。
4. `rs-jira data_query` のコールドスタート/認証をセッション初回に温める。
5. **時計を支配するのはツールでなくアイドル。** 安全な Read 系 Bash・Edit/Write の事前承認で確認プロンプトを減らす方が、どのツール最適化より体感 E2E を圧縮する。

---

## 6. 効果（プロキシ指標と限界）

**ハードな前提:** 以下はすべて *プロキシ*。編集数・ツールコール数・低エラーは**活動量と信頼性のシグナルであり、成果物の正しさ・有用性・完了を証明しない**。多数の編集は生産的かもしれないし空転かもしれない。時間はアイドルを含むため、件数と per-prompt 比に依拠。

1. **全体信頼性は良好（エラー率 約 3.04% = 216/7,094, 20.6 コール/プロンプト）。** file 2.7% / bash 3.0% / mcp **6.1%** / agent 0.0% / task 0.6%。MCP は約 2 倍失敗（環境/タイミング起因）。
2. **サブエージェント使用セッションは高スループット・低エラー。** used 7 セッション: 942 コール/515 編集/エラー **2.76%** vs no 9 セッション: 56 コール/27 編集/**6.79%**。ただし**セッション規模/意図と強く交絡**（大型ビルドが機能を採用、短い探索セッションが採用しない選択効果）。因果は分離不能。
3. **プラグイン使用セッションも同パターン**（2.06% vs 6.27%）。同じ交絡。
4. **リトライは局所的。** Edit が突出: 56 失敗中 **29 が連続失敗**（≒50% がリトライループ、主因は non-unique/non-matching old_string）。Bash(14/72)/Read(11/37) は孤立・自己修復的。これが最も明確な摩擦シグナル。
5. **作業は集中。** 最大セッション my-app-builder は 4,161 コール / 1,516 編集+書き込み / 29.1 コール/プロンプト / エラー 1.4%。対照的に ee7d33（1 プロンプト, エラー 29.2%）等の短い MCP/探索バーストが no-group の平均を押し上げる。
6. **同タスク 3 モデル自然実験（j-spec）。** エラー率は 3 者とも 2–3% で差なし。だが **haiku は Edit 1 回**のみ（主に Read）vs opus 38 / sonnet 42。**エラー率では 3 者「成功」に見えるが、編集量プロキシが作業深度の差を露わにする**。

**限界:** いずれも生成コードの正しさやユーザー目標の達成は測れない。活動量・ツール信頼性・手戻りの方向性プロキシに過ぎない。

---

## 7. 推奨アクション（優先順）

1. **【最優先・コスト】my-app-builder ワークフローを最適化。** 81% のコストが 1 セッション。コンテキスト縮小・定期 `/compact`・超長時間セッションの分割で請求のほぼ全体に効く。
2. **【高・コスト】モデルのダウンティア。** 探索/定型/反復 UI 生成を Sonnet/Haiku へ。j-spec は 1% 未満コストで実作業可を示す（ただし編集深度の差に留意）。
3. **【高・効果/効率】superpowers を有効化し採用。** 計画・TDD・systematic-debugging・verification を導入。Edit リトライ（29/56 連続失敗）と事前計画不足に直接効く。
4. **【中・ワークフロー】edit→build→test を `/check` コマンド or PostToolUse フック化**し、`/verify-ui` で chrome-devtools 検証を 1 ステップ化。
5. **【中・ワークフロー】探索を Explore サブエージェントに委譲**し、Read→Read の手探りを削減（サブエージェント比 0.5%→5%+）。
6. **【中・効率】MCP ブラウザのエラー裾を削減。** `take_snapshot` 優先、操作前 `wait_for`、タブ操作前の再 `list_pages`/`select_page`。
7. **【低・整理】swift-lsp / rust-analyzer-lsp を無効化、ddd-plugin を 1 回トライ後に判断。**
8. **【低・体感速度】安全な Read 系 Bash・Edit/Write を事前承認**し確認プロンプトのアイドルを削減。

---

## 8. 計測上の注意 / ツールの既知の問題（レビューより）

数値を解釈する際に踏まえるべき、レビューで確認されたツール側の問題:

- **【HIGH・数値整合】CLI レポートとダッシュボードで同一データが別の数になる（サイドチェーン方針の不一致）。** ダッシュボード（`server.go:97-99`）は既定で全エンドポイントに `is_sidechain=FALSE` を注入してサブエージェント活動を**除外**する。一方 CLI ビュー（`views.sql`）は一部のみ。`v_overview` のトークン合計、`v_model_usage` / `v_tool_usage` / `v_category_usage` / `v_plugin_usage` / `v_skill_usage` / `v_subagent_usage` / `v_mcp_usage` / `v_command_usage` / `v_tool_transitions` / `v_timing_summary` はサイドチェーンを**含む**。サブエージェント assistant メッセージは実 usage トークンを持つため、サブエージェント/ワークフローを使った履歴では CLI 側のトークン総計・ツール数がダッシュボード既定より**実質的に大きくなる**。本レポートのツールコール数が 7,069 / 7,096 と揺れるのはこの不一致の現れ。**最も信頼を損なうバグ。方針統一が必要。**
- **【HIGH・プロンプト数】サブエージェント起動が幻のユーザープロンプトを注入。** `extract.go:250-273` でサブエージェント最初の `user` レコード（注入タスク文字列）が `prompts`(kind="prompt") と `messages`(type="user") の両方を `is_sidechain=true` で書き込む。`v_overview.prompts` は `NOT is_sidechain` で除外され**正しい**が、`v_command_usage`（`views.sql:179-188`）には**サイドチェーンフィルタが無い**。注入文字列が `/` で始まればスラッシュコマンドとして誤カウントされ得る。ダッシュボードで `sidechain=include` にするとプロンプト数がサブエージェント実行ごとに 1 ずつ水増しされる。→ 本レポートのスラッシュコマンド数（29）はこの誤カウント余地を含む点に留意。
- **【MEDIUM・タイミング】`v_tool_timing` の join がセッション未スコープ。** `views.sql:22-23` の `tool_calls LEFT JOIN tool_results ON r.tool_use_id=c.id` に session/project 述語が無い。**現データでは重複ゼロで安全**だが、セッション再開/compaction で `id` が複数ファイルに現れると join がファンアウトし `calls`/`errors`/出力バイト/パーセンタイルが膨張し得る。
- **【MEDIUM・帰属】サブエージェント集約が親ディレクトリ名＝セッション ID 前提。** `extract.go:94-105`。現データでは一致するが、命名が変わると subagent メッセージのセッションが `sessions` 行に対応せず `v_session_rollup`/`v_project_rollup` から静かに消える脆さ。
- **【LOW・プラグイン帰属】`parseMCP` が未知プラグインのサーバーを落とす。** `classify.go:83-84`。`enabledPlugins`+`plugins/cache` に無いプラグインは server="" かつ偽プラグイン名になる。既知プラグイン（chrome-devtools-mcp）は正しい。
- **【LOW・プロジェクト集計】プロジェクト名の衝突で別プロジェクトが合算され得る。** `DecodeProjectSlug` が全 `-` を `/` 置換。**確認済み: `go-jira` と `rs-jira` がともに表示ラベル `jira` に潰れ、8 スラッグが 7 ロールアップ行に集約される。**トークン総計は完全一致で矛盾なし（`v_overview.projects`=8 だが `v_project_rollup`=7 行）。本レポートの jira 行（9 セッション）は go-jira と rs-jira の合算である点に注意。安全キーは `project_slug`。

**最重要修正（レビュー提言）:** (1) CLI ビューとダッシュボードでサイドチェーン方針を統一、(2) サブエージェント注入文字列の幻プロンプト/メッセージ生成を止める（または一貫して除外）、(3) tool-timing join をセッションにスコープし id/uuid で重複排除。

**検証ステータス:** BUILD PASS（`go build ./...` exit 0）、VET PASS（`go vet ./...` exit 0）。整合性チェックは overview 合計 vs プロジェクトロールアップ合計、tool_calls カウント、timing サマリ単調性、NULL 列いずれも PASS。

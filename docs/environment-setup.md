# 開発環境

2026-10-15 更新。技術構成と版は [technology-selection.md](technology-selection.md) の「採用結果」を参照。

## 前提

- 作業場所：C:\dev\KanColleImprovementPlanner。PowerShell、git、Node.js 22（`.nvmrc`、engines `>=22.12.0`）、npm。
- Android 設定・Gradle は使わない。CreationLog の JAVA_HOME/ANDROID_HOME やコードはコピーしない。
- Claude 設定はルート CLAUDE.md が AGENTS.md を参照。グローバル設定・permissions・hooks は変更しない。
- 起動：`Set-Location C:\dev\KanColleImprovementPlanner` の後に `claude.cmd`。初回依頼は docs/claude-start-prompt.txt。

## 初回準備

```powershell
npm ci
npm run master:build        # 共通マスターを固定した出典（commit・SHA-256）から public/master/ に生成
npm run master:crosscheck   # 出典と生成物の網羅性（全装備・全改修データ・参照先）を検証
npx playwright install chromium
```

`public/master/` は出典の配布条件が未確認のため Git 対象外。開発・ビルドの前に毎回生成する（出典は `.cache/master-sources/` にキャッシュ）。

## 主なコマンド

| 目的 | コマンド | 内容 |
|---|---|---|
| 開発サーバー | `npm run dev` | http://localhost:5173 |
| 型チェック | `npm run typecheck` | アプリ（src）とテスト・設定（e2e 等）の2構成 |
| Lint | `npm run lint` | ESLint（typescript-eslint・react-hooks） |
| 単体・結合テスト | `npm test` | Vitest。計算・取り込み・在庫投影・保存操作（fake-indexeddb） |
| ブラウザE2E | `npm run test:e2e` | Playwright（chromium）。架空マスター・架空データ・時刻固定。開発サーバーを 5174 で自動起動 |
| 本番ビルド | `npm run build` | typecheck の後に vite build。CSP を付与し、テスト用の入口は含めない |
| 画面比較の撮影 | `npm run screens:capture` | S01〜S34 を 1440×940 で work/screens/app に撮影 |
| 画面比較 | `npm run screens:compare -- app` | 参照PNGとの差分・並列画像を work/screens/compare/app に出力 |
| ガイド画像の撮影 | `npm run guide:capture` | 取り込みガイドに載せるアプリ画面（架空データ）を public/guide に撮影 |
| 網羅性検証 | `npm run master:crosscheck [-- --wiki <保存したHTML>]` | Wiki の改修表との照合は手元に保存した資料を指定したときだけ |

画像あり表示での比較（ローカル専用画像）：`node scripts/prepare-local-images.mjs` の後、`$env:SCREENS_IMAGES='1'; $env:SCREENS_VARIANT='images'; npx playwright test --project=screens`。

## ローカル専用で Git に含めないもの

- `private/`：利用者の所持データ（個人データ）。A01 のローカル検証だけに使い、数値を公開資料に書かない。
- `docs/ui-reference/screens/*.png`：画面設計の参照PNG（このPCのローカル参照用）。
- `public/master/`：生成した共通マスター（出典の配布条件が未確認）。
- `public/local-images/`：画面比較用に参照PNGから切り出したゲーム画像（配布不可）。ビルド成果物からも自動で除外。
- `work/`、`test-results/`、`.cache/`：作業・計測・キャッシュ。

## CI

`.github/workflows/ci.yml`：PR と手動起動で npm ci → master:build → master:crosscheck → typecheck → lint → test → build → E2E（chromium）。公開・デプロイは行わない。画面比較は参照PNGがローカル専用のため CI では実行しない。main のブランチ保護に必須チェックとして登録するかは利用者の判断（未設定）。

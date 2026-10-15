# 公開手順（GitHub Pages）

2026-10-15。**公開・リリース作成・main へのマージは利用者の明示的な指示がある場合だけ行う。** この文書は手順と前提条件の記録であり、実施済みではない。

## 公開前に必要な判断（未解決）

| 項目 | 状態 | 公開への影響 |
|---|---|---|
| 共通マスター出典（Tibowl/api_start2、ElectronicObserverEN/Data）の配布条件 | 未確認（ライセンス表記なし） | 公開サイトは生成したマスター（public/master）を配信する。配布条件を確認するか、権利者の許諾・代替出典が必要 |
| ゲーム画像 | 配布条件未確認 | 既定のまま非表示（VITE_IMAGE_BASE_URL を設定しない）。表示する場合は配信元と条件を確認。画像のパスに装備・艦のIDが入るため、同じサイトの相対パスだけを指定できる（別サイトの URL はビルドで拒否） |
| 実機確認（A02・A11・A13） | 未実施 | Chrome/Edge と 74式EN の実レスポンス取り込み、Windows 実機の目視、ゲーム側の手順撮影 |
| Codex レビュー | PR の最新 head SHA で「指摘なし」が必要 | development-workflow.md のマージゲート |
| main へのマージ | 利用者の許可が必要 | squash マージ、`--match-head-commit` に完全な SHA を指定 |

## 手順（上記の判断が済んだ後）

1. PR を main へ squash マージする（利用者の許可を得て、最新 head SHA を指定）。
2. 公開用ワークフローを追加する PR を作る。手動起動だけにし、main への push で自動公開しない。

   ```yaml
   # .github/workflows/pages.yml（配布条件の確認後に追加する案）
   name: Deploy to GitHub Pages
   on:
     workflow_dispatch:
   permissions:
     contents: read
     pages: write
     id-token: write
   concurrency:
     group: pages
     cancel-in-progress: false
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version-file: .nvmrc, cache: npm }
         - run: npm ci
         - run: npm run master:build
         - run: npm run master:crosscheck
         - run: npm run build
         - uses: actions/upload-pages-artifact@v3
           with: { path: dist }
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment: { name: github-pages, url: '${{ steps.deployment.outputs.page_url }}' }
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

3. リポジトリの Settings → Pages → Source を「GitHub Actions」にする。
4. Actions から「Deploy to GitHub Pages」を手動実行する。
5. 公開URL（https://otk-sudo.github.io/KanColleImprovementPlanner/ の想定）で確認する：
   - 初回画面（S15）が表示され、フッターにアプリ版とマスター版が出る（目録の SHA-256 照合が通っている）。
   - `#/calendar` などハッシュURLの再読み込みで同じ画面が開く（base `./`）。
   - 開発者ツールで CSP（connect-src 'self'）が付いており、外部への通信がない。
   - 取り込み → 反映 → バックアップ書き出し → 復元 が通る。ガイド画像（public/guide）が表示される。
   - 配布物に private/・public/local-images・テスト用の入口（__kaishu）が含まれない（ビルドで除外済み。公開後も dist の一覧で確認）。
6. 版を上げる場合は package.json の version を更新する（画面のフッターに表示）。GitHub のリリース・タグ作成は利用者の指示があるときだけ行う。

## 戻し方

- 直前の正常な公開を Actions の実行履歴から再実行する、またはマージを revert する PR を作って再公開する。
- 利用者のデータは各ブラウザの IndexedDB（DB 名 kancolle-improvement-planner）にあり、サイトを戻しても消えない。データの互換性は writer の版で保護している（新しい版が書いた DB へ古い版から書き込まない）。

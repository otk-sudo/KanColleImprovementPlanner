# 艦これ改修スケジューラ（改修航路）

PC向け、ログイン・端末間同期なしのWebアプリ。各提督のブラウザ内（IndexedDB）で所持データと改修計画を管理する。

## 現在の状態

画面設計 S01〜S34 と業務処理を実装し、自動テスト・画面比較まで実施（feature/implementation、PR でレビュー中）。公開サイトは未公開、main へのマージ・リリースは未実施。実機での確認や配布条件など残る項目は [docs/implementation-status.md](docs/implementation-status.md)。
製造・テスト・修正は Claude、設計整理・レビューは Codex が担当する。

## 使い方（開発）

```powershell
npm ci
npm run master:build   # 共通マスターを生成（public/master、Git 対象外）
npm run dev            # http://localhost:5173
```

コマンドの一覧・ローカル専用の資料は [docs/environment-setup.md](docs/environment-setup.md)。

## 読む順番

1. AGENTS.md / CLAUDE.md
2. docs/requirements.md（合意済み要求の正本）
3. docs/data-research.md（調査結果・マスター出典・未検証事項）
4. docs/development-workflow.md / docs/environment-setup.md
5. docs/acceptance-criteria.md / docs/implementation-status.md

## 正本の場所

| 内容 | 文書 |
|---|---|
| 要求 R01〜R23・受入基準 A01〜A13 | docs/requirements.md、docs/acceptance-criteria.md |
| 基本・詳細設計 | [docs/design/README.md](docs/design/README.md)（内部処理は 09〜14・17・18） |
| 画面設計と画面資料 | docs/ui-design-v1.md、[docs/ui-reference/README.md](docs/ui-reference/README.md)（PNG はローカル専用） |
| 技術構成（採用結果） | [docs/technology-selection.md](docs/technology-selection.md) |
| 実装状況・未確認 | [docs/implementation-status.md](docs/implementation-status.md) |
| 検証の対応表（A・P → テスト） | [docs/test-traceability.md](docs/test-traceability.md) |
| 画面比較の記録 | [docs/screen-comparison.md](docs/screen-comparison.md) |
| 公開手順 | [docs/release.md](docs/release.md) |

公開先は GitHub Pages（https://github.com/otk-sudo/KanColleImprovementPlanner、公開リポジトリ）。CreationLog のソース・Android 設定は流用しない。要求全件の監査状況は [design/16](docs/design/16-requirements-audit.md)、修正履歴は [design/15](docs/design/15-review-log.md)。

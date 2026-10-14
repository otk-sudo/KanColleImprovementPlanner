# 艦これ改修スケジューラ（仮称）

PC向け、ログイン・端末間同期なしのWebアプリ。各提督のブラウザ内で所持データと計画を管理する。

## 現在の状態
要求整理、Claude向け作業環境、Penpot画面設計の初稿を作成済み。アプリ、ビルド環境、CI、公開サイトは未実装。
製造・テスト・修正はClaude、設計整理・レビューはCodexが担当する。

## 読む順番
1. AGENTS.md / CLAUDE.md
2. docs/requirements.md（合意済み要求の正本）
3. docs/data-research.md（調査結果と未検証事項）
4. docs/development-workflow.md / docs/environment-setup.md
5. docs/acceptance-criteria.md / docs/implementation-status.md

## Claudeの開始
PowerShellで `Set-Location C:\dev\KanColleImprovementPlanner` の後に `claude.cmd` を実行し、docs/claude-start-prompt.txtを渡す。
公開先はGitHub Pagesに決定。GitHubリポジトリはhttps://github.com/otk-sudo/KanColleImprovementPlanner（公開）。技術推奨案はdocs/technology-selection.md。CreationLogのソース・Android設定は流用しない。

## UI設計
画面設計の初稿と要求対応：docs/ui-design-v1.md。Penpotで主要画面と状態を整理。現在の一覧はdocs/ui-reference/README.mdを参照。未確定事項と実装後の検証は同文書を参照。

## 図で読む基本設計
入口は docs/design/README.md。全体構成・データ・処理・保守と判断記録・UIレビューを分け、図と架空の具体例で説明。基本設計v1であり、未確定事項はdocs/design/04-maintenance.mdを参照。

Claude向け画面資料：[画面資料の索引](docs/ui-reference/README.md)。PNGと文言・配置JSONを同梱。PNGはローカル参照用でGit対象外。


## 内部処理の詳細設計
[計算・割当・日程](docs/design/09-planning-engine.md)、[実績・翌日処理・保存](docs/design/10-commands-and-persistence.md)、[数値例・22検証ケース](docs/design/11-processing-examples.md)。実装担当はこれらを画面仕様と併せて参照。


要求全件の監査状況は[design/16](docs/design/16-requirements-audit.md)、修正履歴は[design/15](docs/design/15-review-log.md)。画面は追加分を含め30件。

# Git・PR運用

CreationLogの現行CLAUDE.md/AGENTS.md/docs/development-workflow.mdを2026-10-14に参照し、Web向けに適用。

## ブランチと提出
- mainを基準。feature/<内容>、fix/<内容>、docs/<内容>等で作業し、mainへ直接pushしない。
- 公開履歴のmainが基準。Claudeの初回作業ブランチはfeature/implementation（origin追跡）。
- originはhttps://github.com/otk-sudo/KanColleImprovementPlanner.git。公開リポジトリ。
- status/diff確認後、対象ファイルを明示してstage。staged差分とgit diff --checkを確認。
- 日本語のコミットメッセージ。無関係な変更、private/の個人データ、秘密情報を含めない。
- remote設定後、許可された作業ではClaudeが実装/検証/PR作成/修正、Codexがレビュー。既存の同一head PRを更新する。
- 詳細操作は ~/.claude/skills/git/SKILL.md と references/pr-review.md を必要時に参照。Skillがない環境では本書を基準に不足手順を確認する。

## 段階
1. データ実例・マスター調査、技術選定、基本/詳細設計、実装環境。
2. インポート、保存、バックアップ、マスター照合。
3. 目標・在庫配分・素材製作・必要数計算。
4. 担当艦判定・予定配置・資材不足警告・翌日リスケ・実績。
5. PC画面・週月カレンダー・日別詳細・2経路のガイド。
6. 2経路の実データ通し検証、公開準備。公開操作は別途指示。
段階ごとにレビュー可能なPRへ分割。文書だけの変更に業務機能テストを捏造しない。

## 検証とマージゲート
- スタック決定後にbuild/typecheck/lintと単体・統合・ブラウザテストの実コマンドを環境文書に記載。
- PR本文に対象要求ID、base/head SHA、実行結果、未確認範囲を記録。
- Codex本人の最新head SHAに対する指摘なし結果が必要。無反応、Completed表示、Claudeの要約で代替しない。
- 実行されたSecurity Reviewの結果、必須チェック、未対応指摘・変更要求・未解決会話・競合を確認。
- レビュー後に追加コミットがあれば再レビュー。直前にheadを再取得。
- マージ許可が得られた場合は通常のsquash mergeに完全な --match-head-commit SHAを指定。
- --auto、--admin、force push、保護の迂回を使わない。破壊的操作・ブランチ削除を通常フローに含めない。
- CreationLog限定の追加確認不要マージ許可は未継承。本プロジェクトの許可がなければマージ準備完了の報告まで。
- merge/ビルド成功/無指摘と、ブラウザ実機検証・製品完成・公開を区別。
- mainにはPR必須・会話解消必須・管理者にも適用・強制push/削除禁止を設定済み。CIと必須ステータスチェックは未設定。GitHubの承認人数は0で、Codexの最新SHAレビューとユーザーのマージ許可は別途運用で確認する。

## 2026-10-14 公開リポジトリの初回push
ユーザーがotk-sudo/KanColleImprovementPlannerの公開作成とpushを承認。originは同URLに設定済み。公開用docs/public-designは、個人所持集計を含む旧ローカル履歴を親に持たない新規ルートから開始する。旧main/feature/implementationはローカル保存用であり、そのままpush・mergeしない。公開後の作業は公開ブランチを起点にする。mainへの直接push・マージ許可は今回含まれない。

## Claude Code開始環境（2026-10-14）
- GitHubのdefault branchはmain。公開済み設計コミットcc2cdc3から作成。
- カレントとpush先はfeature/implementation。PRのbaseはmain。通常のgit pushはこの作業ブランチへ送る。
- 旧ローカルmainとfeature/implementationはarchive/local-only-mainとarchive/local-only-implementationへ改名して保存。これらは個人集計を含む旧履歴であり、push/merge/公開ブランチへの取り込み禁止。git push --all/--mirrorは使用しない。
- docs/public-designは公開設計時点のブランチとして保持。今後の実装は新しいfeature/implementationで行う。
- PR統合はsquashのみ。自動マージ・保護回避は使わない。Codexレビューの自動起動・CIは今回未設定。

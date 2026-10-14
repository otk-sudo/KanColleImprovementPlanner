# Claude Code：艦これ改修スケジューラの製造担当

@AGENTS.md

## 最初に読む
README.md、docs/environment-setup.md、docs/development-workflow.md、docs/requirements.md、docs/data-research.md、docs/acceptance-criteria.md、docs/implementation-status.md。

## 進め方
- 要求・基本詳細設計・全34画面の参照資料がある。アプリが存在する前提で進めない。
- statusとブランチ、実ファイルを確認してから、依頼範囲に応じた実装計画を日本語で示す。
- 技術選定と基本・詳細設計を記録し、レビュー可能な段階で実装・検証する。
- 生データの取込実例を調べ、全装備・改修データの網羅性を検証してから完成を判断する。
- ユーザーのローカル所持JSONはprivate/にありGit対象外。公開サンプルに転用しない。
- 指摘対応の依頼では元のPR指摘を確認し、修正・テスト・許可範囲のpush/返信/再レビューまで進める。
- Webの技術スタックやテストコマンドはまだ選定していない。Android設定・Gradleコマンドを使わない。
- グローバルCLAUDE.md・permissions・hooks・モデルは変更しない。ローカルClaudeを自動起動しない。

## マージと公開
CreationLogの条件付きマージ許可は同リポジトリ限定だったため、本プロジェクトでは未付与。
マージ可能な品質基準はdocs/development-workflow.mdに従う。公開・リリース・リポジトリ作成は別途ユーザー指示の範囲で行う。

## 画面デザインを認識してから実装する
- 入口は docs/ui-reference/README.md。全34画面のPNGと同じIDのJSON（文言・座標・文字サイズ）がある。
- 対象画面のPNGを画像として開いて確認する。MarkdownやJSONだけで見た目を確認済みとしない。
- 動作は docs/requirements.md と docs/design/06-inventory-reconciliation.md、画面仕様は docs/ui-design-v1.md を照合する。特にJSONは最新在庫として扱う。
- 画像の数値・装備条件は架空例。未撮影のガイド枠を完成した実操作画像と扱わない。
- 実装後は同一状態・1440×940で画像比較し、画面IDごとに差異と未確認事項を報告する。
- PNGはこのPCのローカル参照用でGit対象外。別PCでは画像を別途受け渡す。配布用素材として自動転用しない。

## 内部処理を実装する前に読む
- docs/design/09-planning-engine.md、10-commands-and-persistence.md、11-processing-examples.mdを参照する。純粋な計算と保存操作を分離し、22ケースと不変条件を検証する。
- 既存の基本設計で未確定と記載された重複目標・同日工程・探索期間は09〜11で具体化済み。未調査のゲーム条件は推測せず、既知部分と分離する。


- 設計レビュー修正：docs/design/12-state-reconciliation.md と13-import-contracts.mdを読む。レビュー継続中の未完了項目を完成扱いにしない。

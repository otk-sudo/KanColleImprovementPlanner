# 検証の対応表（受入基準・処理例 → テスト）

2026-10-15。各行は「実行済みの自動テスト」「ローカル検証」「未実施」を区別する。自動テストの成功は架空データでの確認であり、実機・実データでの確認を意味しない。

## 受入基準（docs/acceptance-criteria.md）

| ID | 自動テスト（実行済み） | 未実施・残り |
|---|---|---|
| A01 | e2e/import.spec.ts「A01：…倍増しない」、parse.test.ts（簡易装備・slot_item）、apply.test.ts（P13/P16）。ローカル：private の実入力で独立集計と一致・再取り込みで倍増なし（work/a01.local.test.ts、Git 対象外） | — |
| A02 | e2e/import.spec.ts（資材だけの取り込み・74式EN ファイル・認証情報を受け付けない）、parse.test.ts（port・material・useitem・require_info・ラッパー） | 実ゲームの Chrome/Edge・74式EN の実レスポンスでの取り込み（利用者のゲーム環境が必要） |
| A03 | e2e/record.spec.ts「A03/A06」、index.test.ts（未収録を不可と断定しない） | — |
| A04 | plan.test.ts（P01〜P05、確実化 P35/P36）、index.test.ts（p1/p2/extra・更新） | 実マスターの全レシピを手計算と照合した記録はなし（網羅性は master:crosscheck で出典と一致を確認） |
| A05 | plan.test.ts（担当艦の改造段階違い・未所持・不明）、inventoryModel.test.ts | — |
| A06 | plan.test.ts（曜日・休み・上限・P06〜P08・P19）、e2e/record.spec.ts「A03/A06」 | — |
| A07 | rollover.test.ts、service.test.ts（P10・P23・P24・P42/P29）、e2e/record.spec.ts（日付変更後の繰越・スキップ・過去日の記録を未実施へ訂正した直後の繰越） | スリープ復帰の実機確認 |
| A08 | calendarModel.test.ts（P38）、画面比較 S01/S02/S18 | — |
| A09 | results.test.ts、projection.test.ts（P13〜P15・P45〜P47・P50）、service.test.ts（P12・P27・P47）、e2e/record.spec.ts（成功→失敗の訂正、確認待ち→未実施）、recordModel.test.ts（素材装備の★ごとの消費） | — |
| A10 | service.test.ts（P16・P17・P20・P33・P54・P55・P63〜P67）、backup.test.ts、masterLoader.test.ts（P34）、e2e/robustness.spec.ts（通知後も開いていた編集フォームは競合、削除済みの目標を復活させない）、e2e/record.spec.ts（同日の取り込みで確認待ちになった予定）、e2e/import.spec.ts（壊れたJSON） | — |
| A11 | e2e/layout.spec.ts（1280×720・1024×768・720×470 で横あふれなし、キーボード操作） | Windows の Chrome/Edge 実機での目視操作確認、2経路ガイドの実機手順検証 |
| A12 | 画面比較（画像あり条件 S03/S16/S22、ローカル専用画像）、GameImage の欠損時表示 | ゲーム画像の公開配布条件の確認。既定では画像を表示しない |
| A13 | e2e/layout.spec.ts（拡大画像を Esc で閉じる）、guide.capture.ts（アプリ画面の画像と注釈位置） | ゲーム側の操作（開発者ツール・74式EN の設定）の実機撮影。現在は「画像未取得」と表示 |

## 処理例（P番号 → テスト）

| P | テスト |
|---|---|
| P01〜P05 | plan.test.ts「完成品と改修対象の配分」「素材の製作と循環」 |
| P06〜P08 | plan.test.ts「日程配置と仮想在庫」 |
| P09・P11・P22・P25・P26 | plan.test.ts「当日の固定・スキップ・失敗」 |
| P10 | rollover.test.ts、service.test.ts（2タブ同時） |
| P12 | service.test.ts |
| P13〜P15 | projection.test.ts |
| P16・P17 | service.test.ts、apply.test.ts（P16） |
| P18・P48・P49 | results.test.ts |
| P19・P21 | plan.test.ts |
| P20・P32・P55 | service.test.ts（復元） |
| P23・P24・P27・P29・P41・P42 | service.test.ts |
| P28・P58 | projection.test.ts、apply.test.ts |
| P30 | service.test.ts（マスター更新後は確認待ち）、format.test.ts（記録時の名称） |
| P31 | backup.test.ts |
| P33・P43・P54 | service.test.ts |
| P34 | masterLoader.test.ts |
| P35〜P37 | plan.test.ts「確実化と完了予定」 |
| P38 | calendarModel.test.ts |
| P40・P52・P53 | apply.test.ts |
| P45〜P47・P50 | projection.test.ts、service.test.ts（P47）、recordModel.test.ts（P47/P50 の表示） |
| P51 | service.test.ts |
| P56・P57・P59〜P62 | parse.test.ts |
| P63〜P67 | service.test.ts |

不変条件（design/11「変えてはいけない不変条件」）：実在庫を計画・取消・スキップで変えない（e2e/record.spec.ts のスキップ、plan.test.ts の P09）、同じ数量枠の二重割当なし（P01〜P03、素材の仮想在庫を二重に引かない回帰テスト）、有効な次回試行は1つ（P10・P51）、不明を0として完了しない（plan.test.ts「不明と0の区別」）。

## PR #1 の Codex レビュー指摘への回帰テスト

| 指摘 | テスト |
|---|---|
| 下書きの確保分を差し引いて負在庫を判定 | results.test.ts「確認待ちの下書きが確保した既知消費を差し引いて判定する」、service.test.ts「レビュー指摘（PR #1）」 |
| 素材装備を★ごとに記録 | recordModel.test.ts「素材装備の★ごとの消費」 |
| 予定のレシピ候補で素材を展開 | plan.test.ts「レビュー指摘（PR #1）」 |
| 確認待ちの予定の結果を拒否 | service.test.ts「レビュー指摘（PR #1）」、e2e/record.spec.ts「同日の取り込みで確認待ちになった予定」 |
| 画面・フォームを開いた時点の版で確定 | e2e/robustness.spec.ts「先に開いた編集フォームの確定は競合」「削除した目標を…復活させない」 |
| 成功への訂正で後継の試行を整理 | service.test.ts「レビュー指摘（PR #1）」 |
| 過去日の未実施への訂正後に繰越 | e2e/record.spec.ts「過去日の記録を「実施していなかった」へ訂正すると…」 |
| 確認待ちの下書きがある間は後継を止める | plan.test.ts「レビュー指摘（PR #1）」（繰越後に元の試行を確認待ちで保存） |
| 入力元は実施日時より前の成功だけ | service.test.ts「レビュー指摘（PR #1）」 |
| 「対象だけを改修」を未選択と区別 | plan.test.ts「レビュー指摘（PR #1）」、goalModel.test.ts |

2回目のレビュー（head 6294151）への回帰テスト：

| 指摘 | テスト |
|---|---|
| 74式EN のファイル名で API が分かる空配列 | parse.test.ts「74式EN のファイル名で API が分かる空配列は…」 |
| 訂正時の日内順の比較 | results.test.ts「前提の成功を後続と同じ日へ動かすときは日内順も比べる」、service.test.ts「訂正で実施日を変えると…日内順を付け直す」 |
| 今日に固定した予定の担当艦の曜日 | plan.test.ts「今日に固定した予定でも、担当艦が今日の曜日に担当できなくなったら確認待ち」 |
| 担当艦の要求ごとの行 | inventoryModel.test.ts「同じ系統でも装備ごとに要求する改造段階が違えば…」 |
| 訂正時の入力元の再推定 | service.test.ts「消費を訂正すると入力元を推定し直す…」 |
| scope ごとの入力元 | apply.test.ts「複数の入力を反映すると、scope ごとに採用した入力の種類とハッシュを基準に記録する」 |
| 工程数の計算上限 | plan.test.ts「工程数が計算の上限に達したら…」 |
| 試行番号の数値順 | calendarModel.test.ts「試行が10回以上でも番号の数値で最新を選ぶ」 |

# Claude向け画面デザイン引き継ぎ

2026-10-14：ユーザーの指示により、現在のS01〜S34を画面レイアウトの実装基準として採用します。追加レイアウトの作成・改善はいったん止め、この資料で進めてください。

Penpotの34画面の文言・座標・文字サイズ・ボード寸法を取得し、既存JSONとの一致を確認して再保存しました。PNGは各画面の最終保存画像を維持し、34件の署名・寸法・SHA-256を再検査しています。今回全PNGを再出力したわけではなく、画像の全ピクセルとPenpotの再比較はしていません。検査範囲はexport-verification.jsonに記載。

## 読む順番

1. [要求](../requirements.md)と[在庫照合](../design/06-inventory-reconciliation.md)で動作を確認。
2. [画面仕様](../ui-design-v1.md)と[設計ガイド](../design/README.md)を参照。
3. 対象PNGを画像として開き、同じIDのJSONで文言・座標・文字サイズを確認。画像未閲覧を閲覧済みとしない。
4. 固定座標の模写ではなく、共通部品とPC幅への対応を実装する。実装後に同条件で画像比較する。

## 優先順位と注意

最新のユーザー指示 → 要求 → 詳細設計 → 画面仕様 → サンプル画像。現在レイアウトの採用は、未実装・実機未確認項目の完了承認ではありません。

- 確定したJSONは対象範囲の最新在庫。過去実績を二重減算しない。
- 不足は警告付き仮配置。遅延の自動リスケは日本時間の翌日以降。スキップは無消費。
- 数値・装備条件は架空例。実マスターや個人データとして扱わない。
- 画像はローカル参照用。ゲーム画像の公開配布条件は未確認。PNGはGit対象外。
- 74式EN/KC3Kaiなどの参照ソースはローカルコピーも読み取り専用。

## 全34画面

| 画面 | 画像 | 文言・配置 |
|---|---|---|
| S01 カレンダー | [PNG](screens/S01.png) | [JSON](screens/S01.json) |
| S02 週間予定 | [PNG](screens/S02.png) | [JSON](screens/S02.json) |
| S03 改修目標 | [PNG](screens/S03.png) | [JSON](screens/S03.json) |
| S04 目標を追加 | [PNG](screens/S04.png) | [JSON](screens/S04.json) |
| S05 必要素材 | [PNG](screens/S05.png) | [JSON](screens/S05.json) |
| S06 所持データ | [PNG](screens/S06.png) | [JSON](screens/S06.json) |
| S07 データ取り込み | [PNG](screens/S07.png) | [JSON](screens/S07.json) |
| S08 74式ENから取り込む | [PNG](screens/S08.png) | [JSON](screens/S08.json) |
| S09 実績・繰り越し | [PNG](screens/S09.png) | [JSON](screens/S09.json) |
| S10 予定と保存の設定 | [PNG](screens/S10.png) | [JSON](screens/S10.json) |
| S11 取り込みガイド | [PNG](screens/S11.png) | [JSON](screens/S11.json) |
| S12 74式ENの取り込みガイド | [PNG](screens/S12.png) | [JSON](screens/S12.json) |
| S13 改修結果を記録 | [PNG](screens/S13.png) | [JSON](screens/S13.json) |
| S14 配置できない予定 | [PNG](screens/S14.png) | [JSON](screens/S14.json) |
| S15 はじめての改修計画 | [PNG](screens/S15.png) | [JSON](screens/S15.json) |
| S16 所持艦娘 | [PNG](screens/S16.png) | [JSON](screens/S16.json) |
| S17 資材・アイテム | [PNG](screens/S17.png) | [JSON](screens/S17.json) |
| S18 日付を指定して確認 | [PNG](screens/S18.png) | [JSON](screens/S18.json) |
| S19 工程と改修条件 | [PNG](screens/S19.png) | [JSON](screens/S19.json) |
| S20 取り込みエラー | [PNG](screens/S20.png) | [JSON](screens/S20.json) |
| S21 バックアップを復元 | [PNG](screens/S21.png) | [JSON](screens/S21.json) |
| S22 画像付きの装備・担当艦表示 | [PNG](screens/S22.png) | [JSON](screens/S22.json) |
| S23 画像でわかるJSONの反映手順 | [PNG](screens/S23.png) | [JSON](screens/S23.json) |
| S24 この改修をスキップ | [PNG](screens/S24.png) | [JSON](screens/S24.json) |
| S25 この日の予定をスキップ | [PNG](screens/S25.png) | [JSON](screens/S25.json) |
| S26 装備データだけを更新 | [PNG](screens/S26.png) | [JSON](screens/S26.json) |
| S27 最新の所持データを反映 | [PNG](screens/S27.png) | [JSON](screens/S27.json) |
| S28 実施済み・消費確認待ち | [PNG](screens/S28.png) | [JSON](screens/S28.json) |
| S29 過去の記録と後続予定を確認 | [PNG](screens/S29.png) | [JSON](screens/S29.json) |
| S30 前提工程を確認 | [PNG](screens/S30.png) | [JSON](screens/S30.json) |
| S31 確認待ちの記録を訂正 | [PNG](screens/S31.png) | [JSON](screens/S31.json) |
| S32 マスター不足のバックアップを復元 | [PNG](screens/S32.png) | [JSON](screens/S32.json) |
| S33 保護設定を確認 | [PNG](screens/S33.png) | [JSON](screens/S33.json) |
| S34 過去の実績と所持数への反映 | [PNG](screens/S34.png) | [JSON](screens/S34.json) |

## 画面例にない動作

画面追加の前提条件にはせず、既存の詳細設計に従ってClaudeが実装・検証します。個体/集計保護、過去実績の全回答状態、担当艦候補、PCの狭い幅、復元完了までの分岐は文章仕様も参照してください。

S06→S33の保護確認は配線確認済み。S34は未回答例であり選択操作・全回答状態・S13起点の配線は未作成。S34→S28は機能参照で、成功をS28の架空失敗へ変換する仕様ではありません。S32も復元完了までの配線は未作成。プロトタイプ配線不足をアプリの動作省略に使わないでください。

実機ガイドの撮影枠は未撮影です。全件マスター、useitem省略規則、失敗時消費、実画像配布条件は[現在状況](../implementation-status.md)で追跡します。

[Penpot原本](https://design.penpot.app/#/workspace?team-id=52a5041f-08a1-80f1-8008-c8b9b8bfc24e&file-id=52a5041f-08a1-80f1-8008-c8bbdc5cee0a&page-id=52a5041f-08a1-80f1-8008-c8bbdc5cee0b)

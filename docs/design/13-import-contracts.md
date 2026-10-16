# 13 入力形式と更新範囲の契約

2026-10-14。R03〜R06。2つの取込経路は同じ正規化器へ渡す。以下は固定版の参照ソース確認に基づく設計で、実機検証完了を意味しない。

## 対応入力

| 形式・API | 必須の読取項目 | 更新範囲 |
|---|---|---|
| 簡易装備配列 | 各要素id=装備マスターID、lv=★ | equipment全件。重複行は別個体相当の数量として集計 |
| api_get_member/slot_item | api_data配列のapi_id=個体ID、api_slotitem_id=装備マスターID、api_level=★ | equipment全件。個体ID重複は拒否 |
| api_port/port | api_data.api_shipのapi_id=個体ID、api_ship_id=艦娘マスターID。api_data.api_materialのapi_id/api_value | ships全件＋提供resource ID。艦娘改造状態はマスターIDから照合 |
| api_get_member/material | api_data配列のapi_id/api_value | 提供resource IDのみ。配列の順番に依存しない |
| api_get_member/useitem | api_data配列のapi_id/api_count | item一覧。省略IDとnullの扱いは次項 |
| api_get_member/require_info（2026-10-15追加） | api_data.api_slot_itemの個体一覧（slot_itemと同じ項目）、api_data.api_useitemのapi_id/api_count | equipment全件＋提供item IDのみ。api_useitemが欠落・nullなら装備だけ更新。アイテムは配列にあるIDだけ（useitemと同じ規則） |

api_get_member/ship2、ship3、ship_deck、改修結果単体は、初期の所持全件取込に採用しない。レスポンス単体で全件性を証明できないものは「母港レスポンスを取得してください」と案内。未対応APIの取込で既存在庫を消さない。

参照実装のuseitemは一覧をclear後に登録しnullも許容する。ただし本アプリではnullの実レスポンス検証前に全件0と推定しない。初期契約は配列にあるIDだけ最新値へ更新し、欠落IDは保持して「今回未取得」と表示する。全件省略=0が実レスポンスで確認されるまでは、取り込み後に不明/残存値があることを警告し、全アイテム最新確認済みと表示しない。nullは判定不能として反映不可。これは調査待ちであり、全アイテム対応完了の根拠にはしない。

## 形式判定と入力制限

成功応答のラッパーはapi_result=1とapi_dataを検証する。svdata=は先頭1回のみ許可、UTF-8 BOMは先頭のみ除く。api_dataを既に切り出した本文は種類が一意に識別できる場合だけ採用し、空配列など曖昧な入力はAPI種類の指定を求める。API指定があっても中身の必須項目検証を省略しない。

初期の上限案は1ファイル20MiB、1回20ファイル・合計50MiB、JSON深さ64、装備/艦娘各100,000行。UTF-8のバイト長で検査し、取り込み前に上限を表示。現実の最大レスポンス測定後に見直す。巨大な入力を無制限にJSON.parseしない。実装時には深さ判定もメイン画面を長時間停止させない方式を選ぶ。

ID・数量・★に文字列の暗黙数値変換はしない。整数範囲外・負数・NaN相当は拒否。未知マスターIDは数値IDと数量を保持し、既知の装備名へ代用しない。不要フィールドは許可リスト方式で捨て、提督名・認証情報・レスポンス原文を永続保存しない。

複数入力でscopeが重なる場合はファイル名・種類・件数・変更数を並べ、各scopeに採用する入力を1つ選ぶ。ファイル日時で自動優先しない。採用した入力を最新として扱う。誤ったファイルがある場合は全体未保存で止め、明示的にそのファイルを除外して再確認後に残りだけ反映できる。1回の確定では選択scopeを原子的に反映する。

## 確認したソース

参照版：ElectronicObserverEN/ElectronicObserver、5.4.3、commit 9a61d31c4ec574342f23a306aad47f9d3af769e3。参照ソースは一切変更していない。

- [slot_item](https://github.com/ElectronicObserverEN/ElectronicObserver/blob/9a61d31c4ec574342f23a306aad47f9d3af769e3/ElectronicObserver/Observer/kcsapi/api_get_member/slot_item.cs)：装備一覧置換。
- [port](https://github.com/ElectronicObserverEN/ElectronicObserver/blob/9a61d31c4ec574342f23a306aad47f9d3af769e3/ElectronicObserver/Observer/kcsapi/api_port/port.cs)：艦娘全件と資材。
- [ship2](https://github.com/ElectronicObserverEN/ElectronicObserver/blob/9a61d31c4ec574342f23a306aad47f9d3af769e3/ElectronicObserver/Observer/kcsapi/api_get_member/ship2.cs)、[ship3](https://github.com/ElectronicObserverEN/ElectronicObserver/blob/9a61d31c4ec574342f23a306aad47f9d3af769e3/ElectronicObserver/Observer/kcsapi/api_get_member/ship3.cs)：全件/部分を混同しない根拠。
- [useitem](https://github.com/ElectronicObserverEN/ElectronicObserver/blob/9a61d31c4ec574342f23a306aad47f9d3af769e3/ElectronicObserver/Observer/kcsapi/api_get_member/useitem.cs)：一覧とnullの扱い。
- 同版Data/EquipmentData.cs、ShipData.cs、UseItem.csのプロパティでID・改修値・数量の対応を確認。MaterialData.csで8種の資材の対応を確認。
- （2026-10-15）同版 api_get_member/require_info.cs：api_slot_item で装備一覧を置換し、api_useitem でアイテムを更新する実装を確認。実ゲーム応答での確認は未実施。

## 残る実データ確認

実機2経路の対応入力、useitemの0件/省略/null、最大サイズ、古い/異なる形の失敗メッセージを確認する。確認までは調査未完了として残す。合成データだけでA02完了にしない。

## 空・欠落・重複の決定表（レビュー第9巡）

2026-10-14に上記固定commitのuseitem.csとData/UseItem.csを再取得し、一覧clear・null時の登録省略・api_count読取を再確認した。これはクライアント実装の証拠であり、ゲーム応答の省略仕様を証明しない。省略=0は引き続き未確認。

| 入力 | 判定 | 保存する範囲 |
|---|---|---|
| 種類未指定の空配列 | 装備/資材/アイテムを区別不能。種類選択まで確定不可 | なし |
| slot_itemまたは簡易装備と明示された空配列 | 全装備0件の置換として差分確認。既存装備が消えることを件数表示 | equipment全件 |
| materialの空配列 | 提供IDがない。「更新対象なし」。成功取込として鮮度を更新しない | なし |
| useitemの空配列 | 提供IDがない。「更新対象なし」。全アイテム0とは扱わない | なし |
| useitemのnull | 意味未確認のため反映不可 | なし |
| api_count/api_valueが明示0 | 有効な既知0として取り込む | 該当ID |
| 数量フィールド欠落/null | 不正。0へ変換しない | 選択バッチを未保存で停止 |
| material/useitemで同じIDが複数 | 同値でも拒否。先勝ち・後勝ち・合算をしない | 選択バッチを未保存で停止 |
| slot_item/port.api_shipで個体ID重複 | 拒否。マスターIDの重複とは区別 | 選択バッチを未保存で停止 |
| 簡易装備で同じid/lvが複数 | 正常。各行を1個として集計 | equipment全件 |
| portにapi_shipまたはapi_material欠落/null | 対応portスナップショットとして不正。欠落を空一覧扱いしない | 選択バッチを未保存で停止 |

portの必須配列が存在する場合、空のapi_shipは全艦娘0件として差分確認する。空のapi_materialは資材の更新なし。異常に見える0件を黙って削除反映せず、変更前後を確認させるが、利用者が確定した正当な空入力の反映を恣意的に禁止しない。

同一IDでもresource:5とitem:5は別scope。1ファイル内の重複拒否と、複数ファイル間の同scope競合選択は別の処理。後者は既定の採用入力選択を使う。

更新scopeが0件なら、新snapshot・在庫revision・includedThroughSequence・includedDraftIdsを変更しない。再計算も要求しない。「0件の最新状態で置換」と「更新対象がない」をUIと処理結果で区別する。バッチ中に更新scopeを持つ別入力があれば、その範囲だけを通常の原子的反映へ渡す。

未提供IDは前回値・前回取得日時・現在の実績投影を維持し、今回取得済みとは表示しない。前回値がなければ不明のまま。省略されたIDに0を作らず、境界も進めない。

### 検証ケース
| ID | 入力と前提 | 期待 |
|---|---|---|
| P56 | 装備あり、種類不明の[] | 未反映、種類指定を要求 |
| P57 | 装備あり、slot_itemと指定した[]を確認確定 | equipmentを0件へ置換。資材は保持 |
| P58 | ネジ10から実績4消費、material=[] | 残数6、基準境界不変。実績を包含して10へ戻さない |
| P59 | item:1=5、useitemにitem:2=0だけ | item:1は旧値/日時維持、item:2は既知0 |
| P60 | materialに同ID同値の2行 | 拒否。部分保存なし |
| P61 | 簡易装備id/lvが同一の2行 | 2個。重複IDエラーにしない |
| P62 | portのapi_ship欠落 | 拒否。艦娘全消去も資材だけの部分反映もしない |

これらは入力契約の設計例。実レスポンス・ブラウザでの実行テストは未実施。

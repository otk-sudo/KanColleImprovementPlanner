# データ調査と残課題

## 入力の確認済み事項
private/equipment-input.jsonはユーザー提供のid/lv配列。個人の所持数・集計値は公開資料に含めない。
所持品のスナップショットであり、全装備マスターではない。個体識別・ロック・艦娘・資材数を含まない。

## 参照候補（調査しただけで採用・網羅性保証ではない）
- 装備マスター：https://raw.githubusercontent.com/Tibowl/api_start2/master/parsed/api_mst_slotitem.json
- 改修条件：https://wikiwiki.jp/kancolle/改修表
- API資料：https://github.com/andanteyk/ElectronicObserver/blob/develop/ElectronicObserver/Other/Information/apilist.txt
- 74式ENの設定実装：https://github.com/ElectronicObserverEN/ElectronicObserver/blob/main/ElectronicObserver/Utility/Configuration.cs
- Chromeのレスポンスコピー：https://developer.chrome.com/docs/devtools/network/reference

api_get_member/materialはapi_id/api_value。資料上ID1〜8は燃料、弾薬、鋼材、ボーキ、高速建造材、高速修復材、開発資材、改修資材。
api_get_member/useitemはapi_id/api_count。装備や艦娘とは名前空間が異なる。
74式EN公開コードでSaveReceivedData/SaveDataPath/SaveResponseの存在と既定パスKCAPIを確認。利用者の実バージョンの画面・ファイル形式は未検証。
通常ブラウザはCopy responseを利用。Copy as cURLやリクエストの認証トークンは不要。

## 共通マスターの出典と網羅性検証（2026-10-14〜15、実装時）

採用した出典は commit と SHA-256 で固定し、内容が一致しなければ生成を中止する（scripts/build-master.mjs）。

| 出典 | commit | 用途 | 配布条件 |
|---|---|---|---|
| Tibowl/api_start2 start2.json | 23637be57ac23a7b4281f193b836fa568ead8ee4 | 装備・艦娘（改造系統）・アイテムのマスター | 未確認（ライセンス表記なし） |
| ElectronicObserverEN/Data EquipmentUpgrades.json | 1a72dff0ec6658e09730335895af5f404ff76d22 | 改修レシピ（担当艦・曜日・段階別費用・更新・確実化） | 未確認（ライセンス表記なし） |

- 生成物 public/master/ は配布条件が未確認のため Git に含めない。公開（GitHub Pages）は配布条件の確認後（docs/release.md）。
- 出典の意味づけは 74式EN 5.4.3 の固定版ソースで確認：曜日は C# DayOfWeek（0=日）、p1 は到達★1〜6、p2 は★7〜10、conv は更新、extra は段階別の追加費用、*_sli は確実化。担当艦のない4件（装備ID 2, 4, 14, 44）は出典に担当艦・曜日がなく、画面では「条件未確認」として改修不可と扱わない。
- `npm run master:crosscheck` の結果（2026-10-15）：装備584・艦娘866・アイテム105は出典のプレイヤー用全件と一致。改修できる装備374・改修エントリ414は出典と一致。担当艦・更新先・素材・アイテムの参照先の欠落なし。
- 独立資料との照合：攻略Wikiの改修表（手元に保存したHTML、配布しない）の装備アンカー370件と比較し、Wiki にないのは 38, 425, 518, 546 の4件。518 は Wiki 上で別アンカー（id407）の表に記載されている。Wiki にだけある装備はなし。Wiki で担当艦「-」の装備（2, 4, 14, 44）は上記の担当艦なし4件と一致。
- 失敗時の消費：出典に失敗時の費用はない。アプリは失敗の実消費を利用者が入力し、成功時の費用を写さない（design/10）。ゲームの失敗消費規則そのものは未調査。

## 公開準備での更新・全段階照合（2026-10-17）

- 参照元の対象ファイルの最新コミットをGitHub APIで再取得。start2.json は既存の `23637be…` と一致。EquipmentUpgrades.json は `1a72dff0ec6658e09730335895af5f404ff76d22`（2026-10-15T16:28:26Z）へ更新されていたため、旧 `f9a1326…` からの差分を確認して採用した。
- 追加・変更は装備373/584のレシピ、更新分岐、担当艦曜日、通常/確実化費用、到達★ごとの追加アイテム等。更新元は読み取り専用で取得し、キャッシュは取得した原本のまま保持。SHA-256は `687BD08FF5D25277F27EB9BA38ABC79C5AD8998C8F0E226ED2D0945F79A503A2`。
- 生成・網羅性検証：装備584、艦娘866、アイテム105、改修対象376、改修エントリ417。出典との件数一致と参照先欠落なしを確認。上記2026-10-15の374対象/414エントリは旧版の検証記録として残す。
- `tests/real-master.test.ts` は、元のEquipmentUpgrades.jsonから独立集計した全エントリの期待値と、アプリの★1〜10・更新の費用・素材・アイテム・担当曜日を比較する。アプリの費用計算・生成関数を期待値の生成に使わない。ゲーム自体の正しさ、全件手計算、公開許諾の証拠にはしない。
- 両出典リポジトリのメタデータで `license: null` を再確認した。公開リポジトリで閲覧可能なことを再配布許諾と解釈せず、公開条件は未確認を維持する。確認先：[api_start2](https://github.com/Tibowl/api_start2)、[Data](https://github.com/ElectronicObserverEN/Data)。参照元への問い合わせや投稿は行っていない。

## 入力の取り込み実例（2026-10-15）

- A01（ローカル検証、work/a01.local.test.ts・Git 対象外）：private/equipment-input.json を、アプリのパーサーを使わない独立集計と比べ、★別の個数・総数・種類数がすべて一致。マスターにない装備IDは0種類。同じ入力の再取り込みで基準は同じ内容のまま（倍増なし）。個人の数値は記録しない。
- api_get_member/require_info に対応（design/13）：api_slot_item を装備全件、api_useitem を提供IDのアイテムとして読む。74式EN の require_info.cs で項目名を確認。実ゲームの応答での確認は未実施。
- 2経路（Chrome/Edge の Copy response、74式EN の保存ファイル）の実レスポンスでの取り込みは、利用者のゲーム環境が必要なため未実施。

## 必須の追加調査
- プレイヤー用全装備の網羅性、新装備、敵装備/未使用レコード除外、出典更新日、配布条件。
- 全段階の改修/更新/担当艦/曜日/消費の整合と通常失敗時の消費。資料間不一致を記録。
- 艦娘取り込みの正確なレスポンス種別と改造状態、2経路の資材/アイテム実例。
- 74式ENの保存ファイル名・エンコーディング・svdata=等のラッパー、画面操作で通信が発生する条件。
- 実機検証した手順のみガイドに確定記載。コピーしたJSON/保存ファイルはコードとして実行しない。
- 部分取込、全件取込、null、空配列、未知ID、データ鮮度、同種ファイル複数の扱いを設計する。
- 実データをリポジトリへ登録せず、テストには必要最小限の合成データを使う。

従前の調査でraw GitHubのシェル取得がDNS失敗した。Web閲覧で存在確認したのみで、全件取得・照合済みではない。

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

## 必須の追加調査
- プレイヤー用全装備の網羅性、新装備、敵装備/未使用レコード除外、出典更新日、配布条件。
- 全段階の改修/更新/担当艦/曜日/消費の整合と通常失敗時の消費。資料間不一致を記録。
- 艦娘取り込みの正確なレスポンス種別と改造状態、2経路の資材/アイテム実例。
- 74式ENの保存ファイル名・エンコーディング・svdata=等のラッパー、画面操作で通信が発生する条件。
- 実機検証した手順のみガイドに確定記載。コピーしたJSON/保存ファイルはコードとして実行しない。
- 部分取込、全件取込、null、空配列、未知ID、データ鮮度、同種ファイル複数の扱いを設計する。
- 実データをリポジトリへ登録せず、テストには必要最小限の合成データを使う。

従前の調査でraw GitHubのシェル取得がDNS失敗した。Web閲覧で存在確認したのみで、全件取得・照合済みではない。

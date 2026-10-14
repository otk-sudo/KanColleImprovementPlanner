# 技術選定案（2026-10-14）

状態：GitHub Pages公開はユーザー合意済み。以下の言語・ライブラリは推奨案で、導入・互換性検証は未実施。製造はClaude担当。

## 推奨構成

| 領域 | 推奨 | 理由 |
| --- | --- | --- |
| 言語 | TypeScript（strict） | 装備/艦娘/資材の型を分け、改修計算と取り込みの間違いを検出しやすい |
| 画面 | React | カレンダー、在庫、目標、日別詳細を再利用可能な部品として構成 |
| 開発・ビルド | Vite | GitHub Pagesへ静的ビルドを配布できる |
| UI部品 | Material UIの基本コンポーネント＋テーマ/CSS | PC向けフォーム、テーブル、警告、ダイアログを統一。MUI X有償機能は前提にしない |
| カレンダー | FullCalendar標準版のReact連携 | 月dayGridMonth、週dayGridWeek、日付選択。時間帯指定は要求外なので時刻軸を基本としない |
| 保存 | IndexedDB＋Dexie、dexie-react-hooks | 所持情報・目標・実績・設定を保存し、トランザクションとスキーマ移行を管理 |
| 入力検証 | Zod | 外部JSON、公開マスター、バックアップを実行時に検証。TypeScriptだけでは外部データ検証にならない |
| 日付 | Day.js（UTC/timezoneプラグイン） | 日本時間を明示して日付境界を扱う。日付のみはYYYY-MM-DD、取得時刻はUTCで区別 |
| 画面遷移 | React RouterのHashRouter | Pages上の深いURLを再読込してもサーバーのSPA書換えに依存しない |
| 計算 | UI/DBに依存しないTypeScriptの関数 | 在庫配分、工程、スケジュール、遅延処理を独立して検証 |
| テスト | Vitest＋Playwright | 計算/取込の単体テストと、ブラウザの保存/画面/リスケの通し検証 |
| 依存管理 | npm＋package-lock.json | ローカルとCIでnpm ciを使い再現可能にする |
| 公開 | GitHub Pages＋GitHub Actions | ビルド済みdistだけ配布。サーバー処理、ログイン、クラウドDBを設けない |

## 比較した選択肢
- JavaScriptのみ：初期導入は軽いが、複数のID体系・状態・改修分岐の保守を考えTypeScriptを推奨。
- Vue：同じ要件を実現できる代替案。今回Reactを第一候補にする理由はUI/カレンダー/保存の連携を揃えやすいためで、Vueでは不可能という意味ではない。
- Next.js：静的出力は可能だが、今回SSR/サーバー機能を必要とせずViteで十分。
- 自作カレンダー：曜日/月境界/選択/表示の独自実装を増やすため、標準版FullCalendarを優先。
- localStorageのみ：設定程度には使えるが、所持データ・実績の一括変更にはIndexedDBを採用する案。
- クラウドDB、常駐バックエンド、大規模な状態管理ライブラリ：現要件では初期導入しない。DBを永続データの正本とし、選択日やダイアログ状態はReact内に置く。

## 設計上の条件
1. DB名にプロジェクト固有名を使う。GitHub Pagesは同じユーザーの複数サイトが同一originになるため、他アプリと名前を衝突させない。
2. IndexedDBはサーバーバックアップではない。消去/容量不足を扱い、JSONバックアップとスキーマ移行を用意。ブラウザを替えても共有されない。
3. リスケはJSTの翌日判定。起動・フォーカス復帰・日付変更時に判定し、閉じている間に実行されたと表示しない。
4. リスケの処理済み日/計画版をトランザクション内で確認し、複数タブによる二重処理を防ぐ。単なるタイマーだけに依存しない。
5. 資材不足は警告付き仮配置。未所持担当艦や未確認条件は未配置として区別。
6. 2経路の取り込みアダプターから共通スキーマへ変換し、全件検証後に保存。保存前に読込件数と変更内容を確認できるようにする。
7. マスターは出典・確認日・版付きJSONとしてビルドに同梱する案。利用者のブラウザでWikiを直接スクレイピングしない。取得・整形は開発時の別工程にする。
8. 個人データをGit、Actionsログ、配布distへ含めない。生レスポンスは必要データだけ抽出し原則永続化しない。
9. FullCalendarは表示部品。素材・日程の計算をライブラリへ委ねず、日付文字列とall-day予定を渡す。Premiumの資源タイムラインは不要。
10. Pagesの公開サブパスにViteのbaseを合わせる。公開URL決定後にassets/JSON/ガイド/ハッシュURLを実機確認。
11. 公開マスターの参照整合・配布条件・最新性はライブラリ導入では解決しない。引き続き独立した調査必須。
12. 最初からService Workerは導入しない。古いマスター/アプリの混在を防ぐ更新設計を先に行う。

## バージョンと導入
- 現在はパッケージ未導入。正確な版の組合せはClaudeが導入時の安定版・Node対応・peer dependency・ライセンスを確認し固定する。
- Nodeは採用Vite/Vitest等がサポートするLTSを選びローカルとCIで揃える。最新版という理由だけでプレリリースを使わない。
- FullCalendarは標準版の同一互換系列で揃える。公式ドキュメントの版とインストール版でimport/APIを照合。
- 公開サイト構築前にtypecheck、build、test、test:e2e等のコマンドを定義し、実行した結果だけ記録。
- CIはPRで型・ビルド・必要テスト、公開は最初は手動起動のActions案。mainへのmergeが常に公開を意味する運用にはまだしない。
- この文書は技術選定案。実装・依存インストール・Actions設定・公開は今回行わない。

## 公式資料（2026-10-14閲覧）
- Vite/Pages：https://vite.dev/guide/static-deploy.html
- React連携：https://fullcalendar.io/docs/react
- カレンダー標準機能：https://fullcalendar.io/docs/plugin-index
- Premiumの区別：https://fullcalendar.io/docs/premium
- Dexie/React：https://dexie.org/docs/Tutorial/React
- 入力検証：https://zod.dev/
- UI：https://mui.com/material-ui/
- 日本時間処理：https://day.js.org/docs/en/plugin/timezone
- ハッシュルーター：https://reactrouter.com/api/declarative-routers/HashRouter
- 単体テスト：https://vitest.dev/guide/
- ブラウザテスト：https://playwright.dev/docs/writing-tests

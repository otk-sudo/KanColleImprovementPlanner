// 取り込みガイドの内容（R06・R23）。実機で確認していない操作は「未撮影」と明示し、架空の実画面で代用しない。
// アプリ画面の画像（public/guide）と注釈枠の位置は e2e/guide.capture.ts で架空データから撮影・算出したもの。
// 74式EN 5.4.3 の設定名・保存形式はソース確認済み（design/07）。Chrome/Edge の操作は公式資料に基づく構成。

export type GuideEnv = 'browser' | '74en';

export interface Annotation {
  n: number;
  /** 画像に対する割合（0〜1） */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideStep {
  title: string;
  desc: string;
  image: { src: string; alt: string; annotations: Annotation[]; source: string } | null;
  checks: { title: string; desc: string }[];
}

export const CONFIRMED = {
  browser: { target: 'Chrome・Edge', checkedAt: '2026-10-14', state: '実機の操作画像は未撮影（公式資料に基づく手順）' },
  '74en': { target: '74式EN 5.4.3', checkedAt: '2026-10-14', state: 'ソース確認済み・実機の操作画像は確認待ち' },
} as const;

export const OVERVIEW: Record<GuideEnv, { title: string; desc: string }[]> = {
  browser: [
    { title: 'ゲーム画面で開発者ツールを開く', desc: 'F12 または Ctrl+Shift+I で開き、Network（ネットワーク）で通信内容を確認できる状態にします。' },
    { title: '必要なデータのレスポンスを表示する', desc: '装備・艦娘・資材など、取り込みたい種類の通信（api_port/port、slot_item など）を選びます。' },
    { title: 'レスポンス本文をコピーする', desc: 'リクエスト情報や Cookie ではなく、レスポンス本文を使用します（右クリック → Copy → Copy response）。' },
    { title: 'アプリに貼り付けて内容を確認する', desc: '検出した種類と更新件数を確認してから反映します。' },
  ],
  '74en': [
    { title: '接続設定で Save API data と Response を有効にする', desc: '保存場所を確認します。Request の保存は、このアプリには不要です。' },
    { title: '必要なデータを取得してファイルを保存する', desc: 'S@ を含む .json がレスポンスです。ファイル名と本文の種類を確認します。' },
    { title: 'ファイルをアプリに渡す', desc: 'ファイルを選ぶか、取り込み欄にドラッグ＆ドロップします。' },
    { title: '差分を確認して反映する', desc: '日時・種類・件数を確認します。取り込まない種類のデータは保持します。' },
  ],
};

const APP_SOURCE = 'このアプリの画面（架空のテストデータで撮影）';

export const STEPS: Record<GuideEnv, GuideStep[]> = {
  browser: [
    {
      title: 'ゲーム画面で開発者ツールを開く',
      desc: 'F12 または Ctrl+Shift+I。Network を選び、Fetch/XHR で絞り込みます。',
      image: null,
      checks: [
        { title: 'Network タブ', desc: '通信の一覧が表示されることを確認します。' },
        { title: '記録中', desc: '記録が止まっていると通信が表示されません。' },
        { title: '個人情報', desc: 'Cookie・トークンはコピーしません。' },
      ],
    },
    {
      title: 'レスポンス本文をコピーする',
      desc: '母港へ戻るなどで通信を発生させ、対象の行を選んで Response をコピーします。',
      image: null,
      checks: [
        { title: '対象の行', desc: 'api_port/port（艦娘・資材）、slot_item（装備）などを選びます。' },
        { title: 'レスポンス', desc: 'Headers や Payload ではなく Response を使います。' },
        { title: 'コピー', desc: '右クリック → Copy → Copy response。' },
      ],
    },
    {
      title: '取り込む内容を確認する',
      desc: '貼り付けて「内容を確認」を押すと、種類と更新内容を表示します。まだ保存しません。',
      image: {
        src: 'guide/browser-03-preview.png',
        alt: '取り込み内容の確認画面。装備を今回のJSONで置き換え、艦娘と資材は変更しないと表示されている',
        annotations: [
          { n: 1, x: 0.008, y: 0.143, w: 0.97, h: 0.103 },
          { n: 2, x: 0.008, y: 0.258, w: 0.97, h: 0.436 },
          { n: 3, x: 0.695, y: 0.9, w: 0.283, h: 0.063 },
        ],
        source: APP_SOURCE,
      },
      checks: [
        { title: 'データの種類', desc: '装備・艦娘・資材のどれが検出されたか確認します。' },
        { title: '更新内容と取得日時', desc: '今回の数量で置き換えます。含まれない種類は保持します。' },
        { title: '反映するボタン', desc: '反映後は件数・更新日時・不足数の変化を確認します。' },
      ],
    },
    {
      title: '反映して所持数を確認する',
      desc: '「最新の所持データとして反映」を押すと保存し、所持データの画面に移ります。',
      image: {
        src: 'guide/browser-04-confirm.png',
        alt: '最新の所持データを反映する確認画面。反映後の個数と保持するものが表示されている',
        annotations: [
          { n: 1, x: 0.008, y: 0.143, w: 0.97, h: 0.268 },
          { n: 2, x: 0.008, y: 0.425, w: 0.97, h: 0.347 },
          { n: 3, x: 0.679, y: 0.883, w: 0.3, h: 0.063 },
        ],
        source: APP_SOURCE,
      },
      checks: [
        { title: '反映後の数', desc: 'JSONの数量がそのまま最新の所持数になります。' },
        { title: '保持するもの', desc: '今回含まれない種類と、実績・目標・保護設定は残ります。' },
        { title: '反映', desc: '保存が終わると「✓ 保存済み」に戻ります。' },
      ],
    },
  ],
  '74en': [
    {
      title: '接続設定で保存を有効にする',
      desc: '設定 → 接続（Connection）で Save API data と Response を有効にし、保存場所を確認します。',
      image: null,
      checks: [
        { title: 'Save API data', desc: 'API データの保存を有効にします。' },
        { title: 'Response', desc: 'レスポンスを保存します。Request は不要です。' },
        { title: '保存場所', desc: '画面に表示された保存先を確認します（固定のフォルダとは限りません）。' },
      ],
    },
    {
      title: '保存されたファイルを確認する',
      desc: 'ファイル名に S@ と API 名を含む .json がレスポンスです。Q@ はリクエストなので使いません。',
      image: null,
      checks: [
        { title: 'S@ ファイル', desc: '例：…S@api_port@port.json（艦娘・資材）。' },
        { title: '種類', desc: 'slot_item（装備）、material（資材）、useitem（アイテム）。' },
        { title: '新しさ', desc: '取り込んだ内容を最新として扱います。' },
      ],
    },
    {
      title: 'ファイルを選んで内容を確認する',
      desc: '「ファイルを選ぶ」かドラッグ＆ドロップ。種類と反映後の数量を表示します。',
      image: {
        src: 'guide/74en-03-preview.png',
        alt: '74式ENのファイルを読み込んだ後の更新内容のプレビュー',
        annotations: [
          { n: 1, x: 0.028, y: 0.693, w: 0.93, h: 0.043 },
          { n: 2, x: 0.028, y: 0.752, w: 0.93, h: 0.043 },
          { n: 3, x: 0.755, y: 0.894, w: 0.204, h: 0.063 },
        ],
        source: APP_SOURCE,
      },
      checks: [
        { title: 'ファイルの種類', desc: '資材・装備・母港などのどれかを確認します。' },
        { title: '更新内容', desc: '加算せず最新値へ置き換えます。' },
        { title: '反映内容を確認', desc: '次の画面で保持するものを確認してから保存します。' },
      ],
    },
    {
      title: '反映して所持数を確認する',
      desc: '「最新の所持データとして反映」を押すと保存します。',
      image: {
        src: 'guide/browser-04-confirm.png',
        alt: '最新の所持データを反映する確認画面',
        annotations: [
          { n: 1, x: 0.008, y: 0.143, w: 0.97, h: 0.268 },
          { n: 2, x: 0.008, y: 0.425, w: 0.97, h: 0.347 },
          { n: 3, x: 0.679, y: 0.883, w: 0.3, h: 0.063 },
        ],
        source: APP_SOURCE,
      },
      checks: [
        { title: '反映後の数', desc: 'JSONの数量がそのまま最新の所持数になります。' },
        { title: '保持するもの', desc: '今回含まれない種類と、実績・目標・保護設定は残ります。' },
        { title: '反映', desc: '保存が終わると「✓ 保存済み」に戻ります。' },
      ],
    },
  ],
};

export const TROUBLE = [
  { q: '形式が違う', a: '「対応していないデータ形式」と表示されたら、Response 本文か、S@ のファイルか確認してください。Q@（リクエスト）や Cookie は使えません。' },
  { q: 'データが古い', a: '取り込んだ内容を最新の所持数として扱います。古いファイルを選ぶと、その数量に置き換わります。最新のファイルを選び直してください。' },
  { q: '一部の種類がない', a: '装備だけの入力では艦娘・資材は「不明」のままです。母港（api_port/port）を取り込むと艦娘と資材を更新します。' },
];

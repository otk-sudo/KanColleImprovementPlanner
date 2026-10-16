/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** ゲーム画像の配信元（未設定なら画像なしの代替表示）。配布条件の確認後にだけ設定する */
  readonly VITE_IMAGE_BASE_URL?: string;
  /** E2E・画面比較用のテスト入口を有効にする（本番では未設定） */
  readonly VITE_TEST_HOOKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

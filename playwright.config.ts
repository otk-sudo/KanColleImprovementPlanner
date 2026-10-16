import { defineConfig, devices } from '@playwright/test';

// E2E（ブラウザでの保存・画面・繰越の通し検証）と、1440×940 の画面比較用の撮影。
// テスト用の入口（VITE_TEST_HOOKS=1）を有効にした開発サーバーで実行する。
// SCREENS_IMAGES=1 のときは、ローカル専用の比較画像（public/local-images、Git対象外）を表示する別ポートで起動する
const WITH_IMAGES = process.env.SCREENS_IMAGES === '1';
const PORT = WITH_IMAGES ? 5175 : 5174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1440, height: 940 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_TEST_HOOKS: '1', VITE_IMAGE_BASE_URL: WITH_IMAGES ? './local-images' : '' },
  },
  projects: [
    { name: 'chromium', testMatch: /.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 940 } } },
    // 参照PNG（Penpot書き出し）と同じグレースケールの文字描画で比較する
    { name: 'screens', testMatch: /screens\.capture\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1, launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] } } },
    // 取り込みガイドに載せるアプリ画面（架空データ）を public/guide/ へ撮影する
    { name: 'guide', testMatch: /guide\.capture\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1 } },
  ],
});

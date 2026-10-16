import { defineConfig, devices } from '@playwright/test';

// ビルド済みdistをWindowsの製品版Chrome/Edgeで確認する。テスト入口・架空マスターを使わない。
// CIのChromiumとは分け、インストール済みブラウザがない場合は失敗として報告する。
export default defineConfig({
  testDir: 'e2e',
  testMatch: /production\.smoke\.ts/,
  outputDir: 'work/release-readiness/production-results',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'work/release-readiness/production-report.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1440, height: 940 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
});

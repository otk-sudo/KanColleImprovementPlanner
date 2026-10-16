import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { BackupData } from '../src/domain/backup';

// 固定した実マスター・本番成果物・Windowsの製品版ブラウザ。所持入力は最小限の合成データ。
// ゲームの実レスポンスを使ったA02/A13、OSスリープ復帰、公開URLの検証とは区別する。
test.beforeEach(async ({ browser }, info) => {
  info.annotations.push({ type: 'browser-version', description: browser.version() });
});

async function applyEquipment(page: Page) {
  await page.goto('/#/import');
  await page.getByLabel('コピーしたレスポンス').fill(JSON.stringify([{ id: 1, lv: 0 }]));
  await page.getByRole('button', { name: '内容を確認', exact: true }).click();
  await page.getByRole('button', { name: '反映内容を確認' }).click();
  await page.getByRole('button', { name: '最新の所持データとして反映' }).click();
  await page.waitForURL(/#\/inventory\/equipment/);
}

async function exportData(page: Page): Promise<BackupData> {
  await page.goto('/#/settings');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'バックアップを書き出す' }).click();
  return JSON.parse(readFileSync(await (await pending).path(), 'utf8')) as BackupData;
}

test('本番成果物：取り込み・目標・保存・バックアップ復元が通り、外部通信とテスト入口がない', async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:5176/') && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  page.on('pageerror', e => errors.push(e.name));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'はじめての改修計画' })).toBeVisible();
  expect(await page.evaluate(() => '__kaishu' in window)).toBe(false);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("connect-src 'self'");
  await applyEquipment(page);
  await page.goto('/#/goals/new');
  await page.getByLabel('装備名で検索').fill('12cm単装砲');
  await page.getByRole('option').filter({ has: page.getByText('12cm単装砲', { exact: true }) }).getByRole('button').click();
  await page.locator('#target-star').selectOption('1');
  await page.getByRole('button', { name: '目標を保存', exact: true }).click();
  await page.waitForURL(/#\/goals$/);
  const saved = await exportData(page);
  expect(saved.goals).toHaveLength(1);
  expect(saved.baselines.find(b => b.scope === 'equipment')?.equipment?.buckets).toEqual([{ equipmentId: 1, star: 0, count: 1 }]);
  expect(JSON.stringify(saved)).not.toMatch(/api_token|nickname|member_id/);
  // 変更してから元のバックアップを復元する。テスト用DB操作ではなく画面の操作だけを使う。
  await page.locator('#holiday-start').fill('2026-12-20');
  await page.locator('#holiday-end').fill('2026-12-21');
  await page.getByRole('button', { name: '休みを追加' }).click();
  await expect(page.getByRole('list', { name: '登録済みの休み' }).getByRole('listitem')).toHaveCount(1);
  await page.locator('input[type=file]').setInputFiles({ name: 'production-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await page.waitForURL(/#\/settings\/restore$/);
  const pre = page.waitForEvent('download');
  await page.getByRole('button', { name: '復元前の保存へ進む' }).click();
  const preData = JSON.parse(readFileSync(await (await pre).path(), 'utf8')) as BackupData;
  expect(preData.settings.holidays).toHaveLength(1);
  await page.getByRole('button', { name: 'この内容で復元する' }).click();
  await page.waitForURL(/#\/calendar/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const restored = await exportData(page);
  expect(restored.goals).toEqual(saved.goals);
  expect(restored.baselines).toEqual(saved.baselines);
  expect(restored.settings).toEqual(saved.settings);
  expect(await page.evaluate(() => '__kaishu' in window)).toBe(false);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('本番成果物：PC幅と縮小ウィンドウの主要画面を確認する', async ({ page }, info) => {
  await page.goto('/');
  await applyEquipment(page);
  for (const width of [1440, 1280, 1024, 720]) {
    await page.setViewportSize({ width, height: width === 720 ? 470 : 940 });
    for (const [id, route] of [['S06', '/inventory/equipment'], ['S10', '/settings'], ['S11', '/guide/browser']] as const) {
      await page.goto(`/#${route}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${id} ${width}px`).toBe(true);
      await page.screenshot({ path: `work/release-readiness/screens/${info.project.name}-${id}-${width}.png`, fullPage: true });
    }
  }
});

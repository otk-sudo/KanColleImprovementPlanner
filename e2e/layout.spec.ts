import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ID } from './support/masters';
import { noHorizontalScroll, start } from './support/app';
import { eqBaseline, goal, shipBaseline, valueBaseline, type BackupSpec } from './support/scenario';

// PC幅・縮小ウィンドウ（A11 の自動確認部分）とキーボード操作。実機の Chrome/Edge での目視確認は別途行う。

const seed: BackupSpec = {
  masterVersion: 'screen-fixture-v1',
  baselines: [eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 3]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 10), valueBaseline('resource:7', 40)],
  goals: [goal({ goalId: 'g1', equipmentId: ID.mainGunA, targetStar: 6, guarantee: { mode: 'always', fromStar: null } })],
};

const ROUTES = ['/calendar', '/calendar/week', '/calendar/day/2026-10-14', '/goals', '/goals/new', '/goals/g1/steps', '/materials', '/inventory/equipment', '/inventory/ships', '/inventory/items', '/import', '/import/file', '/history', '/settings', '/guide/browser', '/guide/steps/browser/3', '/unplaced'];

for (const size of [
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
]) {
  test(`A11：${size.width}×${size.height} で主要画面にページ全体の横スクロールが出ない`, async ({ page }) => {
    await page.setViewportSize(size);
    await start(page, { data: seed, route: '/calendar' });
    mkdirSync(`test-results/layout-${size.width}`, { recursive: true });
    for (const route of ROUTES) {
      await page.goto(`/#${route}`);
      await expect(page.locator('h1')).toBeVisible();
      await noHorizontalScroll(page, route);
      await page.screenshot({ path: `test-results/layout-${size.width}/${route.replaceAll('/', '_')}.png`, fullPage: true });
    }
  });
}

test('A11：200%表示相当（720×470）でもページ全体の横スクロールが出ず、記録まで操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 470 });
  await start(page, { data: seed, route: '/calendar' });
  mkdirSync('test-results/layout-720', { recursive: true });
  for (const route of ROUTES) {
    await page.goto(`/#${route}`);
    await expect(page.locator('h1')).toBeVisible();
    await noHorizontalScroll(page, route);
    await page.screenshot({ path: `test-results/layout-720/${route.replaceAll('/', '_')}.png`, fullPage: true });
  }
  // 結果の記録まで操作できる
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: '結果を記録' }).first().click();
  await expect(page.getByRole('radio', { name: '成功' })).toBeVisible();
});

test('キーボードだけで主要機能へ移動し、記録の結果を選べる', async ({ page }) => {
  await start(page, { data: seed, route: '/calendar' });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAccessibleName('カレンダー');
  // ナビゲーションを Tab で進め、Enter で開く
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAccessibleName('所持データ');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '所持データ' })).toBeVisible();
  // 記録画面：結果はボタン（役割 radio）を Tab で選び Enter で確定できる
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: '結果を記録' }).first().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: '成功' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: '成功' })).toHaveAttribute('aria-checked', 'true');
  // フォーカス位置が見える（outline）
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe('none');
});

test('ガイドの拡大画像は Esc で閉じられる', async ({ page }) => {
  await start(page, { data: seed, route: '/guide/steps/browser/3' });
  await page.getByRole('button', { name: '画像を拡大する' }).click();
  await expect(page.getByRole('dialog', { name: '拡大画像' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '拡大画像' })).toBeHidden();
});

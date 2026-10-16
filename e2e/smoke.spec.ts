import { expect, test } from '@playwright/test';

// 実マスター（public/master）で起動し、初回画面と主要画面が表示されることを確認する。
test('初回起動ではじめての改修計画を表示する', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'はじめての改修計画' })).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke-welcome.png' });
  for (const path of ['/import', '/import/file', '/goals', '/goals/new', '/materials', '/inventory/equipment', '/inventory/ships', '/inventory/items', '/history', '/settings', '/guide/browser', '/guide/74en', '/guide/steps/browser/3', '/unplaced', '/calendar/week', '/calendar/day/2026-10-14']) {
    await page.goto(`/#${path}`);
    await expect(page.locator('h1')).toBeVisible();
    await page.screenshot({ path: `test-results/smoke${path.replaceAll('/', '-')}.png` });
  }
});

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BACKUP_FORMAT } from '../src/domain/backup';
import { screenMaster } from './support/masters';
import { pasteAndApply, start, state } from './support/app';
import { backup, fixClock, serveFixtureMaster, valueBaseline, type BackupSpec } from './support/scenario';

// 複数タブ・保存失敗・バックアップと復元（R02/R05、A07・A10）。

const material = (screws: number) => JSON.stringify({ api_result: 1, api_data: [{ api_id: 8, api_value: screws }] });
const seed: BackupSpec = { masterVersion: 'screen-fixture-v1', baselines: [valueBaseline('resource:8', 10), valueBaseline('resource:7', 40)] };

test('A10：別のタブで保存した内容は通知で反映される', async ({ context }) => {
  const a = await context.newPage();
  await start(a, { data: seed, route: '/inventory/items' });
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await b.goto('/#/inventory/items');
  await expect(b.getByRole('row', { name: /改修資材（ネジ）/ })).toContainText('10');
  await pasteAndApply(a, material(15));
  await expect(b.getByRole('row', { name: /改修資材（ネジ）/ })).toContainText('15');
});

test('A10：通知が届かない古いタブからの保存は上書きせず、最新の内容を確認させる', async ({ context }) => {
  const a = await context.newPage();
  await start(a, { data: seed, route: '/import' });
  const b = await context.newPage();
  // 古いタブを再現するため、B ではタブ間通知を無効にする
  await b.addInitScript(() => {
    // @ts-expect-error テスト用にタブ間通知を無効化する
    delete window.BroadcastChannel;
  });
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await b.goto('/#/import');
  await b.getByLabel('コピーしたレスポンス').fill(material(99));
  await b.getByRole('button', { name: '内容を確認' }).click();
  await b.getByRole('button', { name: '反映内容を確認' }).click();
  await b.waitForURL(/confirm/);
  // A が先に保存する
  await pasteAndApply(a, material(15));
  // B（古い revision）の確定は競合として拒否される
  await b.getByRole('button', { name: '最新の所持データとして反映' }).click();
  await expect(b.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  expect((await state(a)).baselines.find((x) => x.scope === 'resource:8')?.value).toBe(15);
  // 内容を確認してからもう一度確定すれば反映できる
  await b.getByRole('button', { name: '最新の所持データとして反映' }).click();
  await b.waitForURL(/#\/inventory\//);
  expect((await state(b)).baselines.find((x) => x.scope === 'resource:8')?.value).toBe(99);
});

test('A10/P17：保存途中で容量不足になっても事実を保存せず、入力を保ったまま再試行できる', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __failWrites: boolean };
    w.__failWrites = false;
    for (const name of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[name];
      IDBObjectStore.prototype[name] = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (w.__failWrites) throw new DOMException('テスト用の容量不足', 'QuotaExceededError');
        return original.apply(this, args);
      };
    }
  });
  await start(page, { data: seed, route: '/import' });
  const before = await state(page);
  await page.getByLabel('コピーしたレスポンス').fill(material(15));
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: '反映内容を確認' }).click();
  await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = true));
  await page.getByRole('button', { name: '最新の所持データとして反映' }).click();
  await expect(page.getByText('ブラウザの保存容量が不足しています。').first()).toBeVisible();
  await expect(page).toHaveURL(/confirm/);
  await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = false));
  const unchanged = await state(page);
  expect(unchanged.meta.revision).toBe(before.meta.revision);
  expect(unchanged.baselines.find((x) => x.scope === 'resource:8')?.value).toBe(10);
  await page.getByRole('button', { name: '最新の所持データとして反映' }).click();
  await page.waitForURL(/#\/inventory\//);
  expect((await state(page)).baselines.find((x) => x.scope === 'resource:8')?.value).toBe(15);
});

test('A10：バックアップを書き出し、変更後に復元すると全体が元に戻る（復元前の状態も保存する）', async ({ page }) => {
  await start(page, { data: seed, route: '/settings' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'バックアップを書き出す' }).click();
  const file = await (await download).path();
  const json = readFileSync(file, 'utf8');
  const parsed = JSON.parse(json) as { format: string; baselines: { scope: string; value: number }[] };
  expect(parsed.format).toBe(BACKUP_FORMAT);
  expect(parsed.baselines.find((b) => b.scope === 'resource:8')?.value).toBe(10);
  // 個人を特定する情報や認証情報を含めない
  expect(json).not.toMatch(/api_token|nickname|member_id/);

  await pasteAndApply(page, material(50));
  await page.goto('/#/settings');
  await page.locator('input[type=file]').setInputFiles({ name: 'kaishu-backup.json', mimeType: 'application/json', buffer: Buffer.from(json, 'utf8') });
  await page.waitForURL(/#\/settings\/restore$/);
  await expect(page.getByText('ファイル：kaishu-backup.json')).toBeVisible();
  const pre = page.waitForEvent('download');
  await page.getByRole('button', { name: '復元前の保存へ進む' }).click();
  expect((await pre).suggestedFilename()).toMatch(/^before-restore-/);
  await page.getByRole('button', { name: 'この内容で復元する' }).click();
  await page.waitForURL(/#\/calendar/);
  await expect(page.getByText('バックアップを復元しました。')).toBeVisible();
  expect((await state(page)).baselines.find((x) => x.scope === 'resource:8')?.value).toBe(10);
});

test('A10：壊れたバックアップは部分的にも復元せず、現在のデータを保つ', async ({ page }) => {
  await start(page, { data: seed, route: '/settings' });
  const before = await state(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"kaishu', 'utf8') });
  await expect(page.getByText('このファイルは復元できません')).toBeVisible();
  const after = await state(page);
  expect(after.meta.revision).toBe(before.meta.revision);
  expect(after.meta.datasetEpoch).toBe(before.meta.datasetEpoch);
});

test('A10：必要なマスターがないバックアップは計算保留を確認してから復元し、予定の再計算を保留する', async ({ page }) => {
  await start(page, { data: seed, route: '/settings' });
  const json = JSON.stringify(backup({ ...seed, masterVersion: 'sample-v2', baselines: [valueBaseline('resource:8', 33)] }));
  await page.locator('input[type=file]').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(json, 'utf8') });
  await page.waitForURL(/#\/settings\/restore\/master$/);
  const back = page.getByRole('button', { name: '復元前の確認へ戻る' });
  await expect(back).toBeDisabled();
  await page.getByText('予定が保留のままになることを確認しました').click();
  await back.click();
  await page.waitForURL(/#\/settings\/restore$/);
  await expect(page.getByText('必要なマスターがないため、復元後は予定の再計算を保留します（確認済み）。')).toBeVisible();
  await page.getByRole('button', { name: '復元前の保存へ進む' }).click();
  await page.getByRole('button', { name: 'この内容で復元する' }).click();
  await page.waitForURL(/#\/calendar/);
  const d = await state(page);
  expect(d.meta.masterReviewRequired).toBe(true);
  expect(d.baselines.find((x) => x.scope === 'resource:8')?.value).toBe(33);
});

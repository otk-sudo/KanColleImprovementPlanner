import { expect, test } from '@playwright/test';
import { start, state } from './support/app';
import { ID, screenMaster } from './support/masters';
import { backup, eqBaseline, goal, shipBaseline, valueBaseline, type BackupSpec } from './support/scenario';

const seed: BackupSpec = { masterVersion: 'screen-fixture-v1', baselines: [eqBaseline([[ID.mainGunA, 0, 1], [ID.materialA, 0, 10]]), shipBaseline([ID.shipAKai2, ID.shipBKai2]), ...Array.from({ length: 8 }, (_, i) => valueBaseline(`resource:${i + 1}`, 100))], goals: [goal({ goalId: 'g', equipmentId: ID.mainGunA, targetStar: 1 })] };

test('PR指摘：復元保存後の読み直し失敗では、復元を繰り返さず確認だけ再試行する', async ({ page }) => {
  await start(page, { data: seed, route: '/settings' });
  await page.locator('#holiday-start').fill('2026-12-20');
  await page.locator('#holiday-end').fill('2026-12-21');
  await page.getByRole('button', { name: '休みを追加' }).click();
  await expect(page.getByRole('list', { name: '登録済みの休み' }).getByRole('listitem')).toHaveCount(1);
  await page.locator('input[type=file]').setInputFiles({ name: 'restore-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup(seed))) });
  await page.waitForURL(/#\/settings\/restore$/);
  const pre = page.waitForEvent('download');
  await page.getByRole('button', { name: '復元前の保存へ進む' }).click();
  await pre;
  await page.evaluate(() => window.__kaishu!.failLoad(2));
  await page.getByRole('button', { name: 'この内容で復元する' }).click();
  const retry = page.getByRole('button', { name: '復元結果の確認を再試行' });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button', { name: 'この内容で復元する' })).toHaveCount(0);
  await expect(page.getByText(/同じ内容でもう一度確定してください/)).toHaveCount(0);
  const restored = await state(page);
  expect(restored.settings.holidays).toEqual([]);
  await retry.click();
  await expect(retry).toBeVisible();
  expect((await state(page)).meta.datasetEpoch).toBe(restored.meta.datasetEpoch);
  await retry.click();
  await page.waitForURL(/#\/calendar/);
  await expect(page.getByText('バックアップを復元しました。')).toBeVisible();
  const confirmed = await state(page);
  expect(confirmed.meta.datasetEpoch).toBe(restored.meta.datasetEpoch);
  expect(confirmed.meta.revision).toBe(restored.meta.revision);
  expect(confirmed.baselines).toEqual(restored.baselines);
});

test('PR指摘：別タブ相当の通知の読み込み失敗は警告を保持し、読み直しで回復する', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await start(page, { data: seed, route: '/inventory/equipment' });
  const changed = backup({ ...seed, baselines: [eqBaseline([[ID.mainGunA, 0, 2], [ID.materialA, 0, 10]]), ...seed.baselines!.filter(b => b.scope !== 'equipment')] });
  // 別タブが保存してから通知する状況を、DBの更新と実際のBroadcastChannelで作る。
  await page.evaluate(async json => {
    await window.__kaishu!.restore(json);
    window.__kaishu!.failLoad(2);
    const channel = new BroadcastChannel('kancolle-improvement-planner');
    channel.postMessage({ type: 'changed' });
    channel.close();
  }, JSON.stringify(changed));
  await expect(page.getByText('最新データの表示を更新できませんでした。', { exact: false })).toBeVisible();
  const saved = await state(page);
  const retry = page.getByRole('button', { name: '最新データを再読み込み' });
  await retry.click();
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.getByText('最新データの表示を更新できませんでした。', { exact: false })).toHaveCount(0);
  expect((await state(page)).meta.revision).toBe(saved.meta.revision);
  expect(errors).toEqual([]);
});

test('PR指摘：担当艦選択が別タブと競合したら、候補を閉じず知らせて再確認する', async ({ context }) => {
  const page = await context.newPage();
  await start(page, { data: seed, route: '/goals/g/steps' });
  await page.getByRole('button', { name: /担当艦：/ }).click();
  const other = await context.newPage();
  await start(other, { master: screenMaster(), route: '/settings' });
  await other.locator('#holiday-start').fill('2026-12-20');
  await other.locator('#holiday-end').fill('2026-12-21');
  await other.getByRole('button', { name: '休みを追加' }).click();
  const chooser = page.getByRole('list', { name: '担当艦の候補' });
  await chooser.getByRole('button', { name: '艦娘A改二', exact: true }).click();
  await expect(page.getByText('別のタブなどで内容が変更されました。', { exact: false })).toBeVisible();
  await expect(chooser).toBeVisible();
  expect((await state(page)).preferredHelpers).toEqual([]);
  await chooser.getByRole('button', { name: '艦娘A改二', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  expect((await state(page)).preferredHelpers[0]?.shipId).toBe(ID.shipAKai2);
});

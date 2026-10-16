import { expect, test } from '@playwright/test';
import { ID } from './support/masters';
import { equipmentCounts, pasteAndApply, start, state } from './support/app';

// 取り込み（R03〜R06、A01・A02・A10）。架空の装備・資材だけを使う。

const items = [
  { id: ID.mainGunA, lv: 6 },
  { id: ID.mainGunA, lv: 6 },
  { id: ID.mainGunA, lv: 5 },
  { id: ID.materialA, lv: 0 },
  { id: ID.materialA, lv: 0 },
  { id: ID.materialA, lv: 0 },
];

test('A01：貼り付けた装備の個数・★別の数が入力どおりになり、同じ入力を再取り込みしても倍増しない', async ({ page }) => {
  await start(page, { route: '/import' });
  await pasteAndApply(page, JSON.stringify(items));
  await expect(page.getByText('所持データを反映しました（装備）。')).toBeVisible();
  const first = equipmentCounts(await state(page));
  expect(Object.fromEntries(first)).toEqual({ [`${ID.mainGunA}:6`]: 2, [`${ID.mainGunA}:5`]: 1, [`${ID.materialA}:0`]: 3 });
  // 一覧の表示（装備名と★を文字で併記）
  await expect(page.getByRole('row', { name: /主砲A ★6/ })).toContainText('2');
  await expect(page.getByRole('row', { name: /素材装備A ★0/ })).toContainText('3');

  await pasteAndApply(page, JSON.stringify(items));
  const second = equipmentCounts(await state(page));
  expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
  expect((await state(page)).baselines.filter((b) => b.scope === 'equipment')).toHaveLength(1);
});

test('A02：資材だけの取り込みは装備を保持し、未取得の艦娘・アイテムは「不明」のまま', async ({ page }) => {
  await start(page, { route: '/import' });
  await pasteAndApply(page, JSON.stringify(items));
  await pasteAndApply(page, JSON.stringify({ api_result: 1, api_data: [{ api_id: 8, api_value: 15 }, { api_id: 7, api_value: 40 }] }));
  await expect(page).toHaveURL(/#\/inventory\/items/);
  const d = await state(page);
  expect(Object.fromEntries(equipmentCounts(d))[`${ID.mainGunA}:6`]).toBe(2);
  expect(d.baselines.find((b) => b.scope === 'resource:8')?.value).toBe(15);
  expect(d.baselines.some((b) => b.scope === 'ships')).toBe(false);
  await expect(page.getByRole('row', { name: /改修資材（ネジ）/ })).toContainText('15');
  await page.goto('/#/inventory/ships');
  await expect(page.getByText('装備のみ取り込んだ場合、艦娘は「不明」です。')).toBeVisible();
});

test('A10：途中で切れたJSONは保存せず取り込みエラーを表示し、所持データを変更しない', async ({ page }) => {
  await start(page, { route: '/import' });
  await pasteAndApply(page, JSON.stringify(items));
  const before = await state(page);
  await page.goto('/#/import');
  await page.getByLabel('コピーしたレスポンス').fill('{ "api_data": [ {"api_id": 1');
  await page.getByRole('button', { name: '内容を確認' }).click();
  await expect(page.getByRole('heading', { name: '取り込みエラー' })).toBeVisible();
  await expect(page.getByText('現在の所持データは変更されていません。')).toBeVisible();
  const after = await state(page);
  expect(after.meta.revision).toBe(before.meta.revision);
  expect(after.baselines).toEqual(before.baselines);
});

test('A02：74式ENの保存ファイル（svdata= 付き）を選んで取り込める', async ({ page }) => {
  await start(page, { route: '/import/file' });
  const body = `svdata=${JSON.stringify({ api_result: 1, api_result_msg: '成功', api_data: [{ api_member_id: 1, api_id: 8, api_value: 22 }, { api_member_id: 1, api_id: 7, api_value: 33 }] })}`;
  await page.locator('input[type=file]').setInputFiles({ name: '20261014_093000_S@api_get_member@material.json', mimeType: 'application/json', buffer: Buffer.from(body, 'utf8') });
  await expect(page.getByText('読み込み成功')).toBeVisible();
  await page.getByRole('button', { name: '反映内容を確認' }).click();
  await page.getByRole('button', { name: '最新の所持データとして反映' }).click();
  await page.waitForURL(/#\/inventory\/items/);
  const d = await state(page);
  expect(d.baselines.find((b) => b.scope === 'resource:8')?.value).toBe(22);
  expect(d.baselines.find((b) => b.scope === 'resource:7')?.value).toBe(33);
});

test('A02：複数ファイルに読めないファイルがあれば確定せず、そのファイルを明示的に除外すれば残りだけ反映できる', async ({ page }) => {
  await start(page, { route: '/import/file' });
  const body = `svdata=${JSON.stringify({ api_result: 1, api_result_msg: '成功', api_data: [{ api_member_id: 1, api_id: 8, api_value: 22 }] })}`;
  await page.locator('input[type=file]').setInputFiles([
    { name: '20261014_093000_S@api_get_member@material.json', mimeType: 'application/json', buffer: Buffer.from(body, 'utf8') },
    { name: '20261014_093001_S@api_get_member@slot_item.json', mimeType: 'application/json', buffer: Buffer.from('svdata={"api_result":1,', 'utf8') },
  ]);
  await expect(page.getByText(/読み込めません/)).toBeVisible();
  await expect(page.getByRole('button', { name: '反映内容を確認' })).toBeDisabled();
  await page.getByRole('button', { name: /slot_item\.json を除外/ }).click();
  await expect(page.getByText(/除外しました/)).toBeVisible();
  await page.getByRole('button', { name: '反映内容を確認' }).click();
  await page.getByRole('button', { name: '最新の所持データとして反映' }).click();
  await page.waitForURL(/#\/inventory\/items/);
  const d = await state(page);
  expect(d.baselines.find((b) => b.scope === 'resource:8')?.value).toBe(22);
  expect(d.baselines.some((b) => b.scope === 'equipment')).toBe(false);
});

test('認証情報やリクエストは受け付けず、レスポンス本文だけを扱う（A02）', async ({ page }) => {
  await start(page, { route: '/import' });
  await page.getByLabel('コピーしたレスポンス').fill('api_token=abcdef&api_verno=1');
  await page.getByRole('button', { name: '内容を確認' }).click();
  await expect(page.getByRole('heading', { name: '取り込みエラー' })).toBeVisible();
  const d = await state(page);
  expect(JSON.stringify(d)).not.toContain('abcdef');
});

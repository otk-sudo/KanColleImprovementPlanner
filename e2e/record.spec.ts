import { expect, test, type Page } from '@playwright/test';
import { ID } from './support/masters';
import { start, state } from './support/app';
import { eqBaseline, shipBaseline, valueBaseline, type BackupSpec } from './support/scenario';

// 目標・記録・訂正・確認待ち・翌日処理（R07〜R20、A03・A06・A07・A09）。2026-10-14（水）09:00 JST に固定。
// 主砲A の担当艦は 艦娘A改二（月・水・金）。★0→6 はネジ3・釘4・素材装備A 2（通常）。

const seed: BackupSpec = {
  masterVersion: 'screen-fixture-v1',
  baselines: [eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 3]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 10), valueBaseline('resource:7', 40)],
  settings: { weekdayLimits: [1, 1, 1, 1, 1, 1, 1] },
};

async function addGoal(page: Page, name: string, star: number) {
  await page.goto('/#/goals/new');
  await page.getByLabel('装備名で検索').fill(name);
  await page.getByRole('option').getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await page.locator('#target-star').selectOption(String(star));
  await page.getByRole('button', { name: '目標を保存', exact: true }).click();
  await page.waitForURL(/#\/goals$/);
}

async function recordToday(page: Page, outcome: '成功' | '失敗') {
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: '結果を記録' }).first().click();
  await page.getByRole('radio', { name: outcome }).click();
  if (outcome === '失敗') {
    // 失敗は成功時の費用を写さない（空欄から実消費を入力）
    for (const label of ['改修資材', '開発資材', '素材装備A']) await page.getByLabel(label).fill(label === '素材装備A' ? '2' : '3');
  }
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で記録' }).click();
  await page.waitForURL(/#\/calendar/);
}

test('A03/A06：未所持でも目標を作れ、所持していれば今日の予定が作られる', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  let d = await state(page);
  expect(d.goals).toHaveLength(1);
  expect(d.attempts.filter((a) => a.scheduledDate === '2026-10-14' && a.lifecycle === 'active')).toHaveLength(1);
  await page.goto('/#/calendar');
  await expect(page.getByText('今日 • 1件 / 上限1回')).toBeVisible();
  // 未所持の装備も目標にでき、改修できない理由を区別して表示する
  await addGoal(page, '副砲B', 6);
  d = await state(page);
  expect(d.goals).toHaveLength(2);
  await page.goto('/#/unplaced');
  await expect(page.getByRole('heading', { name: '配置できない予定' })).toBeVisible();
  await expect(page.getByText(/副砲B/).first()).toBeVisible();
});

test('A09：成功を記録すると★と消費が反映され、失敗へ訂正すると★が戻る', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  await recordToday(page, '成功');
  let d = await state(page);
  expect(d.resultEvents).toHaveLength(1);
  expect(d.resultEvents[0]!.outcome).toBe('success');
  await page.goto('/#/inventory/equipment');
  await expect(page.getByRole('row', { name: /主砲A ★6/ })).toContainText('1');
  await page.goto('/#/inventory/items');
  await expect(page.getByRole('row', { name: /改修資材（ネジ）/ })).toContainText('7');

  await page.goto('/#/history');
  await page.getByRole('link', { name: '記録を修正' }).first().click();
  await page.getByRole('radio', { name: '失敗' }).click();
  await expect(page.getByText('主砲A ★5：0 → 1')).toBeVisible();
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で訂正' }).click();
  await page.waitForURL(/#\/history/);
  d = await state(page);
  expect(d.resultEvents[0]!.outcome).toBe('failure');
  expect(d.resultEvents[0]!.revision).toBe(2);
  expect(d.resultEvents[0]!.history).toHaveLength(1);
  await page.goto('/#/inventory/equipment');
  await expect(page.getByRole('row', { name: /主砲A ★5/ })).toContainText('1');
});

test('A09：消費が分からない実施は確認待ちで保存し、未実施だった場合は理由を付けて訂正できる', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: '結果を記録' }).first().click();
  await page.getByRole('radio', { name: '失敗' }).click();
  await page.getByLabel('改修資材').fill('4');
  await page.getByRole('button', { name: '実施済み・確認待ち' }).click();
  await page.getByText('ゲームで実施済みです').click();
  await page.getByRole('button', { name: '実施済み・確認待ちで保存' }).click();
  await page.waitForURL(/#\/history/);
  let d = await state(page);
  expect(d.drafts).toHaveLength(1);
  expect(d.resultEvents).toHaveLength(0);
  expect(d.attempts.find((a) => a.attemptId === d.drafts[0]!.attemptId)?.outcome).toBe('draft');
  await page.getByRole('link', { name: '実施していなかった' }).click();
  await page.getByLabel('訂正理由（必須）').fill('予定と取り違えた');
  await page.getByRole('button', { name: '未実施として訂正' }).click();
  await page.waitForURL(/#\/history/);
  d = await state(page);
  expect(d.drafts[0]!.status).toBe('cancelled');
  expect(d.drafts[0]!.cancelReason).toBe('予定と取り違えた');
  expect(d.attempts.filter((a) => a.lifecycle === 'active' && a.outcome === 'none')).toHaveLength(1);
});

test('A07：日本時間の日付が変わると未実施の予定だけを次の実施可能日へ1つ移し、再読込しても重複しない', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  const original = (await state(page)).attempts.find((a) => a.scheduledDate === '2026-10-14')!;
  await page.clock.setFixedTime(new Date('2026-10-15T00:00:00.000Z')); // 10/15（木）09:00 JST
  await page.reload();
  await page.waitForSelector('h1');
  await expect.poll(async () => (await state(page)).attempts.filter((a) => a.stepKey === original.stepKey && a.lifecycle === 'active' && a.outcome === 'none').length).toBe(1);
  let d = await state(page);
  expect(d.attempts.find((a) => a.attemptId === original.attemptId)?.lifecycle).toBe('superseded');
  const successor = d.attempts.find((a) => a.stepKey === original.stepKey && a.lifecycle === 'active')!;
  expect(successor.scheduledDate).toBe('2026-10-16'); // 担当艦の曜日（金）
  await page.reload();
  await page.waitForSelector('h1');
  d = await state(page);
  expect(d.attempts.filter((a) => a.stepKey === original.stepKey && a.lifecycle === 'active' && a.outcome === 'none')).toHaveLength(1);
  await page.goto('/#/history');
  await expect(page.getByText('10/14の未完了1件を、実行可能な次の日へ移しました')).toBeVisible();
});

test('A07：スキップは資材も装備も消費せず、同日中は別の日へ自動移動しない', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  const before = await state(page);
  const a = before.attempts.find((x) => x.scheduledDate === '2026-10-14')!;
  await page.goto(`/#/attempts/${encodeURIComponent(a.attemptId)}/skip`);
  await page.getByRole('button', { name: 'この1件をスキップ' }).click();
  await page.waitForURL(/#\/calendar/);
  const d = await state(page);
  expect(d.attempts.find((x) => x.attemptId === a.attemptId)?.outcome).toBe('skip');
  expect(d.resultEvents.every((e) => e.deltas.length === 0)).toBe(true);
  expect(d.baselines).toEqual(before.baselines);
  // 同日中は新しい試行を作らない（翌日処理で再配置）
  expect(d.attempts.filter((x) => x.stepKey === a.stepKey && x.scheduledDate === '2026-10-14' && x.outcome === 'none')).toHaveLength(0);
});

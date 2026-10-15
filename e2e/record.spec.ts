import { expect, test, type Page } from '@playwright/test';
import { ID } from './support/masters';
import { pasteAndApply, start, state } from './support/app';
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
  await page.waitForURL(/#\/history$/);
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
  await page.waitForURL(/#\/history\?tab=drafts$/);
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

test('A07：過去日の記録を「実施していなかった」へ訂正すると、その場で翌日処理して次の実施可能日へ移す', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  await recordToday(page, '成功');
  const original = (await state(page)).attempts.find((a) => a.scheduledDate === '2026-10-14' && a.outcome === 'success')!;
  await page.clock.setFixedTime(new Date('2026-10-15T00:00:00.000Z')); // 10/15（木）09:00 JST
  await page.reload();
  await page.waitForSelector('h1');
  await page.goto('/#/history');
  await page.getByRole('link', { name: '記録を修正' }).first().click();
  await page.getByRole('radio', { name: '実施していなかった' }).click();
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で訂正' }).click();
  await page.waitForURL(/#\/history$/);
  // 過去日に未完了の予定を残さず、後継を1つだけ作る（フォーカス復帰などを待たない）
  const d = await state(page);
  expect(d.attempts.find((a) => a.attemptId === original.attemptId)?.lifecycle).toBe('superseded');
  const active = d.attempts.filter((a) => a.stepKey === original.stepKey && a.lifecycle === 'active' && a.outcome === 'none');
  expect(active).toHaveLength(1);
  expect(active[0]!.scheduledDate).toBe('2026-10-16');
});

test('A09：数量に不正な値があるうちは、確認待ちとしても保存しない（不明な消費として扱いを失わない）', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: '結果を記録' }).first().click();
  await page.getByRole('radio', { name: '失敗' }).click();
  await page.getByLabel('改修資材').fill('1.5');
  await expect(page.getByRole('button', { name: '実施済み・確認待ち' })).toBeDisabled();
  await page.getByLabel('改修資材').fill('1');
  await expect(page.getByRole('button', { name: '実施済み・確認待ち' })).toBeEnabled();
});

test('A09：訂正で、所持数に反映した種類を「履歴だけ」へ変えられる（取り込みに含まれていた消費を二重に引かない）', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  await recordToday(page, '成功');
  const ev = (await state(page)).resultEvents[0]!;
  await page.goto(`/#/history/events/${encodeURIComponent(ev.eventId)}/correct`);
  await expect(page.getByLabel('改修資材を履歴だけに記録')).not.toBeChecked();
  await page.getByLabel('改修資材を履歴だけに記録').check();
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で訂正' }).click();
  await page.waitForURL(/#\/history$/);
  expect((await state(page)).resultEvents[0]!.historyOnlyScopes).toEqual(['resource:8']);
  await page.goto('/#/inventory/items');
  await expect(page.getByRole('row', { name: /改修資材（ネジ）/ })).toContainText('10');
});

test('A09：訂正画面で別の記録へ移ったら、その記録の内容でフォームを作り直す', async ({ page }) => {
  await start(page, { data: { ...seed, settings: { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] } }, route: '/goals' });
  await addGoal(page, '主砲A', 7);
  await recordToday(page, '成功'); // ★5→★6（釘4）
  await recordToday(page, '成功'); // ★6→★7（釘2）
  const d = await state(page);
  const devmats = (id: string) => -(d.resultEvents.find((e) => e.eventId === id)!.deltas.find((x) => x.scope === 'resource:7')?.amount ?? 0);
  const [first, second] = [...d.resultEvents].sort((a, b) => a.originalSequence - b.originalSequence);
  expect([devmats(first!.eventId), devmats(second!.eventId)]).toEqual([4, 2]);
  await page.goto(`/#/history/events/${encodeURIComponent(first!.eventId)}/correct`);
  await expect(page.getByLabel('開発資材', { exact: true })).toHaveValue('4');
  // 同じ画面のまま別の記録の訂正へ移る（依存する記録へのリンクと同じ）
  await page.goto(`/#/history/events/${encodeURIComponent(second!.eventId)}/correct`);
  await expect(page.getByLabel('開発資材', { exact: true })).toHaveValue('2');
});

test('A07：訂正後の日付変更の処理を保存できなければ、警告と再試行を出して移動先に残す', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  await recordToday(page, '成功');
  const original = (await state(page)).attempts.find((a) => a.scheduledDate === '2026-10-14' && a.outcome === 'success')!;
  await page.clock.setFixedTime(new Date('2026-10-15T00:00:00.000Z'));
  await page.reload();
  await page.waitForSelector('h1');
  await page.goto('/#/history');
  await page.getByRole('link', { name: '記録を修正' }).first().click();
  await page.getByRole('radio', { name: '実施していなかった' }).click();
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.evaluate(() => window.__kaishu!.failRollover(1));
  await page.getByRole('button', { name: 'この内容で訂正' }).click();
  await page.waitForURL(/#\/history$/);
  await expect(page.getByText('日付変更の処理（未完了の予定の繰越）を保存できませんでした。').first()).toBeVisible();
  expect((await state(page)).attempts.find((a) => a.attemptId === original.attemptId)?.lifecycle).toBe('active');
  await page.getByRole('button', { name: '日付変更の処理を再試行' }).click();
  await expect(page.getByText('日付変更の処理（未完了の予定の繰越）を保存できませんでした。')).toHaveCount(0);
  expect((await state(page)).attempts.find((a) => a.attemptId === original.attemptId)?.lifecycle).toBe('superseded');
});

test('A10：同日の取り込みで確認待ちになった予定は、そのまま確定できず、取り込み前の記録漏れとして装備を履歴のみにすれば記録できる', async ({ page }) => {
  await start(page, { data: seed, route: '/goals' });
  await addGoal(page, '主砲A', 6);
  const a = (await state(page)).attempts.find((x) => x.scheduledDate === '2026-10-14')!;
  // 改修対象（主砲A ★5）を含まない装備を同じ日に取り込む
  await pasteAndApply(page, JSON.stringify([0, 1, 2].map(() => ({ id: ID.materialA, lv: 0 }))));
  await expect.poll(async () => (await state(page)).attempts.find((x) => x.attemptId === a.attemptId)?.executionGate).toBe('reviewRequired');
  await page.goto(`/#/attempts/${encodeURIComponent(a.attemptId)}/record`);
  await page.getByRole('radio', { name: '成功' }).click();
  await expect(page.getByText('この予定は所持データとの確認待ちです。')).toBeVisible();
  await expect(page.getByRole('button', { name: '内容を確認' })).toBeDisabled();
  await page.getByText('最新の所持データを取り込む前に実施した記録漏れ').click();
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: '種類ごとの反映を確認' }).click();
  await page.waitForURL(/\/past$/);
  for (const label of ['改修資材', '開発資材']) await page.getByLabel(`${label}の今回の実績の扱い`).selectOption('apply');
  // 装備を所持数に反映する扱いは、確認待ちの予定では確定できない
  await page.getByLabel('装備の今回の実績の扱い').selectOption('apply');
  await expect(page.getByRole('button', { name: '確認待ちのため確定不可' })).toBeDisabled();
  await page.getByLabel('装備の今回の実績の扱い').selectOption('historyOnly');
  await page.getByRole('button', { name: 'この内容で確定' }).click();
  await page.waitForURL(/#\/history$/);
  const d = await state(page);
  const ev = d.resultEvents.find((e) => e.attemptId === a.attemptId)!;
  expect(ev.outcome).toBe('success');
  expect(ev.historyOnlyScopes).toEqual(['equipment']);
  // 資材は所持数に反映し（10 − 3）、装備は履歴だけなので取り込んだ数のまま
  await page.goto('/#/inventory/items');
  await expect(page.getByRole('row', { name: /改修資材（ネジ）/ })).toContainText('7');
  await page.goto('/#/inventory/equipment');
  await expect(page.getByRole('row', { name: /素材装備A ★0/ })).toContainText('3');
  // 訂正では「履歴だけ」の扱いを引き継ぐ（変えずに訂正しても装備を所持数に反映しない）
  await page.goto(`/#/history/events/${encodeURIComponent(ev.eventId)}/correct`);
  await expect(page.getByLabel('装備を履歴だけに記録')).toBeChecked();
  await page.getByLabel('訂正の理由（任意）').fill('メモ');
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で訂正' }).click();
  await page.waitForURL(/#\/history$/);
  expect((await state(page)).resultEvents.find((e) => e.eventId === ev.eventId)?.historyOnlyScopes).toEqual(['equipment']);
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

import { expect, test } from '@playwright/test';
import { start, state } from './support/app';
import { ID, screenMaster } from './support/masters';
import { eqBaseline, goal, shipBaseline, valueBaseline } from './support/scenario';

for (const fixedToday of [false, true]) test(`R13/R19：${fixedToday ? '当日固定' : '将来'}の工程で別素材の担当を選び、計画と実績を同じ素材で保存する`, async ({ page }) => {
  const master = screenMaster({ mainDays: fixedToday ? [0, 1, 2, 3, 4, 5, 6] : [1] });
  const recipe = master.recipes.find(r => r.equipmentId === ID.mainGunA)!;
  const alternate = structuredClone(recipe.entries[0]!);
  alternate.entryIndex = 1;
  alternate.helpers = [{ shipIds: [ID.shipBKai2], days: [0, 1, 2, 3, 4, 5, 6] }];
  alternate.cost.p1.equipment = [{ equipmentId: ID.secondaryB, count: 3 }];
  alternate.cost.p2.equipment = [{ equipmentId: ID.secondaryB, count: 3 }];
  recipe.entries.push(alternate);
  await start(page, { master, route: '/goals/g/steps', data: {
    masterVersion: master.masterVersion,
    baselines: [eqBaseline([[ID.mainGunA, 0, 1], [ID.materialA, 0, 10], [ID.secondaryB, 0, 10]]), shipBaseline([ID.shipAKai2, ID.shipBKai2]), ...Array.from({ length: 8 }, (_, i) => valueBaseline(`resource:${i + 1}`, 100))],
    goals: [goal({ goalId: 'g', equipmentId: ID.mainGunA, targetStar: 1 })],
  } });
  const before = (await state(page)).attempts.find(a => a.lifecycle === 'active' && a.outcome === 'none');
  await page.getByRole('button', { name: /担当艦：/ }).click();
  await page.getByRole('list', { name: '担当艦の候補' }).getByRole('button', { name: '艦娘B改二', exact: true }).click();
  await expect(page.locator('.steps-item-cost')).toContainText('副砲B');
  await expect(page.locator('.steps-item-cost')).not.toContainText('素材装備A');
  await expect(page.getByRole('button', { name: /担当艦：艦娘B改二/ })).toBeVisible();
  if (fixedToday) {
    const changed = (await state(page)).attempts.find(a => a.attemptId === before!.attemptId)!;
    expect(changed).toMatchObject({ scheduledDate: before!.scheduledDate, dayOrder: before!.dayOrder, helperShipId: ID.shipBKai2, executionGate: 'ready' });
  }
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: '結果を記録' }).first().click();
  await page.getByRole('radio', { name: '成功' }).click();
  await expect(page.getByRole('textbox', { name: '副砲B ★0', exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で記録' }).click();
  await page.waitForURL(/#\/calendar/);
  await page.reload();
  await page.waitForFunction(() => !!window.__kaishu);
  const data = await state(page);
  expect(data.resultEvents).toHaveLength(1);
  expect(data.resultEvents[0]!.deltas).toContainEqual({ scope: 'equipment', equipmentId: ID.secondaryB, star: 0, amount: -3 });
  expect(data.resultEvents[0]!.deltas.some(d => d.scope === 'equipment' && d.equipmentId === ID.materialA)).toBe(false);
  expect(data.resultEvents[0]!.recipeSnapshot?.entryIndex).toBe(1);
});

import { expect, test, type Page } from '@playwright/test';
import { ID } from './support/masters';
import { start, state } from './support/app';
import { eqBaseline, goal, shipBaseline, valueBaseline, type BackupSpec } from './support/scenario';

// R02/R05/R16/R20、A07/A09/A10。実ゲームの試験とは区別した、未検証経路の回帰試験。
const seed: BackupSpec = {
  masterVersion: 'screen-fixture-v1',
  baselines: [eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 6]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 20), valueBaseline('resource:7', 40)],
  goals: [goal({ goalId: 'g1', equipmentId: ID.mainGunA, targetStar: 6 })],
};
const later = '2026-10-14T03:00:00.000Z';
const retryTime = '2026-10-14T03:05:00.000Z';

for (const kind of ['記録', '確認待ち', '訂正', '過去記録'] as const) {
  test(`公開準備：${kind}の保存後の読み直し失敗に日付変更・通知が重なっても保存結果を確認できる`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-14T14:59:50.000Z') });
    await start(page, { data: seed, clockIso: '2026-10-14T14:59:50.000Z' });
    await openRecord(page, kind === '確認待ち' ? '失敗' : '成功');
    const button = kind === '記録' ? 'この内容で記録' : kind === '訂正' ? 'この内容で訂正' : kind === '過去記録' ? 'この内容で確定' : '実施済み・確認待ちで保存';
    if (kind === '確認待ち') {
      await page.getByRole('button', { name: '実施済み・確認待ち', exact: true }).click();
      await page.getByText('ゲームで実施済みです').click();
    } else {
      if (kind === '過去記録') await page.getByText('最新の所持データを取り込む前に実施した記録漏れ').click();
      await page.getByRole('button', { name: '内容を確認' }).click();
      if (kind === '訂正') {
        await page.getByRole('button', { name: 'この内容で記録' }).click();
        await page.waitForURL(/#\/calendar/);
        const event = (await state(page)).resultEvents[0]!;
        await page.goto(`/#/history/events/${encodeURIComponent(event.eventId)}/correct`);
        await page.getByLabel('訂正の理由（任意）').fill('日付をまたぐ再送の確認');
        await page.getByRole('button', { name: '内容を確認' }).click();
      } else if (kind === '過去記録') {
        await page.getByRole('button', { name: '種類ごとの反映を確認' }).click();
        for (const name of ['装備', '改修資材', '開発資材']) await page.getByLabel(`${name}の今回の実績の扱い`).selectOption('apply');
      }
    }
    await page.clock.pauseAt(new Date('2026-10-14T14:59:51.000Z'));
    await failRefresh(page);
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByText('保存処理の後に最新データを読み直せませんでした。').first()).toBeVisible();
    const saved = await state(page);
    await page.clock.setFixedTime(new Date('2026-10-14T15:00:01.000Z'));
    // 他タブの保存通知によって、表示だけが新しい日付・保存済みの在庫に変わる。
    await page.evaluate(() => {
      const channel = new BroadcastChannel('kancolle-improvement-planner');
      channel.postMessage({ type: 'changed' });
      channel.close();
    });
    await expect(page.getByRole('status').first()).toContainText('保存済み');
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.waitForURL(kind === '記録' ? /#\/calendar/ : /#\/history/);
    const retried = await state(page);
    expect(retried.resultEvents).toEqual(saved.resultEvents);
    expect(retried.drafts).toEqual(saved.drafts);
    expect(retried.meta.revision).toBe(saved.meta.revision);
  });
}

test('公開準備：読み直し失敗後に入力を変更した場合、前の要求を黙って再送しない', async ({ page }) => {
  await start(page, { data: seed });
  await openRecord(page);
  await page.getByRole('button', { name: '内容を確認' }).click();
  await failRefresh(page);
  await page.getByRole('button', { name: 'この内容で記録' }).click();
  await expect(page.getByText('保存処理の後に最新データを読み直せませんでした。').first()).toBeVisible();
  const saved = await state(page);
  await page.getByLabel('改修資材', { exact: true }).fill('1');
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で記録' }).click();
  await expect(page.getByText('別のタブなどで内容が変更されました。').first()).toBeVisible();
  expect((await state(page)).resultEvents).toEqual(saved.resultEvents);
  expect((await state(page)).meta.revision).toBe(saved.meta.revision);
  expect(page.url()).toContain('/record');
});

async function openRecord(page: Page, outcome: '成功' | '失敗' = '成功') {
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: '結果を記録' }).first().click();
  await page.getByRole('radio', { name: outcome }).click();
}

async function saveDraft(page: Page) {
  await openRecord(page, '失敗');
  await page.getByLabel('改修資材', { exact: true }).fill('2');
  await page.getByRole('button', { name: '実施済み・確認待ち', exact: true }).click();
  await page.getByText('ゲームで実施済みです').click();
  await page.getByRole('button', { name: '実施済み・確認待ちで保存' }).click();
  await page.waitForURL(/#\/history/);
}

async function failRefresh(page: Page) {
  await page.evaluate(() => window.__kaishu!.failLoad(1));
}

test('公開準備：保護の保存後に読み直しが失敗しても、理由を表示し、押し直しで重複保存しない', async ({ page }) => {
  const bucket = `${ID.materialA}:0`;
  await start(page, { data: seed, route: `/inventory/protection/${bucket}` });
  await page.getByRole('button', { name: '1個増やす' }).click();
  await failRefresh(page);
  await page.getByRole('button', { name: '保護1個に変更' }).click();
  await expect.poll(async () => (await state(page)).protections.find(p => p.bucket === bucket)?.count).toBe(1);
  await expect(page.getByText('保存処理の後に最新データを読み直せませんでした。').first()).toBeVisible();
  const saved = await state(page);
  await page.clock.setFixedTime(new Date(retryTime));
  await page.getByRole('button', { name: '保護1個に変更' }).click();
  await page.waitForURL(/#\/inventory\/equipment$/);
  const retried = await state(page);
  expect(retried.protections).toEqual(saved.protections);
  expect(retried.meta.revision).toBe(saved.meta.revision);
});

test('公開準備：確認待ちの取消後に読み直しが失敗しても、押し直しで履歴・版を重複させない', async ({ page }) => {
  await start(page, { data: seed });
  await saveDraft(page);
  await page.getByRole('link', { name: '実施していなかった' }).click();
  await page.getByLabel('訂正理由（必須）').fill('予定と取り違えた');
  await failRefresh(page);
  await page.getByRole('button', { name: '未実施として訂正' }).click();
  await expect.poll(async () => (await state(page)).drafts[0]?.status).toBe('cancelled');
  const saved = await state(page);
  await page.clock.setFixedTime(new Date(retryTime));
  await page.getByRole('button', { name: '未実施として訂正' }).click();
  await page.waitForURL(/#\/history\?tab=drafts$/);
  const retried = await state(page);
  expect(retried.drafts).toEqual(saved.drafts);
  expect(retried.meta.revision).toBe(saved.meta.revision);
  expect(retried.attempts.filter(a => a.lifecycle === 'active' && a.outcome === 'none')).toHaveLength(1);
});

test('公開準備：訂正の確定日時を押下時に作り、読み直し失敗後の再送では同じ日時と履歴を保つ', async ({ page }) => {
  await start(page, { data: seed });
  await openRecord(page);
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: 'この内容で記録' }).click();
  await page.waitForURL(/#\/calendar/);
  const id = (await state(page)).resultEvents[0]!.eventId;
  await page.goto(`/#/history/events/${encodeURIComponent(id)}/correct`);
  await page.getByLabel('訂正の理由（任意）').fill('日時と再送の確認');
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.clock.setFixedTime(new Date(later));
  await failRefresh(page);
  await page.getByRole('button', { name: 'この内容で訂正' }).click();
  await expect.poll(async () => (await state(page)).resultEvents[0]?.revision).toBe(2);
  const saved = (await state(page)).resultEvents[0]!;
  expect(saved.recordedAt).toBe(later);
  await page.clock.setFixedTime(new Date(retryTime));
  await page.getByRole('button', { name: 'この内容で訂正' }).click();
  await page.waitForURL(/#\/history$/);
  expect((await state(page)).resultEvents).toEqual([saved]);
});

test('公開準備：確認待ちの確定日時を押下時に作り、読み直し失敗後の再送で下書きを二重に作らない', async ({ page }) => {
  await start(page, { data: seed });
  await openRecord(page, '失敗');
  await page.getByRole('button', { name: '実施済み・確認待ち', exact: true }).click();
  await page.getByText('ゲームで実施済みです').click();
  await page.clock.setFixedTime(new Date(later));
  await failRefresh(page);
  await page.getByRole('button', { name: '実施済み・確認待ちで保存' }).click();
  await expect.poll(async () => (await state(page)).drafts.length).toBe(1);
  const saved = (await state(page)).drafts[0]!;
  expect(saved.createdAt).toBe(later);
  await page.clock.setFixedTime(new Date(retryTime));
  await page.getByRole('button', { name: '実施済み・確認待ちで保存' }).click();
  await page.waitForURL(/#\/history/);
  expect((await state(page)).drafts).toEqual([saved]);
});

test('公開準備：過去実績の確定日時を押下時に作り、読み直し失敗後の再送で二重に減算しない', async ({ page }) => {
  await start(page, { data: seed });
  await openRecord(page);
  await page.getByText('最新の所持データを取り込む前に実施した記録漏れ').click();
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: '種類ごとの反映を確認' }).click();
  for (const name of ['装備', '改修資材', '開発資材']) await page.getByLabel(`${name}の今回の実績の扱い`).selectOption('historyOnly');
  await page.clock.setFixedTime(new Date(later));
  await failRefresh(page);
  await page.getByRole('button', { name: 'この内容で確定', exact: true }).click();
  await expect.poll(async () => (await state(page)).resultEvents.length).toBe(1);
  const saved = await state(page);
  expect(saved.resultEvents[0]!.recordedAt).toBe(later);
  await page.clock.setFixedTime(new Date(retryTime));
  await page.getByRole('button', { name: 'この内容で確定', exact: true }).click();
  await page.waitForURL(/#\/history$/);
  const retried = await state(page);
  expect(retried.resultEvents).toEqual(saved.resultEvents);
  expect(retried.baselines).toEqual(saved.baselines);
  expect(retried.meta.revision).toBe(saved.meta.revision);
});

for (const kind of ['個別スキップ', '一日分スキップ', '記録', '確認待ち', '訂正', '同日再挑戦'] as const) {
  test(`公開準備：${kind}の画面を開いたままJST日付をまたいでも、前日の操作を保存しない`, async ({ page }) => {
    const beforeMidnight = '2026-10-14T14:59:50.000Z';
    await page.clock.install({ time: new Date(beforeMidnight) });
    await start(page, { data: seed, clockIso: beforeMidnight });
    const a = (await state(page)).attempts.find(a => a.lifecycle === 'active' && a.outcome === 'none')!;
    let button: string | RegExp;
    if (kind === '個別スキップ') {
      await page.goto(`/#/attempts/${encodeURIComponent(a.attemptId)}/skip`);
      button = 'この1件をスキップ';
    } else if (kind === '一日分スキップ') {
      await page.goto('/#/calendar/day/2026-10-14/skip');
      button = /この日の\d+件をスキップ/;
    } else if (kind === '同日再挑戦' || kind === '訂正') {
      await saveDraft(page);
      await page.getByRole('link', { name: '再開', exact: true }).click();
      // 失敗の実消費を確定しておく。
      for (const label of ['改修資材', '開発資材', '素材装備A ★0']) await page.getByRole('textbox', { name: label, exact: true }).fill('0');
      await page.getByRole('button', { name: '内容を確認' }).click();
      await page.getByRole('button', { name: 'この内容で記録' }).click();
      await page.waitForURL(/#\/calendar/);
      if (kind === '訂正') {
        const event = (await state(page)).resultEvents[0]!;
        await page.goto(`/#/history/events/${encodeURIComponent(event.eventId)}/correct`);
        await page.getByRole('button', { name: '内容を確認' }).click();
        button = 'この内容で訂正';
      } else {
        await page.goto('/#/calendar/day/2026-10-14');
        button = '同日に再挑戦する（上限内で追加）';
      }
    } else {
      await openRecord(page, kind === '確認待ち' ? '失敗' : '成功');
      if (kind === '確認待ち') {
        await page.getByRole('button', { name: '実施済み・確認待ち', exact: true }).click();
        await page.getByText('ゲームで実施済みです').click();
        button = '実施済み・確認待ちで保存';
      } else {
        await page.getByRole('button', { name: '内容を確認' }).click();
        button = 'この内容で記録';
      }
    }
    await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
    // URLに検索パラメーターがある場合は文書ごとの遷移になるため、起動完了も待つ。
    await page.waitForFunction(() => !!window.__kaishu);
    // 30秒ごとの日付確認より前の窓を決定的に再現する。Dateだけ翌日にし、タイマーは停止する。
    await page.clock.pauseAt(new Date('2026-10-14T14:59:51.000Z'));
    const saved = await state(page);
    await page.clock.setFixedTime(new Date('2026-10-14T15:00:01.000Z'));
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByText('日本時間の日付が変わりました。').first()).toBeVisible();
    const after = await state(page);
    expect(after.meta.revision).toBe(saved.meta.revision);
    expect(after.resultEvents).toEqual(saved.resultEvents);
    expect(after.drafts).toEqual(saved.drafts);
    expect(after.attempts).toEqual(saved.attempts);
    expect(after.daySkips).toEqual(saved.daySkips);
  });
}

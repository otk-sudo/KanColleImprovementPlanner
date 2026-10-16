import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BACKUP_FORMAT } from '../src/domain/backup';
import { ID, screenMaster } from './support/masters';
import { pasteAndApply, start, state } from './support/app';
import { backup, eqBaseline, fixClock, goal, serveFixtureMaster, shipBaseline, valueBaseline, type BackupSpec } from './support/scenario';

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

test('A10：通知で最新を表示していても、先に開いた編集フォームの確定は競合として扱い、フォームを最新に読み直す', async ({ context }) => {
  const withGoal: BackupSpec = { ...seed, goals: [goal({ goalId: 'g1', equipmentId: 1001, targetStar: 6, count: 1 })] };
  const a = await context.newPage();
  await start(a, { data: withGoal, route: '/goals/g1/edit' });
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await b.goto('/#/goals/g1/edit');
  await expect(b.locator('.goal-count output')).toHaveText('1');
  await b.getByRole('button', { name: '1個増やす' }).click();
  // A が先に個数を3にして保存する（B には通知が届き、表示用のデータは最新になる）
  await a.getByRole('button', { name: '1個増やす' }).click();
  await a.getByRole('button', { name: '1個増やす' }).click();
  await a.getByRole('button', { name: '目標を保存', exact: true }).click();
  await a.waitForURL(/#\/goals$/);
  await expect.poll(async () => (await state(b)).meta.revision).toBe((await state(a)).meta.revision);
  // B のフォームは開いた時点の内容なので、上書きせず競合として扱う
  await b.getByRole('button', { name: '目標を保存', exact: true }).click();
  await expect(b.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  expect((await state(b)).goals.find((g) => g.goalId === 'g1')?.count).toBe(3);
  await expect(b.locator('.goal-count output')).toHaveText('3');
  // 最新の内容を確認してから保存すれば反映できる
  await b.getByRole('button', { name: '1個増やす' }).click();
  await b.getByRole('button', { name: '目標を保存', exact: true }).click();
  await b.waitForURL(/#\/goals$/);
  expect((await state(b)).goals.find((g) => g.goalId === 'g1')?.count).toBe(4);
});

test('A10：設定の保存が別のタブの変更と競合したら、入力を最新の設定に読み直す（古い値で上書きしない）', async ({ context }) => {
  const a = await context.newPage();
  await start(a, { data: seed, route: '/settings' });
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await b.goto('/#/settings');
  await expect(b.locator('#search-days')).toHaveValue('366');
  await a.locator('#search-days').selectOption('90');
  await a.getByRole('button', { name: '設定を保存' }).click();
  await expect(a.getByText('設定を保存しました。')).toBeVisible();
  await expect.poll(async () => (await state(b)).meta.revision).toBe((await state(a)).meta.revision);
  // B は開いた時点の値（366日）のまま保存しようとする → 競合し、入力を最新（90日）に読み直す
  await b.getByRole('button', { name: '設定を保存' }).click();
  await expect(b.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  await expect(b.locator('#search-days')).toHaveValue('90');
  expect((await state(b)).settings.searchDays).toBe(90);
});

test('A10：同じ確定IDが別の内容で保存済みなら、新しいIDで黙って確定し直さず、知らせた後に押し直したときだけ保存する', async ({ page }) => {
  await start(page, { data: seed, route: '/settings' });
  await page.locator('#search-days').selectOption('90');
  await page.evaluate(() => window.__kaishu!.reuseNextCommandId());
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByText('別の内容で保存済みのため、この内容は保存していません。')).toBeVisible();
  expect((await state(page)).settings.searchDays).toBe(366);
  // 知らせた後に押し直した確定は、新しい確定IDで保存する
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByText('設定を保存しました。')).toBeVisible();
  expect((await state(page)).settings.searchDays).toBe(90);
});

test('A10：同じ確定IDの別の内容で版が進んでいたら、知らせた後に押し直した確定は競合として扱い、最新の設定に読み直す', async ({ page }) => {
  await start(page, { data: seed, route: '/settings' });
  await page.locator('#search-days').selectOption('90');
  // 別の内容の確定が、この確定IDで保存済み（版が1つ進んでいる）
  await page.evaluate(() => window.__kaishu!.reuseNextCommandId({ advanceRevision: true }));
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByText('別の内容で保存済みのため、この内容は保存していません。')).toBeVisible();
  // 画面の版は進めないので、押し直した確定は最新の版と比べて競合になり、入力を最新の設定に読み直す
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  await expect(page.locator('#search-days')).toHaveValue('366');
  expect((await state(page)).settings.searchDays).toBe(366);
  // 最新の内容を確認してから選び直した確定は保存する
  await page.locator('#search-days').selectOption('90');
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect(page.getByText('設定を保存しました。')).toBeVisible();
  expect((await state(page)).settings.searchDays).toBe(90);
});

test('A10：休みの追加の保存後に画面の読み直しだけが失敗しても、押し直せば休みを二重に追加しない', async ({ page }) => {
  await start(page, { data: seed, route: '/settings' });
  await page.locator('#holiday-start').fill('2026-10-20');
  await page.locator('#holiday-end').fill('2026-10-21');
  // 保存は成功し、その後の読み直しだけが失敗する（入力は残る）
  await page.evaluate(() => window.__kaishu!.failLoad(1));
  await page.getByRole('button', { name: '休みを追加' }).click();
  await expect.poll(async () => (await state(page)).settings.holidays.length).toBe(1);
  await expect(page.getByRole('button', { name: '休みを追加' })).toBeEnabled();
  // 同じ確定ID・同じ内容で送り直すので、保存済みとして受け付ける
  await page.getByRole('button', { name: '休みを追加' }).click();
  await expect(page.getByRole('list', { name: '登録済みの休み' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await state(page)).settings.holidays).toHaveLength(1);
});

test('A10：保護数の保存が別のタブの変更と競合したら、最新の保護設定に読み直す（古い値で上書きしない）', async ({ context }) => {
  const withEq: BackupSpec = { ...seed, baselines: [...seed.baselines!, eqBaseline([[ID.mainGunA, 6, 3]])] };
  const route = `/inventory/protection/${ID.mainGunA}:6`;
  const a = await context.newPage();
  await start(a, { data: withEq, route });
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await b.goto(`/#${route}`);
  await expect(b.getByRole('button', { name: '保護0個に変更' })).toBeVisible();
  await a.getByRole('button', { name: '1個増やす' }).click();
  await a.getByRole('button', { name: '1個増やす' }).click();
  await a.getByRole('button', { name: '保護2個に変更' }).click();
  await a.waitForURL(/#\/inventory\/equipment/);
  await expect.poll(async () => (await state(b)).meta.revision).toBe((await state(a)).meta.revision);
  // B は開いた時点の値（0個）から 1個にして保存しようとする → 競合し、最新（2個）に読み直す
  await b.getByRole('button', { name: '1個増やす' }).click();
  await b.getByRole('button', { name: '保護1個に変更' }).click();
  await expect(b.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  await expect(b.getByRole('button', { name: '保護2個に変更' })).toBeVisible();
  expect((await state(b)).protections.find((x) => x.bucket === `${ID.mainGunA}:6`)?.count).toBe(2);
});

test('A10：保護の確認中に別のタブで装備を取り込んだら、競合を知らせた後は最新の取り込みを前提に確認し直せる', async ({ context }) => {
  const reconciling: BackupSpec = {
    ...seed,
    baselines: [...seed.baselines!, eqBaseline([[ID.mainGunA, 6, 3]])],
    protections: [{ bucket: `${ID.mainGunA}:6`, equipmentId: ID.mainGunA, star: 6, count: 3, instanceIds: null, reason: '', reconciliationRequired: true, reconciliationSnapshotId: 'old', previousOwned: 3, updatedAt: '' }],
  };
  const route = `/inventory/protection/${ID.mainGunA}:6`;
  const a = await context.newPage();
  await start(a, { data: reconciling, route });
  await expect(a.getByRole('button', { name: '保護3個に変更' })).toBeVisible();
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await pasteAndApply(b, JSON.stringify([0, 1, 2].map(() => ({ id: ID.mainGunA, lv: 6 }))));
  await expect.poll(async () => (await state(a)).meta.revision).toBe((await state(b)).meta.revision);
  await a.getByRole('button', { name: '保護3個に変更' }).click();
  await expect(a.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  // 確認し直して保存すれば、最新の取り込みに対する確認として保存できる
  await a.getByRole('button', { name: '保護3個に変更' }).click();
  await a.waitForURL(/#\/inventory\/equipment/);
  expect((await state(a)).protections.find((x) => x.bucket === `${ID.mainGunA}:6`)?.reconciliationRequired).toBe(false);
});

test('A10：同じ記録を2つのタブで訂正したら、後から確定したタブは最新の訂正内容に読み直す', async ({ context }) => {
  const withPlan: BackupSpec = { ...seed, baselines: [...seed.baselines!, eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 3]]), shipBaseline([ID.shipAKai2])], goals: [goal({ goalId: 'g1', equipmentId: ID.mainGunA, targetStar: 6, count: 1 })] };
  const a = await context.newPage();
  await start(a, { data: withPlan, route: '/calendar' });
  await a.getByRole('link', { name: '結果を記録' }).first().click();
  await a.getByRole('radio', { name: '成功' }).click();
  await a.getByRole('button', { name: '内容を確認' }).click();
  await a.getByRole('button', { name: 'この内容で記録' }).click();
  await a.waitForURL(/#\/calendar/);
  const ev = (await state(a)).resultEvents[0]!;
  const route = `/history/events/${encodeURIComponent(ev.eventId)}/correct`;
  await a.goto(`/#${route}`);
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await b.goto(`/#${route}`);
  await expect(b.getByRole('radio', { name: '成功' })).toHaveAttribute('aria-checked', 'true');
  // A が失敗へ訂正する
  await a.getByRole('radio', { name: '失敗' }).click();
  await a.getByRole('button', { name: '内容を確認' }).click();
  await a.getByRole('button', { name: 'この内容で訂正' }).click();
  await a.waitForURL(/#\/history$/);
  await expect.poll(async () => (await state(b)).meta.revision).toBe((await state(a)).meta.revision);
  // B は開いた時点（成功）のまま確定しようとする → 競合し、最新（失敗）に読み直す
  await b.getByRole('textbox', { name: '訂正の理由（任意）' }).fill('B のメモ');
  await b.getByRole('button', { name: '内容を確認' }).click();
  await b.getByRole('button', { name: 'この内容で訂正' }).click();
  await expect(b.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  await expect(b.getByRole('radio', { name: '失敗' })).toHaveAttribute('aria-checked', 'true');
  expect((await state(b)).resultEvents[0]!.outcome).toBe('failure');
});

test('A10：同じ確認待ちを2つのタブで再開したら、後から保存したタブは最新の下書きに読み直し、確認し直してもらう', async ({ context }) => {
  const withPlan: BackupSpec = { ...seed, baselines: [...seed.baselines!, eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 3]]), shipBaseline([ID.shipAKai2])], goals: [goal({ goalId: 'g1', equipmentId: ID.mainGunA, targetStar: 6, count: 1 })] };
  const a = await context.newPage();
  await start(a, { data: withPlan, route: '/calendar' });
  await a.getByRole('link', { name: '結果を記録' }).first().click();
  await a.getByRole('radio', { name: '失敗' }).click();
  await a.getByLabel('改修資材', { exact: true }).fill('1');
  await a.getByRole('button', { name: '実施済み・確認待ち' }).click();
  await a.getByText('ゲームで実施済みです').click();
  await a.getByRole('button', { name: '実施済み・確認待ちで保存' }).click();
  await a.waitForURL(/#\/history/);
  const draftId = (await state(a)).drafts[0]!.draftId;
  const resume = `/history/drafts/${encodeURIComponent(draftId)}/resume`;
  await a.goto(`/#${resume}`);
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await b.goto(`/#${resume}`);
  await expect(b.getByLabel('改修資材', { exact: true })).toHaveValue('1');
  // A がネジを 3 に直して保存
  await a.getByLabel('改修資材', { exact: true }).fill('3');
  await a.getByRole('button', { name: '実施済み・確認待ち' }).click();
  await a.getByText('ゲームで実施済みです').click();
  await a.getByRole('button', { name: '実施済み・確認待ちで保存' }).click();
  await a.waitForURL(/#\/history/);
  await expect.poll(async () => (await state(b)).meta.revision).toBe((await state(a)).meta.revision);
  // B は開いた時点（1）のまま保存しようとする → 競合し、最新（3）に読み直して確認をやり直す
  await b.getByRole('button', { name: '実施済み・確認待ち' }).click();
  await b.getByText('ゲームで実施済みです').click();
  await b.getByRole('button', { name: '実施済み・確認待ちで保存' }).click();
  await expect(b.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  await expect(b.getByText(/改修資材：3個/)).toBeVisible();
  await expect(b.getByRole('button', { name: '実施済み・確認待ちで保存' })).toBeDisabled();
  expect((await state(b)).drafts[0]!.knownConsumptions).toContainEqual({ scope: 'resource:8', amount: -3 });
});

test('A10：保護する個体を選んでいる間に別のタブで個体が入れ替わったら、競合後は最新の個体から選び直せる', async ({ context }) => {
  const slot = (ids: number[]) => `svdata=${JSON.stringify({ api_result: 1, api_data: ids.map((id) => ({ api_id: id, api_slotitem_id: ID.mainGunA, api_level: 6 })) })}`;
  const route = `/inventory/protection/${ID.mainGunA}:6`;
  const a = await context.newPage();
  // A は通知が届かない古いタブ（競合するまで画面の個体の一覧が古いまま）
  await a.addInitScript(() => {
    // @ts-expect-error テスト用にタブ間通知を無効化する
    delete window.BroadcastChannel;
  });
  await start(a, { data: seed, route: '/import' });
  await pasteAndApply(a, slot([1, 2]));
  await a.goto(`/#${route}`);
  await a.getByLabel('個体ID 1').check();
  await a.getByLabel('個体ID 2').check();
  await a.getByRole('button', { name: '保護2個に変更' }).click();
  await a.waitForURL(/#\/inventory\/equipment/);
  await a.goto(`/#${route}`);
  // 別のタブで、同じ★の個体が入れ替わった所持を取り込む
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await pasteAndApply(b, slot([3, 4]));
  await expect(a.getByLabel('個体ID 1')).toBeVisible(); // A の画面はまだ古い個体の一覧
  await a.getByRole('button', { name: '保護2個に変更' }).click();
  await expect(a.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  // 消えた個体は選択から外れ、最新の個体から選び直して保存できる
  await expect(a.getByRole('button', { name: '保護0個に変更' })).toBeVisible();
  await a.getByLabel('個体ID 3').check();
  await a.getByRole('button', { name: '保護1個に変更' }).click();
  await a.waitForURL(/#\/inventory\/equipment/);
  expect((await state(a)).protections.find((x) => x.bucket === `${ID.mainGunA}:6`)?.instanceIds).toEqual([3]);
});

test('A10：別のタブで削除した目標を、先に開いていた編集フォームから復活させない', async ({ context }) => {
  const withGoal: BackupSpec = { ...seed, goals: [goal({ goalId: 'g1', equipmentId: 1001, targetStar: 6, count: 1 })] };
  const a = await context.newPage();
  await start(a, { data: withGoal, route: '/goals/g1/edit' });
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await b.goto('/#/goals/g1/edit');
  await expect(b.locator('.goal-count output')).toHaveText('1');
  await a.getByRole('button', { name: 'この目標を削除' }).click();
  await a.getByRole('button', { name: '削除する' }).click();
  await a.waitForURL(/#\/goals$/);
  await expect(b.getByText('この目標は見つかりません。')).toBeVisible();
  await expect(b.getByRole('button', { name: '目標を保存', exact: true })).toHaveCount(0);
  expect((await state(b)).goals.some((g) => g.goalId === 'g1')).toBe(false);
});

test('A07/A10：日付変更の処理を保存できなければ警告を残し、開き直すと再試行する', async ({ page }) => {
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
  const withPlan: BackupSpec = { ...seed, baselines: [...seed.baselines!, eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 3]]), shipBaseline([ID.shipAKai2])], goals: [goal({ goalId: 'g1', equipmentId: ID.mainGunA, targetStar: 6, count: 1 })] };
  await start(page, { data: withPlan, route: '/calendar' });
  await expect.poll(async () => (await state(page)).attempts.filter((a) => a.scheduledDate === '2026-10-14').length).toBe(1);
  await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = true));
  await page.clock.setFixedTime(new Date('2026-10-15T00:00:00.000Z')); // 10/15 09:00 JST
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('日付変更の処理（未完了の予定の繰越）を保存できませんでした。').first()).toBeVisible();
  expect((await state(page)).attempts.some((a) => a.lifecycle === 'superseded')).toBe(false);
  // 保存できる状態で開き直すと再試行し、警告を消す
  await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = false));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('日付変更の処理（未完了の予定の繰越）を保存できませんでした。')).toHaveCount(0);
  expect((await state(page)).attempts.filter((a) => a.lifecycle === 'superseded')).toHaveLength(1);
});

test('A07：端末の時刻が前回より戻ったら警告を表示し、確認するまで残す', async ({ page }) => {
  await start(page, { data: seed, route: '/calendar' });
  await page.clock.setFixedTime(new Date('2026-10-13T23:00:00.000Z')); // 10/14 08:00 JST（1時間戻る）
  await page.reload();
  await page.waitForSelector('h1');
  await expect(page.getByText('端末の時刻が前回より戻っています。')).toBeVisible();
  await page.goto('/#/history');
  await expect(page.getByText('端末の時刻が前回より戻っています。')).toBeVisible();
  await page.getByRole('button', { name: '時刻の警告を確認しました' }).click();
  await expect(page.getByText('端末の時刻が前回より戻っています。')).toHaveCount(0);
  expect((await state(page)).meta.clockWarning).toBeNull();
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

test('A10：復元後の日付変更の処理を保存できなければ、完了と表示せず再試行できる', async ({ page }) => {
  await start(page, { data: seed, route: '/settings' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'バックアップを書き出す' }).click();
  const json = readFileSync(await (await download).path(), 'utf8');
  await page.locator('input[type=file]').setInputFiles({ name: 'kaishu-backup.json', mimeType: 'application/json', buffer: Buffer.from(json, 'utf8') });
  await page.waitForURL(/#\/settings\/restore$/);
  const pre = page.waitForEvent('download');
  await page.getByRole('button', { name: '復元前の保存へ進む' }).click();
  await pre;
  await page.evaluate(() => window.__kaishu!.failRollover(1));
  await page.getByRole('button', { name: 'この内容で復元する' }).click();
  await expect(page.getByText('バックアップは復元しましたが、日付変更の処理（未完了の予定の繰越）を保存できませんでした。')).toBeVisible();
  await expect(page.getByText('バックアップを復元しました。')).toHaveCount(0);
  await page.getByRole('button', { name: '日付変更の処理を再試行' }).click();
  await page.waitForURL(/#\/calendar/);
  await expect(page.getByText('バックアップを復元しました。')).toBeVisible();
});

test('A10：復元前の保存の後に別のタブで変更されたら、復元せずに復元前の保存をやり直させる', async ({ context }) => {
  const a = await context.newPage();
  await start(a, { data: seed, route: '/settings' });
  const download = a.waitForEvent('download');
  await a.getByRole('button', { name: 'バックアップを書き出す' }).click();
  const json = readFileSync(await (await download).path(), 'utf8');
  await a.locator('input[type=file]').setInputFiles({ name: 'kaishu-backup.json', mimeType: 'application/json', buffer: Buffer.from(json, 'utf8') });
  await a.waitForURL(/#\/settings\/restore$/);
  const pre = a.waitForEvent('download');
  await a.getByRole('button', { name: '復元前の保存へ進む' }).click();
  await pre;
  // 別のタブで所持データを変更する（A の復元前の保存には含まれない）
  const b = await context.newPage();
  await serveFixtureMaster(b, screenMaster());
  await fixClock(b);
  await pasteAndApply(b, material(77));
  await expect.poll(async () => (await state(a)).meta.revision).toBe((await state(b)).meta.revision);
  await a.getByRole('button', { name: 'この内容で復元する' }).click();
  await expect(a.getByText('別のタブなどで内容が変更されました。')).toBeVisible();
  // 復元前の保存をやり直すまで復元できない
  await expect(a.getByRole('button', { name: 'この内容で復元する' })).toHaveCount(0);
  await expect(a.getByRole('button', { name: '復元前の保存へ進む' })).toBeVisible();
  expect((await state(a)).baselines.find((x) => x.scope === 'resource:8')?.value).toBe(77);
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

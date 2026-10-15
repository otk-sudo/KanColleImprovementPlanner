import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import type { Attempt, ResultEvent } from '../src/domain/model';
import type { MasterFile } from '../src/domain/master/schema';
import { ID, imageMaster, screenMaster, shipsMaster } from './support/masters';
import { backup, eqBaseline, goal, IMPORTED_AT, openScenario, shipBaseline, valueBaseline, type BackupSpec } from './support/scenario';

// 画面設計 S01〜S34 と「同一状態」を作り、1440×940 で撮影する（比較は scripts/compare-screens.mjs）。
// 数値・装備条件は画面設計と同じ架空例。実データ・個人データは使わない。

const VARIANT = process.env.SCREENS_VARIANT ?? 'app';
const OUT = `work/screens/${VARIANT}`;
mkdirSync(OUT, { recursive: true });

const main = screenMaster();
const mv = main.masterVersion;
const always = { mode: 'always' as const, fromStar: null };

async function shot(page: Page, id: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 939);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${id}.png` });
}

function hist(date: string, n: number, transition: Attempt['transition'], outcome: 'success' | 'failure' | 'skip', goalId = 'g-main'): { attempt: Attempt; event: ResultEvent } {
  const stepKey = `hist|${date}|${n}`;
  const attemptId = `${stepKey}@1`;
  const eventId = `ev-${date}-${n}`;
  return {
    attempt: { attemptId, stepKey, goalId, transition, scheduledDate: date, dayOrder: 1, outcome, lifecycle: 'active', executionGate: 'ready', predecessorAttemptId: null, createdAt: IMPORTED_AT, helperShipId: ID.shipAKai2, mode: 'guaranteed', resultEventId: eventId, cancelReason: null },
    event: {
      eventId,
      attemptId,
      stepKey,
      goalId,
      originalSequence: n,
      revision: 1,
      status: 'active',
      outcome,
      occurredDateJst: date,
      occurredOrder: 1,
      recordedAt: IMPORTED_AT,
      deltas: [],
      historyOnlyScopes: [],
      fromDraftId: null,
      recipeSnapshot: { masterVersion: mv, transition, fromName: '', toName: '', mode: 'guaranteed', entryIndex: 0, plannedCost: null, helperShipId: ID.shipAKai2, helperShipName: '艦娘A改二' },
      inputSourceEventIds: [],
      history: [],
    },
  };
}

const imp = (eq: number, from: number) => ({ kind: 'improve' as const, equipmentId: eq, fromStar: from, toStar: from + 1 });

/** S01・S18・S13・S24・S25 の共通状態：主砲A ★5→★6 が今日（ネジ2個不足で仮配置） */
function calendarSpec(limit = 1): BackupSpec {
  const past = [hist('2026-10-02', 1, imp(ID.mainGunA, 0), 'success'), hist('2026-10-05', 2, imp(ID.mainGunA, 1), 'success'), hist('2026-10-07', 3, imp(ID.mainGunA, 2), 'success'), hist('2026-10-09', 4, imp(ID.mainGunA, 3), 'success'), hist('2026-10-12', 5, imp(ID.mainGunA, 4), 'success')];
  return {
    masterVersion: mv,
    baselines: [eqBaseline([[ID.mainGunA, 5, 1], [ID.mainGunA, 7, 1], [ID.materialA, 0, 3], [ID.secondaryB, 9, 1], [ID.aaGunC, 5, 1]], 5), shipBaseline([ID.shipAKai2], 5), valueBaseline('resource:8', 2, 5), valueBaseline('resource:7', 40, 5)],
    attempts: past.map((p) => p.attempt),
    events: past.map((p) => p.event),
    goals: [
      goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 10, count: 2, guarantee: always, priority: 1 }),
      goal({ goalId: 'g-b', equipmentId: ID.secondaryB, targetStar: 10, count: 1, priority: 2 }),
      goal({ goalId: 'g-c', equipmentId: ID.aaGunC, targetStar: 6, count: 1, priority: 3 }),
    ],
    settings: { weekdayLimits: [limit, limit, limit, limit, limit, limit, limit] },
  };
}

function goalSpec(extra: Partial<BackupSpec> = {}): BackupSpec {
  return {
    masterVersion: mv,
    baselines: [eqBaseline([[ID.mainGunA, 6, 1], [ID.mainGunA, 5, 2], [ID.materialA, 0, 3], [ID.gunBase, 10, 1]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 2), valueBaseline('resource:7', 40), valueBaseline('resource:5', 15)],
    goals: [goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 6, count: 3, guarantee: always, priority: 1 }), goal({ goalId: 'g-up', equipmentId: ID.gunUpgraded, targetStar: 0, count: 1, routeKey: `${ID.gunBase}>${ID.gunUpgraded}`, priority: 2 })],
    ...extra,
  };
}

async function todayAttemptId(page: Page): Promise<string> {
  const state = (await page.evaluate(() => window.__kaishu!.state())) as { attempts: Attempt[] };
  const a = state.attempts.find((x) => x.scheduledDate === '2026-10-14' && x.outcome === 'none' && x.lifecycle === 'active');
  if (!a) throw new Error('今日の予定がありません');
  return a.attemptId;
}

async function open(page: Page, master: MasterFile, spec: BackupSpec | null, route: string) {
  await openScenario(page, { master, data: spec ? backup(spec) : undefined, route });
}

test.describe.configure({ mode: 'serial' });

test('S01 カレンダー', async ({ page }) => {
  await open(page, main, calendarSpec(), '/calendar?month=2026-10&date=2026-10-14');
  await shot(page, 'S01');
});

test('S02 週間予定', async ({ page }) => {
  // S02 の参照は「ネジ4 / 釘6」だけの例（素材装備を含まない）
  const m = screenMaster({ mainDays: [1, 3, 5, 6, 0], mainWithoutMaterial: true });
  const past = hist('2026-10-12', 1, imp(ID.mainGunA, 5), 'success');
  await open(
    page,
    m,
    {
      masterVersion: m.masterVersion,
      baselines: [eqBaseline([[ID.mainGunA, 5, 4], [ID.materialA, 0, 8], [ID.secondaryB, 9, 1], [ID.aaGunC, 5, 1]], 1), shipBaseline([ID.shipAKai2], 1), valueBaseline('resource:8', 2, 1), valueBaseline('resource:7', 40, 1)],
      attempts: [past.attempt],
      events: [past.event],
      goals: [goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 6, count: 4, guarantee: always }), goal({ goalId: 'g-b', equipmentId: ID.secondaryB, targetStar: 10, priority: 2 }), goal({ goalId: 'g-c', equipmentId: ID.aaGunC, targetStar: 6, priority: 3 })],
      settings: { weekdayLimits: [1, 1, 0, 1, 0, 1, 1] },
    },
    '/calendar/week?start=2026-10-12',
  );
  await shot(page, 'S02');
});

test('S03 改修目標', async ({ page }) => {
  const m = imageMaster();
  await open(
    page,
    m,
    {
      masterVersion: m.masterVersion,
      baselines: [eqBaseline([[ID.mainGunA, 6, 1], [ID.mainGunA, 5, 2], [ID.materialA, 0, 3], [ID.secondaryB, 9, 1], [ID.aaGunC, 5, 2], [ID.radarC, 3, 1], [ID.seaplaneB, 2, 1]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 2), valueBaseline('resource:7', 40)],
      goals: [
        goal({ goalId: 'g1', equipmentId: ID.mainGunA, targetStar: 6, count: 3, guarantee: always, priority: 1 }),
        goal({ goalId: 'g2', equipmentId: ID.secondaryB, targetStar: 10, count: 1, matchMode: 'exact', priority: 2 }),
        goal({ goalId: 'g3', equipmentId: ID.aaGunC, targetStar: 6, count: 2, priority: 3 }),
        goal({ goalId: 'g4', equipmentId: ID.radarC, targetStar: 0, count: 1, priority: 4 }),
        goal({ goalId: 'g5', equipmentId: ID.seaplaneB, targetStar: 0, count: 1, priority: 5 }),
      ],
    },
    '/goals',
  );
  await shot(page, 'S03');
});

test('S04 目標を追加', async ({ page }) => {
  await open(page, main, { ...goalSpec({ goals: [] }), baselines: [eqBaseline([[ID.mainGunA, 6, 1], [ID.mainGunA, 5, 2], [ID.materialA, 0, 4]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 2), valueBaseline('resource:7', 40)] }, '/goals/new');
  await page.getByRole('combobox', { name: '装備名で検索' }).fill('主砲A');
  await page.getByRole('option', { name: /主砲A/ }).getByRole('button').click();
  await page.getByLabel('目標改修値').selectOption('6');
  await page.getByRole('button', { name: '1個増やす' }).click();
  await page.getByRole('button', { name: '1個増やす' }).click();
  await page.getByLabel('確実化する段階').selectOption('from6');
  await shot(page, 'S04');
});

test('S05 必要素材', async ({ page }) => {
  await open(page, main, goalSpec(), '/materials');
  await shot(page, 'S05');
});

const protectionSpec: BackupSpec = {
  masterVersion: mv,
  baselines: [eqBaseline([[ID.mainGunA, 6, 2], [ID.mainGunA, 5, 2], [ID.materialA, 0, 3]]), shipBaseline([ID.shipAKai2, ID.shipB]), valueBaseline('resource:8', 2), valueBaseline('resource:7', 40)],
  goals: [goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 6, count: 1, guarantee: always }), goal({ goalId: 'g-ten', equipmentId: ID.mainGunA, targetStar: 10, count: 2, guarantee: always, priority: 2 }), goal({ goalId: 'g-b', equipmentId: ID.secondaryB, targetStar: 6, priority: 3 }), goal({ goalId: 'g-d', equipmentId: ID.equipD, targetStar: 1, priority: 4 })],
  protections: [{ bucket: `${ID.mainGunA}:6`, equipmentId: ID.mainGunA, star: 6, count: 3, instanceIds: null, reason: '手動保護', reconciliationRequired: true, reconciliationSnapshotId: 'snap-eq', previousOwned: 3, updatedAt: IMPORTED_AT }],
};

test('S06 所持データ', async ({ page }) => {
  await open(page, main, protectionSpec, '/inventory/equipment');
  await shot(page, 'S06');
});

test('S07 データ取り込み', async ({ page }) => {
  await open(page, main, goalSpec(), '/import');
  await shot(page, 'S07');
});

test('S08 74式ENから取り込む', async ({ page }) => {
  await open(page, main, { ...goalSpec(), baselines: [...goalSpec().baselines!.filter((b) => b.scope !== 'resource:5'), valueBaseline('resource:5', 12)] }, '/import/file');
  const body = `svdata=${JSON.stringify({ api_result: 1, api_result_msg: '成功', api_data: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ api_member_id: 1, api_id: id, api_value: id === 8 ? 15 : id === 7 ? 55 : id === 5 ? 12 : 3000 })) })}`;
  await page.locator('input[type=file]').setInputFiles({ name: '20261014_093000_S@api_get_member@material.json', mimeType: 'application/json', buffer: Buffer.from(body, 'utf8') });
  await page.getByText('読み込み成功').waitFor();
  await shot(page, 'S08');
});

test('S09 実績・繰り越し', async ({ page }) => {
  const r1 = hist('2026-10-12', 1, imp(ID.mainGunA, 4), 'success');
  const r2 = hist('2026-10-09', 2, imp(ID.radarC, 3), 'failure', 'g-r');
  const r3 = hist('2026-10-07', 3, imp(ID.seaplaneB, 2), 'skip', 'g-s');
  // 10/07 のスキップは翌日処理済み（後継は工程が不要になり取消）という状態にする
  r3.attempt.lifecycle = 'cancelled';
  const pending: Attempt = { attemptId: 'g-main|1001:5>6|0@1', stepKey: 'g-main|1001:5>6|0', goalId: 'g-main', transition: imp(ID.mainGunA, 5), scheduledDate: '2026-10-09', dayOrder: 2, outcome: 'none', lifecycle: 'active', executionGate: 'ready', predecessorAttemptId: null, createdAt: IMPORTED_AT, helperShipId: ID.shipAKai2, mode: 'guaranteed', resultEventId: null, cancelReason: null };
  await open(
    page,
    main,
    {
      masterVersion: mv,
      baselines: [eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 3], [ID.radarC, 3, 1], [ID.seaplaneB, 2, 1]], 3), shipBaseline([ID.shipAKai2], 3), valueBaseline('resource:8', 10, 3), valueBaseline('resource:7', 40, 3)],
      attempts: [r1.attempt, r2.attempt, r3.attempt, pending],
      events: [r1.event, r2.event, r3.event],
      goals: [goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 6, count: 1, guarantee: always })],
      lastProcessedDateJst: '2026-10-09',
    },
    '/history',
  );
  await shot(page, 'S09');
});

test('S10 予定と保存の設定', async ({ page }) => {
  await open(page, main, { ...goalSpec(), settings: { weekdayLimits: [2, 2, 0, 2, 0, 2, 2] } }, '/settings');
  await page.getByLabel('開始日').fill('2026-10-20');
  await page.getByLabel('終了日').fill('2026-10-22');
  await shot(page, 'S10');
});

test('S11 取り込みガイド', async ({ page }) => {
  await open(page, main, goalSpec(), '/guide/browser');
  await shot(page, 'S11');
});

test('S12 74式ENの取り込みガイド', async ({ page }) => {
  await open(page, main, goalSpec(), '/guide/74en');
  await shot(page, 'S12');
});

test('S13 改修結果を記録', async ({ page }) => {
  await open(page, main, calendarSpec(), '/calendar');
  const id = await todayAttemptId(page);
  await page.goto(`/#/attempts/${encodeURIComponent(id)}/record`);
  await page.waitForSelector('h1');
  await shot(page, 'S13');
});

test('S14 配置できない予定', async ({ page }) => {
  await open(page, main, calendarSpec(), '/unplaced');
  await shot(page, 'S14');
});

test('S15 はじめての改修計画', async ({ page }) => {
  await open(page, main, null, '/');
  await shot(page, 'S15');
});

test('S16 所持艦娘', async ({ page }) => {
  const m = shipsMaster();
  await open(
    page,
    m,
    {
      masterVersion: m.masterVersion,
      baselines: [eqBaseline([[ID.mainGunA, 5, 1]]), shipBaseline([ID.shipAKai2, ID.shipCKai])],
      goals: [goal({ goalId: 'g1', equipmentId: ID.mainGunA, targetStar: 6 }), goal({ goalId: 'g2', equipmentId: ID.secondaryB, targetStar: 6, priority: 2 }), goal({ goalId: 'g3', equipmentId: ID.equipD, targetStar: 1, priority: 3 })],
    },
    '/inventory/ships',
  );
  await shot(page, 'S16');
});

test('S17 資材・アイテム', async ({ page }) => {
  // S17 の参照は同じ使用アイテムを「更新用アイテム」と表記している（S05 は「更新用アイテムB」）
  await open(page, screenMaster({ names: { [ID.itemB]: '更新用アイテム' } }), goalSpec(), '/inventory/items');
  await shot(page, 'S17');
});

test('S18 日付を指定して確認', async ({ page }) => {
  const spec = calendarSpec(2);
  spec.baselines = [eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 3], [ID.secondaryB, 9, 1], [ID.aaGunC, 5, 1]], 5), ...spec.baselines!.slice(1)];
  spec.goals = [goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 6, count: 1, guarantee: always }), ...spec.goals!.slice(1)];
  await open(page, main, spec, '/calendar/day/2026-10-14');
  await shot(page, 'S18');
});

test('S19 工程と改修条件', async ({ page }) => {
  await open(page, main, goalSpec(), '/goals/g-main/steps');
  await shot(page, 'S19');
});

test('S20 取り込みエラー', async ({ page }) => {
  await open(page, main, goalSpec(), '/import');
  await page.getByLabel('コピーしたレスポンス').fill('{ "api_data": [ {"api_id": 1');
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByText('取り込めませんでした').waitFor();
  await shot(page, 'S20');
});

async function pickBackup(page: Page, data: BackupSpec, name: string) {
  await page.goto('/#/settings');
  await page.waitForSelector('h1');
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...backup(data), createdAt: '2026-10-13T12:00:00.000Z' }), 'utf8') });
  await page.waitForURL(/restore/);
  await page.waitForSelector('h1');
}

test('S21 バックアップを復元', async ({ page }) => {
  await open(page, main, goalSpec({ goals: goalSpec().goals!.concat(goal({ goalId: 'g-x', equipmentId: ID.secondaryB, targetStar: 3, priority: 3 })) }), '/settings');
  await pickBackup(page, goalSpec({ goals: goalSpec().goals!.concat(goal({ goalId: 'g-x', equipmentId: ID.secondaryB, targetStar: 3, priority: 3 })) }), 'kaishu-backup-20261013.json');
  await shot(page, 'S21');
});

test('S22 画像付きの装備・担当艦表示', async ({ page }) => {
  const m = imageMaster();
  await open(page, m, { masterVersion: m.masterVersion, baselines: [eqBaseline([[ID.mainGunA, 6, 2], [ID.mainGunA, 0, 1]]), shipBaseline([ID.shipAKai2])], goals: [goal({ goalId: 'g1', equipmentId: ID.mainGunA, targetStar: 6, count: 2 })] }, `/inventory/equipment/${ID.mainGunA}`);
  await shot(page, 'S22');
});

test('S23 画像でわかるJSONの反映手順', async ({ page }) => {
  await open(page, main, goalSpec(), '/guide/steps/browser/3');
  await shot(page, 'S23');
  await page.goto('/#/guide/steps/browser/1');
  await page.waitForSelector('h1');
  await shot(page, 'S23-step1');
});

test('S24 この改修をスキップ', async ({ page }) => {
  await open(page, main, calendarSpec(), '/calendar');
  const id = await todayAttemptId(page);
  await page.goto(`/#/attempts/${encodeURIComponent(id)}/skip`);
  await page.waitForSelector('h1');
  await shot(page, 'S24');
});

test('S25 この日の予定をスキップ', async ({ page }) => {
  await open(page, main, calendarSpec(), '/calendar/day/2026-10-14/skip');
  await shot(page, 'S25');
});

test('S26 装備データだけを更新', async ({ page }) => {
  await open(page, main, goalSpec(), '/import');
  const items = [
    ...Array.from({ length: 4 }, () => ({ id: ID.mainGunA, lv: 6 })),
    ...Array.from({ length: 3 }, () => ({ id: ID.mainGunA, lv: 5 })),
    ...Array.from({ length: 2 }, () => ({ id: ID.materialA, lv: 0 })),
    { id: ID.gunBase, lv: 10 },
  ];
  await page.getByLabel('コピーしたレスポンス').fill(JSON.stringify(items));
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.waitForURL(/preview/);
  await page.waitForSelector('h1');
  await shot(page, 'S26');
});

test('S27 最新の所持データを反映', async ({ page }) => {
  const ev = hist('2026-10-13', 1, imp(ID.mainGunA, 3), 'failure');
  ev.event.deltas = [{ scope: 'resource:8', amount: -4 }];
  await open(page, main, { ...goalSpec(), baselines: [eqBaseline([[ID.mainGunA, 6, 1], [ID.mainGunA, 5, 2], [ID.materialA, 0, 3]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 10), valueBaseline('resource:7', 40)], attempts: [ev.attempt], events: [ev.event] }, '/import');
  await page.getByLabel('コピーしたレスポンス').fill(JSON.stringify({ api_result: 1, api_data: [{ api_id: 8, api_value: 10 }] }));
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.waitForURL(/preview/);
  await page.getByRole('button', { name: '反映内容を確認' }).click();
  await page.waitForURL(/confirm/);
  await shot(page, 'S27');
});

test('S28 実施済み・消費確認待ち', async ({ page }) => {
  // S28 の参照は素材装備A を「素材装備」と表記している
  await open(page, screenMaster({ names: { [ID.materialA]: '素材装備' } }), calendarSpec(), '/calendar');
  const id = await todayAttemptId(page);
  await page.goto(`/#/attempts/${encodeURIComponent(id)}/record`);
  await page.getByRole('radio', { name: '失敗' }).click();
  await page.getByLabel('改修資材').fill('4');
  await page.getByRole('button', { name: '実施済み・確認待ち' }).click();
  await page.waitForURL(/draft/);
  await page.getByText('ゲームで実施済みです').click();
  await shot(page, 'S28');
});

function rolledSpec(successorOutcome: 'failure' | null): BackupSpec {
  const orig: Attempt = { attemptId: 'g-main|1001:5>6|0@1', stepKey: 'g-main|1001:5>6|0', goalId: 'g-main', transition: imp(ID.mainGunA, 5), scheduledDate: '2026-10-13', dayOrder: 1, outcome: 'none', lifecycle: 'superseded', executionGate: 'ready', predecessorAttemptId: null, createdAt: IMPORTED_AT, helperShipId: ID.shipAKai2, mode: 'guaranteed', resultEventId: null, cancelReason: null };
  const succ: Attempt = { ...orig, attemptId: 'g-main|1001:5>6|0@2', scheduledDate: '2026-10-14', lifecycle: 'active', predecessorAttemptId: orig.attemptId, outcome: successorOutcome ?? 'none', resultEventId: successorOutcome ? 'ev-succ' : null };
  const events: ResultEvent[] = successorOutcome
    ? [{ eventId: 'ev-succ', attemptId: succ.attemptId, stepKey: succ.stepKey, goalId: 'g-main', originalSequence: 1, revision: 1, status: 'active', outcome: successorOutcome, occurredDateJst: '2026-10-14', occurredOrder: 1, recordedAt: IMPORTED_AT, deltas: [{ scope: 'resource:8', amount: -1 }], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] }]
    : [];
  return {
    masterVersion: mv,
    baselines: [{ ...eqBaseline([[ID.mainGunA, 5, 1], [ID.materialA, 0, 3]]), importedAt: '2026-10-12T00:00:00.000Z' }, shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 10), valueBaseline('resource:7', 40)],
    attempts: [orig, succ],
    events,
    goals: [goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 6, count: 1, guarantee: always })],
    settings: { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] },
  };
}

async function recordPast(page: Page, answers: Record<string, string>) {
  await page.goto(`/#/attempts/${encodeURIComponent('g-main|1001:5>6|0@1')}/record`);
  await page.getByRole('radio', { name: '成功' }).click();
  await page.getByLabel('実施日').fill('2026-10-13');
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByRole('button', { name: '種類ごとの反映を確認' }).click();
  await page.waitForURL(/past/);
  for (const [label, choice] of Object.entries(answers)) {
    await page.getByRole('group', { name: new RegExp(label) }).getByRole('combobox').selectOption({ label: choice });
  }
}

test('S29 過去の記録と後続予定を確認', async ({ page }) => {
  await open(page, main, rolledSpec('failure'), '/history');
  await recordPast(page, { '^装備': '所持数に反映', '改修資材': '履歴だけに記録', '開発資材': '所持数に反映' });
  await page.getByRole('button', { name: 'この内容で確定' }).click();
  await page.waitForURL(/rollover/);
  await shot(page, 'S29');
});

test('S30 前提工程を確認', async ({ page }) => {
  await open(
    page,
    main,
    {
      masterVersion: mv,
      baselines: [eqBaseline([[ID.mainGunA, 0, 1], [ID.materialA, 0, 1], [ID.craftSource, 10, 1]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 20), valueBaseline('resource:7', 40)],
      goals: [goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 1, count: 1, matchMode: 'exact', materialRoutes: { [ID.materialA]: { kind: 'craft', routeKey: `${ID.craftSource}>${ID.materialA}` } } })],
      settings: { weekdayLimits: [3, 3, 3, 3, 3, 3, 3] },
    },
    '/calendar/day/2026-10-14',
  );
  const state = (await page.evaluate(() => window.__kaishu!.state())) as { attempts: Attempt[] };
  const craft = state.attempts.find((a) => a.stepKey.includes('craft') && a.scheduledDate === '2026-10-14')!;
  await page.goto(`/#/attempts/${encodeURIComponent(craft.attemptId)}/skip`);
  await page.getByRole('button', { name: 'この1件をスキップ' }).click();
  await page.waitForURL(/calendar/);
  const after = (await page.evaluate(() => window.__kaishu!.state())) as { attempts: Attempt[] };
  const target = after.attempts.find((a) => !a.stepKey.includes('craft') && a.scheduledDate === '2026-10-14')!;
  await page.goto(`/#/attempts/${encodeURIComponent(target.attemptId)}/pending`);
  await page.waitForSelector('h1');
  await shot(page, 'S30');
});

test('S31 確認待ちの記録を訂正', async ({ page }) => {
  await open(page, main, calendarSpec(), '/calendar');
  const id = await todayAttemptId(page);
  await page.goto(`/#/attempts/${encodeURIComponent(id)}/record`);
  await page.getByRole('radio', { name: '失敗' }).click();
  await page.getByLabel('改修資材').fill('4');
  await page.getByRole('button', { name: '実施済み・確認待ち' }).click();
  await page.getByText('ゲームで実施済みです').click();
  await page.getByRole('button', { name: '実施済み・確認待ちで保存' }).click();
  await page.waitForURL(/history/);
  await page.getByRole('link', { name: '実施していなかった' }).click();
  await page.waitForURL(/cancel/);
  // 参照は理由欄に入力済み（確定ボタンが有効）の状態
  await page.getByLabel('訂正理由（必須）').fill('例：予定を実績と取り違えて登録していました。');
  await shot(page, 'S31');
});

test('S32 マスター不足のバックアップを復元', async ({ page }) => {
  await open(page, main, goalSpec(), '/settings');
  // 参照の例は目標3件のバックアップ
  const goals = [...goalSpec().goals!, goal({ goalId: 'g-b', equipmentId: ID.secondaryB, targetStar: 6, priority: 3 })];
  await pickBackup(page, { ...goalSpec(), goals, masterVersion: 'sample-v2' }, 'kaishu-backup-20261013.json');
  await page.getByText('予定が保留のままになることを確認しました').click();
  await shot(page, 'S32');
});

test('S33 保護設定を確認', async ({ page }) => {
  await open(page, main, protectionSpec, `/inventory/protection/${ID.mainGunA}:6`);
  await shot(page, 'S33');
});

test('S34 過去の実績と所持数への反映', async ({ page }) => {
  // S34 の参照は★の変化だけを示す例（素材装備の消費を含まない）
  await open(page, screenMaster({ mainWithoutMaterial: true }), rolledSpec(null), '/history');
  await recordPast(page, { '^装備': '所持数に反映', '改修資材': '履歴だけに記録' });
  await shot(page, 'S34');
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type Locator, type Page } from '@playwright/test';
import type { Attempt, ResultEvent } from '../src/domain/model';
import { ID, screenMaster } from './support/masters';
import { backup, eqBaseline, goal, IMPORTED_AT, openScenario, shipBaseline, valueBaseline, type BackupSpec } from './support/scenario';

// 取り込みガイド（S11/S12/S23）に載せる「このアプリの画面」を架空データで撮影する。
// ゲーム画像・個人データは含めない（画像表示は無効の設定で撮影）。注釈枠の位置は要素の実座標から求めて
// work/guide-annotations.json に書き出し、src/features/guide/guideData.ts の値と照合する。

const OUT = 'public/guide';
mkdirSync(OUT, { recursive: true });
mkdirSync('work', { recursive: true });

// ナビとヘッダーを除いた本文部分を切り出す
const CLIP = { x: 232, y: 72, width: 1208, height: 828 };
const PAD = 6;

const master = screenMaster();
const mv = master.masterVersion;

function spec(extra: Partial<BackupSpec> = {}): BackupSpec {
  return {
    masterVersion: mv,
    baselines: [eqBaseline([[ID.mainGunA, 6, 1], [ID.mainGunA, 5, 2], [ID.materialA, 0, 3]]), shipBaseline([ID.shipAKai2]), valueBaseline('resource:8', 10), valueBaseline('resource:7', 40), valueBaseline('resource:5', 12)],
    goals: [goal({ goalId: 'g-main', equipmentId: ID.mainGunA, targetStar: 6, count: 3, guarantee: { mode: 'always', fromStar: null } })],
    ...extra,
  };
}

async function open(page: Page, data: BackupSpec, route: string) {
  await openScenario(page, { master, data: backup(data), route });
}

const result: Record<string, { n: number; x: number; y: number; w: number; h: number }[]> = {};

async function shoot(page: Page, file: string, marks: Locator[]) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 939);
  await page.waitForTimeout(150);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const boxes = [];
  for (const [i, m] of marks.entries()) {
    const b = await m.boundingBox();
    if (!b) throw new Error(`${file}: 注釈 ${i + 1} の要素が見つかりません`);
    boxes.push({
      n: i + 1,
      x: round((b.x - PAD - CLIP.x) / CLIP.width),
      y: round((b.y - PAD - CLIP.y) / CLIP.height),
      w: round((b.width + PAD * 2) / CLIP.width),
      h: round((b.height + PAD * 2) / CLIP.height),
    });
  }
  result[file] = boxes;
  await page.screenshot({ path: `${OUT}/${file}`, clip: CLIP });
}

test.afterAll(() => {
  writeFileSync('work/guide-annotations.json', JSON.stringify(result, null, 2));
});

test('ブラウザ：取り込む内容を確認（S26 相当）', async ({ page }) => {
  await open(page, spec(), '/import');
  const items = [...Array.from({ length: 4 }, () => ({ id: ID.mainGunA, lv: 6 })), ...Array.from({ length: 3 }, () => ({ id: ID.mainGunA, lv: 5 })), ...Array.from({ length: 2 }, () => ({ id: ID.materialA, lv: 0 })), { id: ID.gunBase, lv: 10 }];
  await page.getByLabel('コピーしたレスポンス').fill(JSON.stringify(items));
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.waitForURL(/preview/);
  await page.waitForSelector('h1');
  await shoot(page, 'browser-03-preview.png', [page.locator('.import-ok-banner'), page.locator('.import-scope-card'), page.getByRole('button', { name: '反映内容を確認' })]);
});

test('ブラウザ・74式EN共通：反映して所持数を確認（S27 相当）', async ({ page }) => {
  const attempt: Attempt = { attemptId: 'h1@1', stepKey: 'h1', goalId: 'g-main', transition: { kind: 'improve', equipmentId: ID.mainGunA, fromStar: 3, toStar: 4 }, scheduledDate: '2026-10-13', dayOrder: 1, outcome: 'failure', lifecycle: 'active', executionGate: 'ready', predecessorAttemptId: null, createdAt: IMPORTED_AT, helperShipId: ID.shipAKai2, mode: 'guaranteed', resultEventId: 'ev1', cancelReason: null };
  const event: ResultEvent = {
    eventId: 'ev1',
    attemptId: 'h1@1',
    stepKey: 'h1',
    goalId: 'g-main',
    originalSequence: 1,
    revision: 1,
    status: 'active',
    outcome: 'failure',
    occurredDateJst: '2026-10-13',
    occurredOrder: 1,
    recordedAt: IMPORTED_AT,
    deltas: [{ scope: 'resource:8', amount: -4 }],
    historyOnlyScopes: [],
    fromDraftId: null,
    recipeSnapshot: { masterVersion: mv, transition: attempt.transition, fromName: '', toName: '', mode: 'guaranteed', entryIndex: 0, plannedCost: null, helperShipId: ID.shipAKai2, helperShipName: '艦娘A改二' },
    inputSourceEventIds: [],
    history: [],
  };
  await open(page, spec({ attempts: [attempt], events: [event] }), '/import');
  await page.getByLabel('コピーしたレスポンス').fill(JSON.stringify({ api_result: 1, api_data: [{ api_id: 8, api_value: 10 }] }));
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.waitForURL(/preview/);
  await page.getByRole('button', { name: '反映内容を確認' }).click();
  await page.waitForURL(/confirm/);
  await shoot(page, 'browser-04-confirm.png', [page.locator('.import-apply-card'), page.locator('.import-keep-card'), page.getByRole('button', { name: '最新の所持データとして反映' })]);
});

test('74式EN：ファイルを選んで内容を確認（S08 相当）', async ({ page }) => {
  await open(page, spec(), '/import/file');
  const body = `svdata=${JSON.stringify({ api_result: 1, api_result_msg: '成功', api_data: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ api_member_id: 1, api_id: id, api_value: id === 8 ? 15 : id === 7 ? 55 : id === 5 ? 12 : 3000 })) })}`;
  await page.locator('input[type=file]').setInputFiles({ name: '20261014_093000_S@api_get_member@material.json', mimeType: 'application/json', buffer: Buffer.from(body, 'utf8') });
  await page.getByText('読み込み成功').waitFor();
  await shoot(page, '74en-03-preview.png', [page.locator('.import-file-line').first(), page.locator('.import-file-values'), page.getByRole('button', { name: '反映内容を確認' })]);
});

import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, type BackupData } from '../../src/domain/backup';
import type { MasterFile } from '../../src/domain/master/schema';
import type { Attempt, Baseline, DraftResult, Goal, Protection, ResultEvent, Settings } from '../../src/domain/model';
import { DEFAULT_SETTINGS } from '../../src/domain/model';

// 画面比較・E2E 用の状態を作る。架空のマスターと架空の所持データだけを使う（個人データを使わない）。

export const TODAY_ISO = '2026-10-14T00:00:00.000Z'; // 2026-10-14 09:00 JST

export async function serveFixtureMaster(page: Page, master: MasterFile) {
  const body = JSON.stringify(master);
  const sha = createHash('sha256').update(body).digest('hex').toUpperCase();
  const manifest = { schemaVersion: 1, masterVersion: master.masterVersion, file: `master-${master.masterVersion}.json`, sha256: sha, counts: {}, sources: master.sources.map((s) => ({ id: s.id, commit: s.commit, sha256: s.sha256, checkedAt: s.checkedAt, license: s.license })) };
  await page.route('**/master/manifest.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }));
  await page.route(`**/master/master-${master.masterVersion}.json`, (r) => r.fulfill({ contentType: 'application/json', body }));
}

export async function fixClock(page: Page, iso = TODAY_ISO) {
  await page.clock.setFixedTime(new Date(iso));
}

export interface BackupSpec {
  masterVersion: string;
  baselines?: Baseline[];
  events?: ResultEvent[];
  drafts?: DraftResult[];
  attempts?: Attempt[];
  goals?: Goal[];
  protections?: Protection[];
  settings?: Partial<Settings>;
  daySkips?: { date: string; createdAt: string }[];
  preferredHelpers?: { stepKey: string; shipId: number }[];
  lastProcessedDateJst?: string;
}

export function backup(spec: BackupSpec): BackupData {
  const events = spec.events ?? [];
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: 'e2e',
    createdAt: '2026-10-13T12:00:00.000Z',
    datasetEpoch: 'e2e',
    masterVersion: spec.masterVersion,
    meta: { nextSequence: Math.max(1, ...events.map((e) => e.originalSequence + 1)), lastProcessedDateJst: spec.lastProcessedDateJst ?? '2026-10-14', revision: 1 },
    baselines: spec.baselines ?? [],
    resultEvents: events,
    drafts: spec.drafts ?? [],
    attempts: spec.attempts ?? [],
    goals: spec.goals ?? [],
    protections: spec.protections ?? [],
    settings: { ...DEFAULT_SETTINGS, ...spec.settings },
    preferredHelpers: spec.preferredHelpers ?? [],
    daySkips: spec.daySkips ?? [],
  };
}

export const IMPORTED_AT = '2026-10-14T00:00:00.000Z';

export function eqBaseline(buckets: [number, number, number][], included = 0): Baseline {
  return {
    scope: 'equipment',
    snapshotId: 'snap-eq',
    importedAt: IMPORTED_AT,
    sourceCapturedAt: null,
    inputHash: 'e2e',
    sourceKind: 'simpleEquipment',
    includedThroughSequence: included,
    includedDraftIds: [],
    equipment: { granularity: 'aggregate', buckets: buckets.map(([equipmentId, star, count]) => ({ equipmentId, star, count })), instances: null },
    ships: null,
    value: null,
  };
}

export function shipBaseline(shipIds: number[], included = 0): Baseline {
  return { scope: 'ships', snapshotId: 'snap-ship', importedAt: IMPORTED_AT, sourceCapturedAt: null, inputHash: 'e2e', sourceKind: 'port', includedThroughSequence: included, includedDraftIds: [], equipment: null, ships: shipIds.map((shipId, i) => ({ instanceId: i + 1, shipId })), value: null };
}

export function valueBaseline(scope: `resource:${number}` | `item:${number}`, value: number, included = 0, importedAt = IMPORTED_AT): Baseline {
  return { scope, snapshotId: `snap-${scope}`, importedAt, sourceCapturedAt: null, inputHash: 'e2e', sourceKind: scope.startsWith('item') ? 'useItem' : 'port', includedThroughSequence: included, includedDraftIds: [], equipment: null, ships: null, value };
}

export function goal(partial: Partial<Goal> & Pick<Goal, 'goalId' | 'equipmentId' | 'targetStar'>): Goal {
  return {
    count: 1,
    matchMode: 'atLeast',
    priority: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    routeKey: null,
    guarantee: { mode: 'never', fromStar: null },
    updateGuarantee: false,
    materialRoutes: {},
    achievedAt: null,
    ...partial,
  };
}

export async function openScenario(page: Page, opts: { master: MasterFile; data?: BackupData; route: string; clockIso?: string }) {
  await serveFixtureMaster(page, opts.master);
  await fixClock(page, opts.clockIso);
  await page.goto('/');
  await page.waitForFunction(() => !!window.__kaishu);
  if (opts.data) {
    const status = await page.evaluate((json) => window.__kaishu!.restore(json), JSON.stringify(opts.data));
    if (status !== 'APPLIED') throw new Error(`restore failed: ${status}`);
  }
  // 起動時の再計算・繰越を反映するため、文書ごと読み込み直して目的の画面を開く
  await page.goto(`/?scenario=${Date.now()}#${opts.route}`);
  await page.waitForSelector('h1');
  await page.evaluate(() => document.fonts.ready);
}

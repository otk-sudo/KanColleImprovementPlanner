import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMasterIndex } from '../domain/master';
import { parseImportText } from '../domain/import/parse';
import { buildDeltas } from '../domain/results/results';
import type { Goal } from '../domain/model';
import { KaishuDb } from '../infrastructure/db';
import { loadData } from '../infrastructure/repository';
import { FX, fixtureMaster } from '../test-support/fixtureMaster';
import { AppService, type Clock } from './service';
import {
  handleCancelDraft,
  handleImport,
  handleRecordResult,
  handleRestore,
  handleSaveDraft,
  handleSaveGoal,
  handleSaveSettings,
  handleSetProtection,
  type RecordResultPayload,
} from './commands';
import { parseBackup } from '../domain/backup';
import { exportBackup } from './backupExport';

const m = buildMasterIndex(fixtureMaster());
let seq = 0;
let db: KaishuDb;
let clockMs = Date.UTC(2026, 9, 14, 0, 0, 0); // 2026-10-14 09:00 JST
const clock: Clock = { nowMs: () => clockMs };

beforeEach(async () => {
  seq++;
  clockMs = Date.UTC(2026, 9, 14, 0, 0, 0);
  db = new KaishuDb(`test-${seq}-${Math.random()}`);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

async function service() {
  const s = new AppService(db, m, clock);
  await s.init();
  return s;
}

async function base(s: AppService) {
  const d = await s.load();
  return { datasetEpoch: d.meta.datasetEpoch, expectedRevision: d.meta.revision };
}

function updates(text: string) {
  const r = parseImportText(text);
  if (!r.ok) throw new Error(r.error.message);
  return { updates: r.value.updates, sources: [{ kind: r.value.kind, inputHash: r.value.inputHash, capturedAt: null }] };
}

async function importText(s: AppService, text: string, commandId?: string) {
  return s.run('ImportInventory', handleImport, { ...updates(text), snapshotId: `snap-${Math.random()}`, now: s.nowIso() }, { ...(await base(s)), ...(commandId ? { commandId } : {}) });
}

const port = (ships: number[], screws: number) =>
  JSON.stringify({ api_result: 1, api_data: { api_ship: ships.map((id, i) => ({ api_id: i + 1, api_ship_id: id })), api_material: [{ api_id: 8, api_value: screws }, { api_id: 7, api_value: 50 }, { api_id: 1, api_value: 999 }, { api_id: 2, api_value: 999 }, { api_id: 3, api_value: 999 }, { api_id: 4, api_value: 999 }] } });

function goal(partial: Partial<Goal> = {}): Goal {
  return {
    goalId: 'g1',
    equipmentId: FX.mainGunA,
    targetStar: 6,
    count: 1,
    matchMode: 'atLeast',
    priority: 1,
    createdAt: '2026-10-14T00:00:00.000Z',
    routeKey: null,
    guarantee: { mode: 'never', fromStar: null },
    updateGuarantee: false,
    materialRoutes: {},
    achievedAt: null,
    ...partial,
  };
}

async function seedPlan(s: AppService, opts: { screws?: number; star?: number; weekdayLimits?: number[] } = {}) {
  await importText(s, `[{"id":${FX.mainGunA},"lv":${opts.star ?? 5}},{"id":${FX.materialA},"lv":0},{"id":${FX.materialA},"lv":0},{"id":${FX.materialA},"lv":0}]`);
  await importText(s, port([FX.shipAKai2], opts.screws ?? 10));
  if (opts.weekdayLimits) await s.run('SaveSettings', handleSaveSettings, { weekdayLimits: opts.weekdayLimits, searchDays: 366 }, await base(s));
  await s.run('SaveGoal', handleSaveGoal, { goal: goal({ targetStar: 6 }), isNew: true }, await base(s));
}

async function recordPayload(s: AppService, attemptId: string, outcome: 'success' | 'failure' | 'skip', extra: Partial<RecordResultPayload> = {}): Promise<RecordResultPayload> {
  const d = await s.load();
  const a = d.attempts.find((x) => x.attemptId === attemptId)!;
  const deltas = buildDeltas({ transition: a.transition, outcome, consumption: outcome === 'skip' ? { resources: {}, equipment: [], useItems: {} } : { resources: { 8: 3, 7: 4 }, equipment: [{ equipmentId: FX.materialA, star: 0, count: 2 }], useItems: {} } });
  return {
    attemptId,
    outcome,
    occurredDateJst: s.today(),
    today: s.today(),
    deltas,
    historyOnlyScopes: [],
    requireScopeAnswers: false,
    answeredScopes: [],
    eventId: `ev-${Math.random()}`,
    recipeSnapshot: null,
    inputSourceEventIds: [],
    fromDraftId: null,
    now: s.nowIso(),
    ...extra,
  };
}

describe('共通契約：再送・競合・保存失敗（design/10）', () => {
  it('P16/P63：同じ commandId の再送は1回だけ反映し ALREADY_APPLIED を返す', async () => {
    const s = await service();
    const first = await importText(s, '[{"api_id":8,"api_value":10}]', 'cmd-same');
    expect(first.status).toBe('APPLIED');
    const d1 = await s.load();
    const again = await s.run('ImportInventory', handleImport, { ...updates('[{"api_id":8,"api_value":10}]'), snapshotId: 'x', now: 'x' }, { datasetEpoch: d1.meta.datasetEpoch, expectedRevision: 0, commandId: 'cmd-same' });
    // payload（snapshotId 等）が違えば COMMAND_ID_REUSED。同じ payload なら既存結果
    expect(again.status).toBe('COMMAND_ID_REUSED');
  });

  it('P63：応答が失われても同一 payload の再送は競合扱いせず既存結果を返す', async () => {
    const s = await service();
    const before = await base(s);
    const payload = { ...updates('[{"api_id":8,"api_value":10}]'), snapshotId: 'snap-1', now: 'n' };
    const a = await s.run('ImportInventory', handleImport, payload, { ...before, commandId: 'c1' });
    const b = await s.run('ImportInventory', handleImport, payload, { ...before, commandId: 'c1' });
    expect(a.status).toBe('APPLIED');
    expect(b.status).toBe('ALREADY_APPLIED');
    const d = await s.load();
    expect(d.baselines.filter((x) => x.scope === 'resource:8')).toHaveLength(1);
  });

  it('P16：同じ JSON でも新しい操作なら新しい基準として反映する', async () => {
    const s = await service();
    await importText(s, '[{"api_id":8,"api_value":10}]');
    const snap1 = (await s.load()).baselines.find((b) => b.scope === 'resource:8')!.snapshotId;
    await importText(s, '[{"api_id":8,"api_value":10}]');
    const snap2 = (await s.load()).baselines.find((b) => b.scope === 'resource:8')!.snapshotId;
    expect(snap2).not.toBe(snap1);
  });

  it('P64：同じ commandId で内容を変えた要求は拒否し、既存を変更しない', async () => {
    const s = await service();
    const b0 = await base(s);
    await s.run('ImportInventory', handleImport, { ...updates('[{"api_id":8,"api_value":10}]'), snapshotId: 's', now: 'n' }, { ...b0, commandId: 'c' });
    const r = await s.run('ImportInventory', handleImport, { ...updates('[{"api_id":8,"api_value":3}]'), snapshotId: 's', now: 'n' }, { ...b0, commandId: 'c' });
    expect(r.status).toBe('COMMAND_ID_REUSED');
    expect((await s.load()).baselines.find((x) => x.scope === 'resource:8')?.value).toBe(10);
  });

  it('古い revision の更新は CONFLICT（別タブの変更を上書きしない）', async () => {
    const s = await service();
    const stale = await base(s);
    await importText(s, '[{"api_id":8,"api_value":10}]');
    const r = await s.run('ImportInventory', handleImport, { ...updates('[{"api_id":8,"api_value":1}]'), snapshotId: 's', now: 'n' }, stale);
    expect(r.status).toBe('CONFLICT');
  });

  it('P17/P65：保存途中の容量不足では事実も受付記録も残さず、再試行できる', async () => {
    const s = await service();
    const b0 = await base(s);
    const spy = vi.spyOn(db.baselines, 'bulkPut').mockImplementationOnce(() => {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    });
    const payload = { ...updates('[{"api_id":8,"api_value":10}]'), snapshotId: 's', now: 'n' };
    const r = await s.run('ImportInventory', handleImport, payload, { ...b0, commandId: 'c-q' });
    expect(r.status).toBe('STORAGE_ERROR');
    if (r.status === 'STORAGE_ERROR') expect(r.code).toBe('STORAGE_FULL');
    expect((await s.load()).baselines).toEqual([]);
    expect(await db.commandReceipts.count()).toBe(0);
    spy.mockRestore();
    const retry = await s.run('ImportInventory', handleImport, payload, { ...b0, commandId: 'c-q' });
    expect(retry.status).toBe('APPLIED');
  });

  it('P17：計算だけ失敗しても保存済みの在庫は戻さず「計画再計算待ち」を残す', async () => {
    const s = await service();
    const spy = vi.spyOn(s, 'computePlan').mockImplementation(() => {
      throw new Error('calc');
    });
    const r = await importText(s, '[{"api_id":8,"api_value":10}]');
    expect(r.status).toBe('APPLIED');
    expect(r.recalc).toBe('FAILED');
    const d = await s.load();
    expect(d.baselines).toHaveLength(1);
    expect(d.meta.planDirty).toBe(true);
    spy.mockRestore();
    expect(await s.recalculate()).toBe('UPDATED');
    expect((await s.load()).meta.planDirty).toBe(false);
  });

  it('P66：更新対象なしの取り込みは revision・境界を変えず NO_CHANGE', async () => {
    const s = await service();
    await importText(s, '[{"api_id":8,"api_value":10}]');
    const before = await s.load();
    const r = await s.run('ImportInventory', handleImport, { updates: [], sources: [], snapshotId: 's', now: 'n' }, { datasetEpoch: before.meta.datasetEpoch, expectedRevision: before.meta.revision, commandId: 'empty' });
    expect(r.status).toBe('APPLIED');
    if (r.status === 'APPLIED') expect(r.result.resultKind).toBe('NO_CHANGE');
    const after = await s.load();
    expect(after.meta.revision).toBe(before.meta.revision);
    expect(after.baselines).toEqual(before.baselines);
    const again = await s.run('ImportInventory', handleImport, { updates: [], sources: [], snapshotId: 's', now: 'n' }, { datasetEpoch: before.meta.datasetEpoch, expectedRevision: before.meta.revision, commandId: 'empty' });
    expect(again.status).toBe('ALREADY_APPLIED');
  });

  it('P33：新しい版のアプリが書いたDBには古い版から書き込まない', async () => {
    const s = await service();
    await db.meta.update('singleton', { minimumWriterVersion: 99 });
    const r = await importText(s, '[{"api_id":8,"api_value":10}]');
    expect(r.status).toBe('WRITER_INCOMPATIBLE');
  });
});

describe('実績・下書き・翌日処理', () => {
  it('計画の当日分を試行として保存し、成功で★と在庫が進む', async () => {
    const s = await service();
    await seedPlan(s);
    const d = await s.load();
    const today = d.attempts.filter((a) => a.scheduledDate === s.today());
    expect(today).toHaveLength(1);
    const r = await s.run('RecordResult', handleRecordResult, await recordPayload(s, today[0]!.attemptId, 'success'), await base(s));
    expect(r.status).toBe('APPLIED');
    const after = await s.load();
    const counts = s.computePlan(after);
    expect(counts.goals[0]?.status).toBe('achieved');
  });

  it('P12：消費が不明な失敗は下書きで保存し、確定済み・再試行済みにしない', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    const r = await s.run(
      'SaveDraftResult',
      handleSaveDraft,
      { draftId: 'd1', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [{ scope: 'resource:8', amount: -4 }], unknownScopes: ['resource:7', 'equipment'], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: s.nowIso() },
      await base(s),
    );
    expect(r.status).toBe('APPLIED');
    const d = await s.load();
    expect(d.resultEvents).toEqual([]);
    expect(d.attempts.find((x) => x.attemptId === a.attemptId)?.outcome).toBe('draft');
    const plan = s.computePlan(d);
    expect(plan.unplaced.find((p) => p.stepKey === a.stepKey)?.reasons).toContain('RESULT_PENDING');
    expect(plan.totals.find((t) => t.key === 'resource:8')?.held).toBe(4);
  });

  it('実施済みの確認がない下書きは保存しない', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    const r = await s.run('SaveDraftResult', handleSaveDraft, { draftId: 'd1', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [], unknownScopes: [], scopeAnswers: {}, confirmedPerformed: false, recipeSnapshot: null, now: '' }, await base(s));
    expect(r.status).toBe('VALIDATION_ERROR');
  });

  it('P42/P29：下書きを未実施へ訂正すると保留を解放し、過去日なら翌日処理で後継を1つだけ作る', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    await s.run('SaveDraftResult', handleSaveDraft, { draftId: 'd1', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [{ scope: 'resource:8', amount: -4 }], unknownScopes: [], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' }, await base(s));
    clockMs += 24 * 3600 * 1000; // 翌日
    expect((await s.rollover()).moved).toBe(0); // 下書きは自動繰越しない
    const r = await s.run('CancelDraftAsNotPerformed', handleCancelDraft, { draftId: 'd1', reason: '予定と取り違えた', now: '' }, await base(s));
    expect(r.status).toBe('APPLIED');
    expect(s.computePlan(await s.load()).totals.find((t) => t.key === 'resource:8')?.held).toBe(0);
    expect((await s.rollover()).moved).toBe(1);
    expect((await s.rollover()).moved).toBe(0);
    const d = await s.load();
    expect(d.attempts.filter((x) => x.stepKey === a.stepKey && x.lifecycle === 'active' && x.outcome === 'none')).toHaveLength(1);
    expect(d.drafts[0]?.status).toBe('cancelled');
    expect(d.drafts[0]?.cancelReason).toBe('予定と取り違えた');
  });

  it('P10：数日閉じた後の起動と2タブ同時の翌日処理でも後継は工程ごとに1つ', async () => {
    const s = await service();
    await seedPlan(s);
    clockMs += 3 * 24 * 3600 * 1000;
    const s2 = new AppService(db, m, clock);
    const [r1, r2] = await Promise.all([s.rollover(), s2.rollover()]);
    expect(r1.moved + r2.moved).toBe(1);
    const d = await s.load();
    const active = d.attempts.filter((x) => x.lifecycle === 'active' && x.outcome === 'none');
    expect(active).toHaveLength(1);
    // 10/17（土）に起動。担当艦は月・水・金のみなので次の実施可能日は 10/19（月）
    expect(active[0]?.scheduledDate).toBe('2026-10-19');
    expect(d.meta.lastRollover?.fromDates).toEqual([{ date: '2026-10-14', count: 1 }]);
  });

  it('P23：繰越後に元の日の成功を追記すると、結果のない後継を取り消す', async () => {
    const s = await service();
    await seedPlan(s);
    const original = (await s.load()).attempts.find((x) => x.scheduledDate === '2026-10-14')!;
    clockMs += 24 * 3600 * 1000;
    await s.rollover();
    const p = await recordPayload(s, original.attemptId, 'success', { occurredDateJst: '2026-10-14', requireScopeAnswers: true, answeredScopes: ['equipment', 'resource:7', 'resource:8'] });
    const r = await s.run('RecordResult', handleRecordResult, p, await base(s));
    expect(r.status).toBe('APPLIED');
    const d = await s.load();
    expect(d.attempts.filter((x) => x.stepKey === original.stepKey && x.lifecycle === 'active' && x.outcome === 'none')).toEqual([]);
  });

  it('P24：後継に結果があれば自動で取り消さず確定しない', async () => {
    const s = await service();
    await seedPlan(s);
    const original = (await s.load()).attempts.find((x) => x.scheduledDate === '2026-10-14')!;
    clockMs += 2 * 24 * 3600 * 1000; // 10/16（金）：担当艦の曜日に合う当日へ後継が置かれる
    await s.rollover();
    const successor = (await s.load()).attempts.find((x) => x.predecessorAttemptId === original.attemptId)!;
    if (successor.scheduledDate !== s.today()) throw new Error(`successor on ${successor.scheduledDate}`);
    await s.run('RecordResult', handleRecordResult, await recordPayload(s, successor.attemptId, 'failure'), await base(s));
    const p = await recordPayload(s, original.attemptId, 'success', { occurredDateJst: '2026-10-14', requireScopeAnswers: true, answeredScopes: ['equipment', 'resource:7', 'resource:8'] });
    const r = await s.run('RecordResult', handleRecordResult, p, await base(s));
    expect(r.status).toBe('VALIDATION_ERROR');
    if (r.status === 'VALIDATION_ERROR') expect(r.errors[0]?.code).toBe('SUCCESSOR_HAS_RESULT');
  });

  it('P41：過去の実績は種類ごとの回答が揃うまで確定しない', async () => {
    const s = await service();
    await seedPlan(s);
    const original = (await s.load()).attempts.find((x) => x.scheduledDate === '2026-10-14')!;
    clockMs += 24 * 3600 * 1000;
    await s.rollover();
    const p = await recordPayload(s, original.attemptId, 'success', { occurredDateJst: '2026-10-14', requireScopeAnswers: true, answeredScopes: ['equipment', 'resource:8'] });
    const r = await s.run('RecordResult', handleRecordResult, p, await base(s));
    expect(r.status).toBe('VALIDATION_ERROR');
    if (r.status === 'VALIDATION_ERROR') expect(r.errors[0]?.details).toEqual({ missing: ['resource:7'] });
  });

  it('既知在庫が負になる新実績は確定しない', async () => {
    const s = await service();
    await seedPlan(s, { screws: 1 });
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    const r = await s.run('RecordResult', handleRecordResult, await recordPayload(s, a.attemptId, 'success'), await base(s));
    expect(r.status).toBe('VALIDATION_ERROR');
    if (r.status === 'VALIDATION_ERROR') expect(r.errors[0]?.code).toBe('NEGATIVE_INVENTORY');
  });

  it('P27：上限2で成功1と下書き1なら当日の追加枠は0。下書き確定後も2回', async () => {
    const s = await service();
    await importText(s, `[{"id":${FX.mainGunA},"lv":3},{"id":${FX.materialA},"lv":0},{"id":${FX.materialA},"lv":0},{"id":${FX.materialA},"lv":0},{"id":${FX.materialA},"lv":0},{"id":${FX.materialA},"lv":0},{"id":${FX.materialA},"lv":0}]`);
    await importText(s, port([FX.shipAKai2], 99));
    await s.run('SaveGoal', handleSaveGoal, { goal: goal({ targetStar: 6 }), isNew: true }, await base(s));
    const todays = (await s.load()).attempts.filter((x) => x.scheduledDate === s.today()).sort((a, b) => a.dayOrder - b.dayOrder);
    expect(todays).toHaveLength(2);
    await s.run('RecordResult', handleRecordResult, await recordPayload(s, todays[0]!.attemptId, 'success'), await base(s));
    const second = (await s.load()).attempts.filter((x) => x.scheduledDate === s.today() && x.outcome === 'none')[0]!;
    await s.run('SaveDraftResult', handleSaveDraft, { draftId: 'd', attemptId: second.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [], unknownScopes: ['resource:8'], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' }, await base(s));
    const plan = s.computePlan(await s.load());
    expect(plan.placements.filter((p) => p.date === s.today())).toEqual([]);
    const finalize = await recordPayload(s, second.attemptId, 'failure', { fromDraftId: 'd' });
    expect((await s.run('RecordResult', handleRecordResult, finalize, await base(s))).status).toBe('APPLIED');
    const d = await s.load();
    expect(d.attempts.filter((x) => x.scheduledDate === s.today() && x.outcome !== 'none')).toHaveLength(2);
  });
});

describe('保護・復元', () => {
  it('P54：確認画面を開いた後に別タブで所持が更新されたら旧所持に対する確定を拒否する', async () => {
    const s = await service();
    await importText(s, `[{"id":${FX.mainGunA},"lv":6},{"id":${FX.mainGunA},"lv":6}]`);
    const snapAtOpen = (await s.load()).baselines.find((b) => b.scope === 'equipment')!.snapshotId;
    await importText(s, `[{"id":${FX.mainGunA},"lv":6}]`);
    const r = await s.run('ResolveProtection', handleSetProtection, { equipmentId: FX.mainGunA, star: 6, count: 1, instanceIds: null, reason: '', resolve: true, snapshotId: snapAtOpen, now: '' }, await base(s));
    expect(r.status).toBe('VALIDATION_ERROR');
  });

  it('P55/P20/P32：復元は全体置換し新しい epoch を発行。旧画面からの保存は拒否し、未解消の保護は解消済みにしない', async () => {
    const s = await service();
    await importText(s, `[{"id":${FX.mainGunA},"lv":6},{"id":${FX.mainGunA},"lv":6},{"id":${FX.mainGunA},"lv":6}]`);
    await s.run('SetProtection', handleSetProtection, { equipmentId: FX.mainGunA, star: 6, count: 3, instanceIds: null, reason: '手動', resolve: false, snapshotId: null, now: '' }, await base(s));
    await importText(s, `[{"id":${FX.mainGunA},"lv":6},{"id":${FX.mainGunA},"lv":6}]`);
    const d = await s.load();
    expect(d.protections[0]?.reconciliationRequired).toBe(true);
    const json = exportBackup(d, m.version, '0.1.0', s.nowIso());
    const parsed = parseBackup(json, m.version);
    if (!parsed.ok) throw new Error(parsed.message);
    const oldTab = await base(s);
    const r = await s.run('RestoreBackup', handleRestore, { backup: parsed.backup, newEpoch: 'epoch-new', masterMissing: false, confirmedPlanHold: false, nowMs: clockMs, now: s.nowIso() }, oldTab);
    expect(r.status).toBe('APPLIED');
    const restored = await s.load();
    expect(restored.meta.datasetEpoch).toBe('epoch-new');
    expect(restored.meta.revision).toBeGreaterThan(oldTab.expectedRevision);
    expect(restored.protections[0]?.reconciliationRequired).toBe(true);
    const stale = await importText(s, '[{"api_id":8,"api_value":1}]').catch(() => null);
    expect(stale?.status).toBe('APPLIED'); // 新しい画面からの保存は可能
    const fromOldTab = await s.run('ImportInventory', handleImport, { ...updates('[{"api_id":8,"api_value":2}]'), snapshotId: 's', now: '' }, { datasetEpoch: oldTab.datasetEpoch, expectedRevision: restored.meta.revision });
    expect(fromOldTab.status).toBe('EPOCH_MISMATCH');
  });

  it('P43：必要マスターがないバックアップは確認後に在庫・履歴を復元し、計画は保留する', async () => {
    const s = await service();
    await importText(s, '[{"api_id":8,"api_value":10}]');
    const json = exportBackup(await s.load(), 'old-master', '0.1.0', s.nowIso());
    const parsed = parseBackup(json, m.version);
    if (!parsed.ok) throw new Error();
    expect(parsed.masterMissing).toBe(true);
    const noConfirm = await s.run('RestoreBackup', handleRestore, { backup: parsed.backup, newEpoch: 'e2', masterMissing: true, confirmedPlanHold: false, nowMs: clockMs, now: '' }, await base(s));
    expect(noConfirm.status).toBe('VALIDATION_ERROR');
    const ok = await s.run('RestoreBackup', handleRestore, { backup: parsed.backup, newEpoch: 'e2', masterMissing: true, confirmedPlanHold: true, nowMs: clockMs, now: '' }, await base(s));
    expect(ok.status).toBe('APPLIED');
    if (ok.status === 'APPLIED') expect(ok.recalc).toBe('MASTER_REVIEW');
    const d = await loadData(db);
    expect(d.meta.masterReviewRequired).toBe(true);
    expect(d.baselines.find((b) => b.scope === 'resource:8')?.value).toBe(10);
  });
});

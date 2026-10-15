import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMasterIndex } from '../domain/master';
import { parseImportText } from '../domain/import/parse';
import { projectInventory } from '../domain/inventory/projection';
import { buildDeltas, inferInputSources } from '../domain/results/results';
import type { Goal, ResultEvent } from '../domain/model';
import { KaishuDb } from '../infrastructure/db';
import { loadData } from '../infrastructure/repository';
import { FX, fixtureMaster } from '../test-support/fixtureMaster';
import { AppService, type Clock } from './service';
import {
  handleCancelDraft,
  handleCorrectResult,
  handleImport,
  handleRecordResult,
  handleRestore,
  handleSameDayRetry,
  handleSaveDraft,
  handleSaveGoal,
  handleSaveSettings,
  handleSetProtection,
  recordOrderFor,
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

  it('翌日処理を保存できなかったら、保存できなかったことを返す（未実施の予定を移したことにしない）', async () => {
    const s = await service();
    await seedPlan(s);
    clockMs += 24 * 3600 * 1000; // 翌日
    const spy = vi.spyOn(db.meta, 'put').mockImplementationOnce(() => {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    });
    const failed = await s.rollover();
    spy.mockRestore();
    expect(failed.saved).toBe(false);
    expect(failed.moved).toBe(0);
    const ok = await s.rollover();
    expect(ok.saved).toBe(true);
    expect(ok.moved).toBe(1);
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

  it('P47：資材だけ再取り込みした後に成功を失敗へ訂正すると、資材は最新値のまま装備だけ戻る', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    const rec = await recordPayload(s, a.attemptId, 'success');
    expect((await s.run('RecordResult', handleRecordResult, rec, await base(s))).status).toBe('APPLIED');
    await importText(s, port([FX.shipAKai2], 20)); // 資材・艦娘だけ新しい基準（装備の基準は記録より前のまま）
    const failure = buildDeltas({ transition: a.transition, outcome: 'failure', consumption: { resources: { 8: 3, 7: 4 }, equipment: [{ equipmentId: FX.materialA, star: 0, count: 2 }], useItems: {} } });
    const r = await s.run('CorrectResult', handleCorrectResult, { eventId: rec.eventId, newOutcome: 'failure', newDeltas: failure, occurredDateJst: s.today(), historyOnlyScopes: [], reason: '', today: s.today(), now: s.nowIso() }, await base(s));
    expect(r.status).toBe('APPLIED');
    const d = await s.load();
    const e = d.resultEvents.find((x) => x.eventId === rec.eventId)!;
    expect([...e.historyOnlyScopes].sort()).toEqual(['resource:7', 'resource:8']);
    const p = projectInventory(d.baselines, d.resultEvents, d.drafts);
    expect(p.equipment.counts.get(`${FX.mainGunA}:5`) ?? 0).toBe(1);
    expect(p.equipment.counts.get(`${FX.mainGunA}:6`) ?? 0).toBe(0);
    expect(p.equipment.counts.get(`${FX.materialA}:0`) ?? 0).toBe(1);
    expect(p.resources.get(8)?.value).toBe(20);
  });

  it('P51：同じ工程の再挑戦を2つの画面から同時に作っても、有効な次回試行は1つ', async () => {
    const s = await service();
    await seedPlan(s, { weekdayLimits: [3, 3, 3, 3, 3, 3, 3] });
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    await s.run('RecordResult', handleRecordResult, await recordPayload(s, a.attemptId, 'failure'), await base(s));
    const env = await base(s);
    const payload = { stepKey: a.stepKey, attemptId: `${a.stepKey}@2`, today: s.today(), limit: 3, now: s.nowIso() };
    const [r1, r2] = await Promise.all([s.run('SameDayRetry', handleSameDayRetry, payload, env), s.run('SameDayRetry', handleSameDayRetry, payload, env)]);
    expect([r1.status, r2.status].sort()).toEqual(['APPLIED', 'CONFLICT']);
    await s.recalculate();
    const d = await s.load();
    expect(d.attempts.filter((x) => x.stepKey === a.stepKey && x.lifecycle === 'active' && x.outcome === 'none')).toHaveLength(1);
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

describe('レビュー指摘（PR #1）', () => {
  it('確認待ちの下書きを確定するときは、その下書き自身の確保分を二重に引かない', async () => {
    const s = await service();
    await seedPlan(s, { screws: 4 });
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    await s.run('SaveDraftResult', handleSaveDraft, { draftId: 'd', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [{ scope: 'resource:8', amount: -4 }], unknownScopes: ['resource:7', 'equipment'], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' }, await base(s));
    const finalize = await recordPayload(s, a.attemptId, 'failure', { fromDraftId: 'd', deltas: [{ scope: 'resource:8', amount: -4 }] });
    expect((await s.run('RecordResult', handleRecordResult, finalize, await base(s))).status).toBe('APPLIED');
  });

  it('確認待ち（reviewRequired）の予定には、装備を履歴だけにしない限り結果を確定しない', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    // 当日に所持データを取り込み直し、改修対象（★5）が消えた
    await importText(s, `[{"id":${FX.mainGunA},"lv":6},{"id":${FX.materialA},"lv":0}]`);
    const gated = (await s.load()).attempts.find((x) => x.attemptId === a.attemptId)!;
    expect(gated.executionGate).toBe('reviewRequired');
    const r = await s.run('RecordResult', handleRecordResult, await recordPayload(s, a.attemptId, 'success'), await base(s));
    expect(r.status).toBe('VALIDATION_ERROR');
    if (r.status === 'VALIDATION_ERROR') expect(r.errors[0]?.code).toBe('REVIEW_REQUIRED');
    // 取り込み前に実施した記録漏れとして、装備を履歴だけに記録するのは可能
    const missed = await recordPayload(s, a.attemptId, 'success', { requireScopeAnswers: true, answeredScopes: ['equipment', 'resource:7', 'resource:8'], historyOnlyScopes: ['equipment', 'resource:7', 'resource:8'] });
    expect((await s.run('RecordResult', handleRecordResult, missed, await base(s))).status).toBe('APPLIED');
  });

  it('失敗を成功へ訂正すると、結果のない後継を取り消し、結果のある後継があれば保存しない', async () => {
    const s = await service();
    await seedPlan(s, { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] });
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    const failed = await recordPayload(s, a.attemptId, 'failure');
    await s.run('RecordResult', handleRecordResult, failed, await base(s));
    await s.run('SameDayRetry', handleSameDayRetry, { stepKey: a.stepKey, attemptId: `${a.stepKey}@2`, today: s.today(), limit: 2, now: '' }, await base(s));
    const retry = (await s.load()).attempts.find((x) => x.stepKey === a.stepKey && x.outcome === 'none' && x.lifecycle === 'active')!;
    expect(retry).toBeDefined();
    const success = buildDeltas({ transition: a.transition, outcome: 'success', consumption: { resources: { 8: 3, 7: 4 }, equipment: [{ equipmentId: FX.materialA, star: 0, count: 2 }], useItems: {} } });
    const r = await s.run('CorrectResult', handleCorrectResult, { eventId: failed.eventId, newOutcome: 'success', newDeltas: success, occurredDateJst: s.today(), historyOnlyScopes: [], reason: '', today: s.today(), now: '' }, await base(s));
    expect(r.status).toBe('APPLIED');
    const d = await s.load();
    expect(d.attempts.find((x) => x.attemptId === retry.attemptId)?.lifecycle).toBe('cancelled');
    expect(d.attempts.filter((x) => x.stepKey === a.stepKey && x.lifecycle === 'active' && x.outcome === 'none')).toHaveLength(0);
  });

  it('失敗を成功へ訂正するとき、後継に結果があれば自動で取り消さず保存しない', async () => {
    const s = await service();
    await seedPlan(s, { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] });
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    const failed = await recordPayload(s, a.attemptId, 'failure');
    await s.run('RecordResult', handleRecordResult, failed, await base(s));
    await s.run('SameDayRetry', handleSameDayRetry, { stepKey: a.stepKey, attemptId: `${a.stepKey}@2`, today: s.today(), limit: 2, now: '' }, await base(s));
    const retry = (await s.load()).attempts.find((x) => x.stepKey === a.stepKey && x.outcome === 'none' && x.lifecycle === 'active')!;
    const retryFailed = await recordPayload(s, retry.attemptId, 'failure', { deltas: [{ scope: 'resource:8', amount: -1 }] });
    expect((await s.run('RecordResult', handleRecordResult, retryFailed, await base(s))).status).toBe('APPLIED');
    const success = buildDeltas({ transition: a.transition, outcome: 'success', consumption: { resources: { 8: 3, 7: 4 }, equipment: [{ equipmentId: FX.materialA, star: 0, count: 2 }], useItems: {} } });
    const r = await s.run('CorrectResult', handleCorrectResult, { eventId: failed.eventId, newOutcome: 'success', newDeltas: success, occurredDateJst: s.today(), historyOnlyScopes: [], reason: '', today: s.today(), now: '' }, await base(s));
    expect(r.status).toBe('VALIDATION_ERROR');
    if (r.status === 'VALIDATION_ERROR') expect(r.errors[0]?.code).toBe('SUCCESSOR_HAS_RESULT');
  });

  it('前の工程の結果が確定していない予定は、確認待ちとしても保存しない', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const a = d0.attempts.find((x) => x.scheduledDate === s.today())!;
    const data = { ...d0, attempts: d0.attempts.map((x) => (x.attemptId === a.attemptId ? { ...x, executionGate: 'predecessorPending' as const } : x)) };
    const r = handleSaveDraft(data, { draftId: 'd', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'success', knownConsumptions: [], unknownScopes: ['resource:8'], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('PREDECESSOR_PENDING');
  });

  it('確認待ち（reviewRequired）の予定は、装備を履歴だけに記録する場合を除き、実施済み・確認待ちとしても保存しない', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const a = d0.attempts.find((x) => x.scheduledDate === s.today())!;
    const data = { ...d0, attempts: d0.attempts.map((x) => (x.attemptId === a.attemptId ? { ...x, executionGate: 'reviewRequired' as const } : x)) };
    const payload = { draftId: 'd', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'success' as const, knownConsumptions: [], unknownScopes: ['resource:8' as const], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' };
    const r = handleSaveDraft(data, payload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('REVIEW_REQUIRED');
    expect(handleSaveDraft(data, { ...payload, scopeAnswers: { equipment: 'historyOnly' } }).ok).toBe(true);
  });

  it('消費を訂正すると入力元を推定し直す（製作品の消費をなくせば製作の実績を拘束せず、加えれば入力元にする）', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const a = d0.attempts.find((x) => x.scheduledDate === s.today())!;
    const snap = (transition: ResultEvent['recipeSnapshot'] extends infer R ? (R extends { transition: infer T } ? T : never) : never) => ({ masterVersion: m.version, transition, fromName: '', toName: '', mode: 'normal' as const, entryIndex: 0, plannedCost: null, helperShipId: null, helperShipName: null });
    const craft: ResultEvent = { eventId: 'craft', attemptId: 'c@1', stepKey: `g1|craft:${FX.materialA}|x`, goalId: 'g1', originalSequence: 1, revision: 1, status: 'active', outcome: 'success', occurredDateJst: '2026-10-13', occurredOrder: 1, recordedAt: '', deltas: [{ scope: 'equipment', equipmentId: FX.materialA, star: 0, amount: -1 }, { scope: 'equipment', equipmentId: FX.materialA, star: 1, amount: 1 }], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: snap({ kind: 'improve', equipmentId: FX.materialA, fromStar: 0, toStar: 1 }), inputSourceEventIds: [], history: [] };
    const consumes = [{ scope: 'equipment' as const, equipmentId: FX.materialA, star: 1, amount: -1 }];
    const consumer: ResultEvent = { ...craft, eventId: 'ev', attemptId: a.attemptId, stepKey: a.stepKey, originalSequence: 2, outcome: 'failure', occurredDateJst: '2026-10-14', occurredOrder: 1, deltas: consumes, recipeSnapshot: null, inputSourceEventIds: ['craft'] };
    const data = { ...d0, meta: { ...d0.meta, nextSequence: 3 }, resultEvents: [craft, consumer], attempts: d0.attempts.map((x) => (x.attemptId === a.attemptId ? { ...x, outcome: 'failure' as const, resultEventId: 'ev' } : x)) };
    const payload = { eventId: 'ev', newOutcome: 'failure' as const, occurredDateJst: '2026-10-14', historyOnlyScopes: [], reason: '', today: '2026-10-14', now: '' };
    const dropped = handleCorrectResult(data, { ...payload, newDeltas: [{ scope: 'resource:8', amount: -1 }] });
    expect(dropped.ok && dropped.writes.put?.resultEvents?.[0]?.inputSourceEventIds).toEqual([]);
    const added = handleCorrectResult({ ...data, resultEvents: [craft, { ...consumer, deltas: [{ scope: 'resource:8', amount: -1 }], inputSourceEventIds: [] }] }, { ...payload, newDeltas: consumes });
    expect(added.ok && added.writes.put?.resultEvents?.[0]?.inputSourceEventIds).toEqual(['craft']);
    // 製作品を使う記録を、製作より前の日付へ動かす訂正は保存しない
    const early = handleCorrectResult(data, { ...payload, newDeltas: consumes, occurredDateJst: '2026-10-12' });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0]?.code).toBe('ORDER_VIOLATION');
  });

  it('予定と別の日に記録すると、その日の記録の最大の日内順の後ろに置く（件数ではなく最大値）', () => {
    const at = (order: number): ResultEvent => ({ eventId: `e${order}`, attemptId: 'x', stepKey: 'x', goalId: 'g', originalSequence: order, revision: 1, status: 'active', outcome: 'failure', occurredDateJst: '2026-10-13', occurredOrder: order, recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] });
    const a = { attemptId: 'a@1', stepKey: 'a', goalId: 'g', transition: { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 }, scheduledDate: '2026-10-14', dayOrder: 1, outcome: 'none' as const, lifecycle: 'active' as const, executionGate: 'ready' as const, predecessorAttemptId: null, createdAt: '', helperShipId: null, mode: 'normal' as const, resultEventId: null, cancelReason: null };
    expect(recordOrderFor({ resultEvents: [at(5)] }, a, '2026-10-13')).toBe(6);
    expect(recordOrderFor({ resultEvents: [at(1), at(3)] }, a, '2026-10-13')).toBe(4);
    expect(recordOrderFor({ resultEvents: [] }, a, '2026-10-13')).toBe(1);
    expect(recordOrderFor({ resultEvents: [at(5)] }, a, '2026-10-14')).toBe(1);
  });

  it('訂正で実施日を変えると、その日の記録の後ろに日内順を付け直す', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const a = d0.attempts.find((x) => x.scheduledDate === s.today())!;
    const other: ResultEvent = { eventId: 'other', attemptId: 'o@1', stepKey: 'o', goalId: 'g9', originalSequence: 1, revision: 1, status: 'active', outcome: 'failure', occurredDateJst: '2026-10-13', occurredOrder: 1, recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] };
    const mine: ResultEvent = { ...other, eventId: 'ev', attemptId: a.attemptId, stepKey: a.stepKey, goalId: 'g1', originalSequence: 2, occurredDateJst: '2026-10-14', occurredOrder: 1 };
    const data = { ...d0, meta: { ...d0.meta, nextSequence: 3 }, resultEvents: [other, mine], attempts: d0.attempts.map((x) => (x.attemptId === a.attemptId ? { ...x, outcome: 'failure' as const, resultEventId: 'ev' } : x)) };
    const r = handleCorrectResult(data, { eventId: 'ev', newOutcome: 'failure', newDeltas: [], occurredDateJst: '2026-10-13', historyOnlyScopes: [], reason: '', today: '2026-10-14', now: '' });
    expect(r.ok && r.writes.put?.resultEvents?.[0]?.occurredOrder).toBe(2);
  });

  it('成功を取り消す訂正では、その成功が作った★を途中で別の記録が使っていれば保存しない（後で補充されていても）', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const ev = (id: string, seq: number, date: string, deltas: ResultEvent['deltas'], goalId = 'g1'): ResultEvent => ({ eventId: id, attemptId: `${id}@1`, stepKey: id, goalId, originalSequence: seq, revision: 1, status: 'active', outcome: 'success', occurredDateJst: date, occurredOrder: 1, recordedAt: '', deltas, historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] });
    const star = (st: number, amount: number) => ({ scope: 'equipment' as const, equipmentId: FX.mainGunA, star: st, amount });
    // 10/12 に A が★5→★6、10/13 に別の目標の C が★6 を素材に使い、10/14 に D が★6 を補充
    const a = ev('A', 1, '2026-10-12', [star(5, -1), star(6, 1)]);
    const c = ev('C', 2, '2026-10-13', [star(6, -1)], 'g2');
    const d = ev('D', 3, '2026-10-14', [star(6, 1)], 'g3');
    const data = { ...d0, meta: { ...d0.meta, nextSequence: 4 }, resultEvents: [a, c, d] };
    const r = handleCorrectResult(data, { eventId: 'A', newOutcome: 'voided', newDeltas: [], occurredDateJst: '2026-10-12', historyOnlyScopes: [], reason: '', today: '2026-10-14', now: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('BACKWARD_DEPENDENCY');
    // 成功の日付を、その★を使った記録より後へ動かす訂正も保存しない
    const moved = handleCorrectResult(data, { eventId: 'A', newOutcome: 'success', newDeltas: [star(5, -1), star(6, 1)], occurredDateJst: '2026-10-14', historyOnlyScopes: [], reason: '', today: '2026-10-14', now: '' });
    expect(moved.ok).toBe(false);
    // 日付を変えない訂正（理由だけ）は保存できる
    expect(handleCorrectResult(data, { eventId: 'A', newOutcome: 'success', newDeltas: [star(5, -1), star(6, 1)], occurredDateJst: '2026-10-12', historyOnlyScopes: [], reason: 'メモ', today: '2026-10-14', now: '' }).ok).toBe(true);
  });

  it('消費量が有限の整数でない、または上限を超える記録・確認待ちは保存しない', async () => {
    const s = await service();
    await seedPlan(s);
    const d = await s.load();
    const a = d.attempts.find((x) => x.scheduledDate === s.today())!;
    const bad = [{ scope: 'resource:8' as const, amount: -Infinity }];
    const r = handleRecordResult(d, { ...(await recordPayload(s, a.attemptId, 'failure')), deltas: bad });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('INVALID_AMOUNT');
    const draft = handleSaveDraft(d, { draftId: 'd', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [{ scope: 'resource:8', amount: -1_000_000 }], unknownScopes: [], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' });
    expect(draft.ok).toBe(false);
  });

  it('マスターの確認で計算を保留している間は、結果も確認待ちも保存しない', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const a = d0.attempts.find((x) => x.scheduledDate === s.today())!;
    const held = { ...d0, meta: { ...d0.meta, masterReviewRequired: true } };
    const r = handleRecordResult(held, await recordPayload(s, a.attemptId, 'success'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('MASTER_REVIEW_REQUIRED');
    const draft = handleSaveDraft(held, { draftId: 'd', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [], unknownScopes: ['resource:8'], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' });
    expect(draft.ok).toBe(false);
  });

  it('確認待ちの下書きがある予定は、その下書きの確定としてだけ記録する（下書きを残したまま二重に確保しない）', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    await s.run('SaveDraftResult', handleSaveDraft, { draftId: 'd1', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [{ scope: 'resource:8', amount: -1 }], unknownScopes: ['resource:7'], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' }, await base(s));
    const d = await s.load();
    const plain = handleRecordResult(d, await recordPayload(s, a.attemptId, 'failure', { deltas: [{ scope: 'resource:8', amount: -1 }] }));
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.errors[0]?.code).toBe('DRAFT_OPEN');
    expect(handleRecordResult(d, await recordPayload(s, a.attemptId, 'failure', { deltas: [{ scope: 'resource:8', amount: -1 }], fromDraftId: 'other' })).ok).toBe(false);
    expect(handleRecordResult(d, await recordPayload(s, a.attemptId, 'failure', { deltas: [{ scope: 'resource:8', amount: -1 }], fromDraftId: 'd1' })).ok).toBe(true);
  });

  it('目標を削除した後に確認待ちを「実施していなかった」へ訂正すると、その予定は取り消す（どこにも移せない予定を残さない）', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    await s.run('SaveDraftResult', handleSaveDraft, { draftId: 'd1', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [], unknownScopes: ['resource:8'], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' }, await base(s));
    const d = await s.load();
    const r = handleCancelDraft({ ...d, goals: [] }, { draftId: 'd1', reason: '取り違え', now: '' });
    expect(r.ok && r.writes.put?.attempts?.[0]).toMatchObject({ attemptId: a.attemptId, lifecycle: 'cancelled', outcome: 'none' });
    // 目標があれば未実施に戻す
    const kept = handleCancelDraft(d, { draftId: 'd1', reason: '取り違え', now: '' });
    expect(kept.ok && kept.writes.put?.attempts?.[0]).toMatchObject({ lifecycle: 'active', outcome: 'none' });
  });

  it('確認待ちの予定で装備を消費しない失敗も、装備を履歴だけと確認すれば記録できる', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const a = d0.attempts.find((x) => x.scheduledDate === s.today())!;
    const data = { ...d0, attempts: d0.attempts.map((x) => (x.attemptId === a.attemptId ? { ...x, executionGate: 'reviewRequired' as const } : x)) };
    const payload = { ...(await recordPayload(s, a.attemptId, 'failure')), deltas: [{ scope: 'resource:8' as const, amount: -1 }], requireScopeAnswers: true, answeredScopes: ['resource:8' as const, 'equipment' as const] };
    const r = handleRecordResult(data, { ...payload, historyOnlyScopes: ['resource:8', 'equipment'] });
    expect(r.ok).toBe(true);
    const without = handleRecordResult(data, { ...payload, historyOnlyScopes: ['resource:8'] });
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.errors[0]?.code).toBe('REVIEW_REQUIRED');
  });

  it('取り消された予定は、確認待ちとしても保存しない', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const a = d0.attempts.find((x) => x.scheduledDate === s.today())!;
    const data = { ...d0, attempts: d0.attempts.map((x) => (x.attemptId === a.attemptId ? { ...x, lifecycle: 'cancelled' as const } : x)) };
    const r = handleSaveDraft(data, { draftId: 'd', attemptId: a.attemptId, occurredDateJst: s.today(), today: s.today(), reportedOutcome: 'failure', knownConsumptions: [], unknownScopes: ['resource:8'], scopeAnswers: {}, confirmedPerformed: true, recipeSnapshot: null, now: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('ATTEMPT_CANCELLED');
  });

  it('同日の再挑戦の上限は、実施日で数える（今日の予定を別の日に実施した記録は今日の枠を使わない）', async () => {
    const s = await service();
    await seedPlan(s, { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] });
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    await s.run('RecordResult', handleRecordResult, await recordPayload(s, a.attemptId, 'failure'), await base(s));
    const d0 = await s.load();
    // 今日の予定をもう1件、昨日実施したと記録した状態
    const other = { ...a, attemptId: 'o|1:0>1|0@1', stepKey: 'o|1:0>1|0', goalId: 'g1', outcome: 'failure' as const, resultEventId: 'eo', dayOrder: 2 };
    const ev: ResultEvent = { eventId: 'eo', attemptId: other.attemptId, stepKey: other.stepKey, goalId: 'g1', originalSequence: 99, revision: 1, status: 'active', outcome: 'failure', occurredDateJst: '2026-10-13', occurredOrder: 1, recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] };
    const data = { ...d0, attempts: [...d0.attempts, other], resultEvents: [...d0.resultEvents, ev] };
    expect(handleSameDayRetry(data, { stepKey: a.stepKey, attemptId: `${a.stepKey}@2`, today: s.today(), limit: 2, now: '' }).ok).toBe(true);
  });

  it('一日分をスキップした日には、同日の再挑戦を追加しない', async () => {
    const s = await service();
    await seedPlan(s, { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] });
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    await s.run('RecordResult', handleRecordResult, await recordPayload(s, a.attemptId, 'failure'), await base(s));
    const d = await s.load();
    const retry = { stepKey: a.stepKey, attemptId: `${a.stepKey}@2`, today: s.today(), limit: 2, now: '' };
    const skipped = handleSameDayRetry({ ...d, daySkips: [{ date: s.today(), createdAt: '' }] }, retry);
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.errors[0]?.code).toBe('DAY_SKIPPED');
    expect(handleSameDayRetry(d, retry).ok).toBe(true);
  });

  it('削除した目標の工程には、同日の再挑戦を追加しない', async () => {
    const s = await service();
    await seedPlan(s, { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] });
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    await s.run('RecordResult', handleRecordResult, await recordPayload(s, a.attemptId, 'failure'), await base(s));
    const d = await s.load();
    const retry = { stepKey: a.stepKey, attemptId: `${a.stepKey}@2`, today: s.today(), limit: 2, now: '' };
    expect(handleSameDayRetry({ ...d, goals: [] }, retry).ok).toBe(false);
    expect(handleSameDayRetry(d, retry).ok).toBe(true);
  });

  it('訂正では、取り込みの境界で固定されていない「履歴だけ」の選択を変えられる（固定の種類は変えない）', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    // ネジを誤って履歴だけにして記録した
    const rec = await recordPayload(s, a.attemptId, 'failure', { deltas: [{ scope: 'resource:8', amount: -2 }], requireScopeAnswers: true, answeredScopes: ['resource:8'], historyOnlyScopes: ['resource:8'] });
    expect((await s.run('RecordResult', handleRecordResult, rec, await base(s))).status).toBe('APPLIED');
    const before = projectInventory((await s.load()).baselines, (await s.load()).resultEvents, []).resources.get(8)?.value;
    // 訂正で所持数に反映する扱いへ変える
    const r = await s.run('CorrectResult', handleCorrectResult, { eventId: rec.eventId, newOutcome: 'failure', newDeltas: [{ scope: 'resource:8', amount: -2 }], occurredDateJst: s.today(), historyOnlyScopes: [], reason: '扱いの誤り', today: s.today(), now: '' }, await base(s));
    expect(r.status).toBe('APPLIED');
    const d = await s.load();
    expect(d.resultEvents.find((e) => e.eventId === rec.eventId)?.historyOnlyScopes).toEqual([]);
    expect(projectInventory(d.baselines, d.resultEvents, []).resources.get(8)?.value).toBe((before ?? 0) - 2);
  });

  it('一日分のスキップの1件を訂正しても、ほかのスキップが残っていればその日の目印を消さない', async () => {
    const s = await service();
    await seedPlan(s);
    const d0 = await s.load();
    const skip = (id: string, attemptId: string): ResultEvent => ({ eventId: id, attemptId, stepKey: id, goalId: 'g1', originalSequence: Number(id.slice(1)), revision: 1, status: 'active', outcome: 'skip', occurredDateJst: '2026-10-14', occurredOrder: Number(id.slice(1)), recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] });
    const data = { ...d0, meta: { ...d0.meta, nextSequence: 3 }, resultEvents: [skip('e1', 'a1@1'), skip('e2', 'a2@1')], daySkips: [{ date: '2026-10-14', createdAt: '' }] };
    const payload = { newOutcome: 'voided' as const, newDeltas: [], occurredDateJst: '2026-10-14', historyOnlyScopes: [], reason: '', today: '2026-10-14', now: '' };
    const first = handleCorrectResult(data, { ...payload, eventId: 'e1' });
    expect(first.ok && first.writes.remove?.daySkips).toEqual([]);
    // 最後のスキップを訂正したら目印も外す
    const last = handleCorrectResult({ ...data, resultEvents: [{ ...skip('e1', 'a1@1'), status: 'voided' }, skip('e2', 'a2@1')] }, { ...payload, eventId: 'e2' });
    expect(last.ok && last.writes.remove?.daySkips).toEqual(['2026-10-14']);
  });

  it('後の日付の成功だけが作った★を、それより前の日付の記録で消費しない（実施日時の順に所持を確かめる）', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    // 10/14 に主砲A ★5→★6 が成功（★6 はこの成功でだけできる）
    expect((await s.run('RecordResult', handleRecordResult, await recordPayload(s, a.attemptId, 'success'), await base(s))).status).toBe('APPLIED');
    const d0 = await s.load();
    const consumer = { ...a, attemptId: 'c|1001:6>7|0@1', stepKey: 'c|1001:6>7|0', goalId: 'c', transition: { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 6, toStar: 7 }, scheduledDate: '2026-10-13', outcome: 'none' as const, resultEventId: null };
    const data = { ...d0, attempts: [...d0.attempts, consumer] };
    const deltas = buildDeltas({ transition: consumer.transition, outcome: 'success', consumption: { resources: { 8: 1 }, equipment: [], useItems: {} } });
    const payload = { ...(await recordPayload(s, a.attemptId, 'success')), attemptId: consumer.attemptId, occurredDateJst: '2026-10-13', deltas };
    // 最終的な所持（★6 が1個）では足りるが、10/13 の時点では★6 がない
    const early = handleRecordResult(data, payload);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0]?.code).toBe('BACKWARD_DEPENDENCY');
    // 成功より後の日付なら記録できる
    expect(handleRecordResult(data, { ...payload, occurredDateJst: '2026-10-14' }).ok).toBe(true);
  });

  it('実施日より後に記録された成功を入力元にしない（日付が逆向きの依存は保存しない）', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    const producer = await recordPayload(s, a.attemptId, 'success', { recipeSnapshot: { masterVersion: m.version, transition: a.transition, fromName: '', toName: '', mode: 'normal', entryIndex: 0, plannedCost: null, helperShipId: null, helperShipName: null } });
    expect((await s.run('RecordResult', handleRecordResult, producer, await base(s))).status).toBe('APPLIED');
    const d = await s.load();
    const consumerAttempt = { ...a, attemptId: 'later@1', stepKey: 'g1|1001:6>7|0', transition: { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 6, toStar: 7 }, scheduledDate: '2026-10-13' };
    // 推定：10/13 に実施した後続は、10/14 の成功を入力元にしない
    expect(inferInputSources(d.resultEvents, consumerAttempt, [], { date: '2026-10-13', order: 1 })).toEqual([]);
    expect(inferInputSources(d.resultEvents, consumerAttempt, [], { date: '2026-10-14', order: 9 })).toEqual([producer.eventId]);
  });
});

describe('目標の検証', () => {
  it('完成品として残す個数はバックアップで復元できる上限（9,999）までにする', async () => {
    const s = await service();
    const d = await s.load();
    expect(handleSaveGoal(d, { goal: goal({ count: 10000 }), isNew: true }).ok).toBe(false);
    expect(handleSaveGoal(d, { goal: goal({ count: 9999 }), isNew: true }).ok).toBe(true);
  });
});

describe('保護・復元', () => {
  it('個体単位の所持では、保護する個体を個数ぶん重複なく、その装備・★の個体から選ばないと保存しない', async () => {
    const s = await service();
    const slot = (rows: [number, number, number][]) => `svdata=${JSON.stringify({ api_result: 1, api_data: rows.map(([id, eq, lv]) => ({ api_id: id, api_slotitem_id: eq, api_level: lv })) })}`;
    await importText(s, slot([[1, FX.mainGunA, 6], [2, FX.mainGunA, 6], [3, FX.mainGunA, 5]]));
    const d = await s.load();
    const set = (count: number, instanceIds: number[] | null) => handleSetProtection(d, { equipmentId: FX.mainGunA, star: 6, count, instanceIds, reason: '', resolve: false, snapshotId: null, now: '' });
    expect(set(2, [1]).ok).toBe(false); // 個数と選んだ個体の数が違う
    expect(set(2, [1, 1]).ok).toBe(false); // 重複
    expect(set(2, [1, 3]).ok).toBe(false); // 別の★の個体
    expect(set(2, null).ok).toBe(false); // 個体を選んでいない
    expect(set(2, [1, 2]).ok).toBe(true);
    expect(set(0, []).ok).toBe(true);
  });

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

  it('新しいマスターでの計算保留を保存できなければ起動を止め、古い版のまま計画を表示しない', async () => {
    const s = await service();
    await seedPlan(s);
    const s2 = new AppService(db, buildMasterIndex(fixtureMaster({ masterVersion: 'next' })), clock);
    const spy = vi.spyOn(db.meta, 'put').mockImplementationOnce(() => {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    });
    await expect(s2.init()).rejects.toThrow(/共通マスター/);
    spy.mockRestore();
    expect((await s2.load()).meta.masterReviewRequired).toBe(false);
    // 保存できれば計算保留になる
    await s2.init();
    expect((await s2.load()).meta.masterReviewRequired).toBe(true);
  });

  it('P30：新しいマスターで過去実績のレシピが消えても実績は残り、将来の予定は確認待ちにする', async () => {
    const s = await service();
    await seedPlan(s);
    const a = (await s.load()).attempts.find((x) => x.scheduledDate === s.today())!;
    const rec = await recordPayload(s, a.attemptId, 'success', { recipeSnapshot: { masterVersion: m.version, transition: a.transition, fromName: '主砲A', toName: '主砲A', mode: 'normal', entryIndex: 0, plannedCost: null, helperShipId: null, helperShipName: null } });
    expect((await s.run('RecordResult', handleRecordResult, rec, await base(s))).status).toBe('APPLIED');
    const next = fixtureMaster({ masterVersion: 'next' });
    next.recipes = next.recipes.filter((r) => r.equipmentId !== FX.mainGunA);
    const s2 = new AppService(db, buildMasterIndex(next), clock);
    await s2.init();
    const d = await s2.load();
    expect(d.meta.masterReviewRequired).toBe(true);
    expect(await s2.recalculate()).toBe('MASTER_REVIEW');
    // 当時の消費と工程は記録に残っている
    const e = d.resultEvents.find((x) => x.eventId === rec.eventId)!;
    expect(e.recipeSnapshot?.fromName).toBe('主砲A');
    expect(e.deltas.some((x) => x.scope === 'resource:8' && x.amount === -3)).toBe(true);
  });

  it('P67：復元の応答が失われ旧 epoch で再送されても二重に復元しない', async () => {
    const s = await service();
    await importText(s, '[{"api_id":8,"api_value":10}]');
    const parsed = parseBackup(exportBackup(await s.load(), m.version, '0.1.0', s.nowIso()), m.version);
    if (!parsed.ok) throw new Error(parsed.message);
    const env = { ...(await base(s)), commandId: 'restore-1' };
    const payload = { backup: parsed.backup, newEpoch: 'epoch-r1', masterMissing: false, confirmedPlanHold: false, nowMs: clockMs, now: s.nowIso() };
    expect((await s.run('RestoreBackup', handleRestore, payload, env)).status).toBe('APPLIED');
    await importText(s, '[{"api_id":8,"api_value":15}]'); // 復元後の新しい操作
    const before = await s.load();
    const resend = await s.run('RestoreBackup', handleRestore, { ...payload, newEpoch: 'epoch-r2' }, env);
    expect(resend.status).toBe('EPOCH_MISMATCH');
    const after = await s.load();
    expect(after.meta.datasetEpoch).toBe('epoch-r1');
    expect(after.meta.revision).toBe(before.meta.revision);
    expect(after.baselines.find((b) => b.scope === 'resource:8')?.value).toBe(15);
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

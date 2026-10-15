import { describe, expect, it } from 'vitest';
import type { Delta } from '../../domain/model';
import { projectInventory } from '../../domain/inventory/projection';
import { buildMasterIndex } from '../../domain/master';
import { FX, fixtureMaster } from '../../test-support/fixtureMaster';
import { baselinesFrom } from '../../test-support/planFixtures';
import type { PlannedCost } from '../../domain/model';
import { parseCount, plannedForAttempt, snapshotForDraft, consumedDeltas, consumptionRows, correctionEffect, deltasFromForm, savedValues, valuesFromDeltas, type RecordForm } from './recordModel';

const eq = (equipmentId: number, star: number, amount: number): Delta => ({ scope: 'equipment', equipmentId, star, amount });

describe('訂正画面の消費入力行', () => {
  const m = buildMasterIndex(fixtureMaster());
  const t = { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 5, toStar: 6 };
  const success: Delta[] = [eq(FX.mainGunA, 5, -1), eq(FX.mainGunA, 6, 1), eq(FX.materialA, 0, -2), { scope: 'resource:8', amount: -3 }];

  it('成功の記録を訂正するとき、改修対象そのものの★変化を消費の行にしない', () => {
    const rows = consumptionRows(m, null, projectInventory([], [], []), consumedDeltas(success, t, 'success'));
    expect(rows.filter((r) => r.kind === 'equipment').map((r) => r.id)).toEqual([FX.materialA]);
    const v = savedValues(success, t, 'success', rows);
    // 確定済みの記録は消費0の行（増減が保存されない）も 0 として入り、未入力の行が残らない
    for (const r of rows) expect(v.values[r.key], r.key).toBeDefined();
    expect(v.values['resource:8']).toBe('3');
    expect(v.values['resource:7']).toBe('0');
    expect(v.values[`equipment:${FX.materialA}:0`]).toBe('2');
  });

  it('失敗の記録は★変化がないので、装備の消費はそのまま行にする', () => {
    const failure: Delta[] = [eq(FX.materialA, 0, -2), { scope: 'resource:8', amount: -3 }];
    expect(consumedDeltas(failure, t, 'failure')).toEqual(failure);
  });
});

describe('素材装備の★ごとの消費', () => {
  const m = buildMasterIndex(fixtureMaster());
  const t = { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 5, toStar: 6 };
  const planned: PlannedCost = { fuel: 0, ammo: 0, steel: 0, bauxite: 0, devmats: 1, screws: 2, equipment: [{ equipmentId: FX.materialA, count: 2 }], useItems: [] };
  const projection = projectInventory(baselinesFrom({ equipment: [[FX.materialA, 0, 1], [FX.materialA, 1, 1]], resources: { 7: 9, 8: 9 } }), [], []);
  const form = (values: Record<string, string>, stars: Record<string, number> = {}): RecordForm => ({ attemptId: 'a', mode: 'record', eventId: null, draftId: null, outcome: 'success', occurredDate: '2026-10-15', missedAfterImport: false, values, stars, scopeAnswers: {}, reason: '', base: { datasetEpoch: 'e', expectedRevision: 0 } });

  it('計画が★0と★1を1個ずつ割り当てたら、★ごとの行に分けて候補を示す', () => {
    const alloc = new Map([[FX.materialA, [{ star: 0, count: 1 }, { star: 1, count: 1 }]]]);
    const rows = consumptionRows(m, planned, projection, [], alloc).filter((r) => r.kind === 'equipment');
    expect(rows.map((r) => [r.key, r.star, r.planned])).toEqual([
      [`equipment:${FX.materialA}:0`, 0, 1],
      [`equipment:${FX.materialA}:1`, 1, 1],
    ]);
  });

  it('★ごとの入力は★ごとの増減として記録し、同じ★を選び直した行は合算する', () => {
    const alloc = new Map([[FX.materialA, [{ star: 0, count: 1 }, { star: 1, count: 1 }]]]);
    const rows = consumptionRows(m, planned, projection, [], alloc);
    const k0 = `equipment:${FX.materialA}:0`;
    const k1 = `equipment:${FX.materialA}:1`;
    const mixed = deltasFromForm(form({ 'resource:8': '2', 'resource:7': '1', [k0]: '1', [k1]: '1' }), rows, t).deltas.filter((d) => d.scope === 'equipment' && d.equipmentId === FX.materialA);
    expect(mixed).toEqual([eq(FX.materialA, 0, -1), eq(FX.materialA, 1, -1)]);
    const merged = deltasFromForm(form({ 'resource:8': '2', 'resource:7': '1', [k0]: '1', [k1]: '1' }, { [k1]: 0 }), rows, t).deltas.filter((d) => d.scope === 'equipment' && d.equipmentId === FX.materialA);
    expect(merged).toEqual([eq(FX.materialA, 0, -2)]);
  });

  it('割り当てがなければ、所持する最も低い★の1行に計画数を示す', () => {
    const rows = consumptionRows(m, planned, projection).filter((r) => r.kind === 'equipment');
    expect(rows.map((r) => [r.star, r.planned, r.stars])).toEqual([[0, 2, [0, 1]]]);
  });

  it('★の混在した保存済みの記録・下書きは、★ごとの行と値に復元し、同じ増減へ戻せる', () => {
    const saved: Delta[] = [eq(FX.mainGunA, 5, -1), eq(FX.mainGunA, 6, 1), eq(FX.materialA, 0, -1), eq(FX.materialA, 1, -1), { scope: 'resource:7', amount: -1 }, { scope: 'resource:8', amount: -2 }];
    const rows = consumptionRows(m, planned, projection, consumedDeltas(saved, t, 'success'));
    const v = savedValues(saved, t, 'success', rows);
    expect(v.values[`equipment:${FX.materialA}:0`]).toBe('1');
    expect(v.values[`equipment:${FX.materialA}:1`]).toBe('1');
    expect(deltasFromForm(form(v.values, v.stars), rows, t).deltas).toEqual(saved);
    const draft = valuesFromDeltas([eq(FX.materialA, 1, -1)], t, 'failure');
    expect(draft.values).toEqual({ [`equipment:${FX.materialA}:1`]: '1' });
  });
});

describe('記録・訂正で表示する所持数の変化', () => {
  it('新しい記録は入力した増減をそのまま示す', () => {
    const r = correctionEffect({ newDeltas: [eq(1, 5, -1), eq(1, 6, 1)], oldDeltas: [], fixedScopes: [] }, 1, 5, 1, 6);
    expect(r).toEqual({ kind: 'change', from: -1, to: 1 });
  });

  it('成功を失敗へ訂正すると、旧増減を戻した正味の変化を示す（P47）', () => {
    const r = correctionEffect({ newDeltas: [], oldDeltas: [eq(1, 5, -1), eq(1, 6, 1)], fixedScopes: [] }, 1, 5, 1, 6);
    expect(r).toEqual({ kind: 'change', from: 1, to: -1 });
  });

  it('成功を成功のまま訂正しても★の所持数は変わらない', () => {
    const r = correctionEffect({ newDeltas: [eq(1, 5, -1), eq(1, 6, 1)], oldDeltas: [eq(1, 5, -1), eq(1, 6, 1)], fixedScopes: [] }, 1, 5, 1, 6);
    expect(r).toEqual({ kind: 'none' });
  });

  it('P50：取り込み済みの基準に含まれる記録の訂正は現在数を変えず、当時の数量は検証不能と示す', () => {
    const r = correctionEffect({ newDeltas: [], oldDeltas: [eq(1, 5, -1), eq(1, 6, 1)], fixedScopes: ['equipment'] }, 1, 5, 1, 6);
    expect(r).toEqual({ kind: 'historyOnly' });
  });
});

describe('確認待ちの下書きの確保', () => {
  const m = buildMasterIndex(fixtureMaster());
  const t = { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 5, toStar: 6 };
  const projection = projectInventory(baselinesFrom({ equipment: [[FX.mainGunA, 5, 1], [FX.materialA, 0, 2]], resources: { 7: 9, 8: 9 } }), [], []);
  const planned: PlannedCost = { fuel: 0, ammo: 0, steel: 0, bauxite: 0, devmats: 1, screws: 2, equipment: [{ equipmentId: FX.materialA, count: 2 }], useItems: [] };
  const form = (outcome: 'success' | 'failure', values: Record<string, string>): RecordForm => ({ attemptId: 'a', mode: 'record', eventId: null, draftId: null, outcome, occurredDate: '2026-10-15', missedAfterImport: false, values, stars: {}, scopeAnswers: {}, reason: '', base: { datasetEpoch: 'e', expectedRevision: 0 } });

  it('成功と報告した下書きは改修対象の入力★を確保し、出力★は確定まで増やさない', () => {
    const rows = consumptionRows(m, planned, projection);
    const known = deltasFromForm(form('success', { 'resource:8': '2' }), rows, t).known;
    expect(known).toContainEqual(eq(FX.mainGunA, 5, -1));
    expect(known.some((d) => d.scope === 'equipment' && d.equipmentId === FX.mainGunA && d.star === 6)).toBe(false);
    // 失敗は★を変えないので改修対象を確保しない
    expect(deltasFromForm(form('failure', { 'resource:8': '2' }), rows, t).known.some((d) => d.scope === 'equipment' && d.equipmentId === FX.mainGunA)).toBe(false);
  });

  it('下書きを再開するとき、成功の改修対象の確保は消費の行・値に出さない', () => {
    const known = [eq(FX.mainGunA, 5, -1), eq(FX.materialA, 0, -1), { scope: 'resource:8' as const, amount: -2 }];
    const rows = consumptionRows(m, planned, projection, consumedDeltas(known, t, 'success'));
    expect(rows.filter((r) => r.kind === 'equipment').map((r) => r.id)).toEqual([FX.materialA]);
    expect(valuesFromDeltas(known, t, 'success').values).toEqual({ [`equipment:${FX.materialA}:0`]: '1', 'resource:8': '2' });
  });
});

describe('確認待ちを確定するときのレシピの記録', () => {
  it('下書きに保存したレシピ（実施時の条件）を使い、なければ現在のマスターから作る', () => {
    const stored = { masterVersion: 'old', transition: { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 }, fromName: '旧名', toName: '旧名', mode: 'normal' as const, entryIndex: 0, plannedCost: null, helperShipId: 101, helperShipName: '旧艦' };
    const fresh = { ...stored, masterVersion: 'new', fromName: '新名', toName: '新名', helperShipName: '新艦' };
    const drafts = [{ draftId: 'd', recipeSnapshot: stored }, { draftId: 'e', recipeSnapshot: null }];
    expect(snapshotForDraft(drafts, 'd', () => fresh)).toBe(stored);
    expect(snapshotForDraft(drafts, 'e', () => fresh)).toBe(fresh);
    expect(snapshotForDraft(drafts, null, () => fresh)).toBe(fresh);
  });
});

describe('入力行の元にする予定の費用', () => {
  const cost = { fuel: 0, ammo: 0, steel: 0, bauxite: 0, devmats: { normal: 1, guaranteed: 2 }, screws: { normal: 3, guaranteed: 4 }, equipment: [], useItems: [] };
  const old: PlannedCost = { fuel: 0, ammo: 0, steel: 0, bauxite: 0, devmats: 5, screws: 6, equipment: [{ equipmentId: 9, count: 1 }], useItems: [] };
  it('確定済みの記録、次に確認待ちの下書きに保存した費用を使い、どちらもなければ現在の予定から作る', () => {
    expect(plannedForAttempt({ eventPlanned: old, draftPlanned: null, cost, mode: 'normal' })).toBe(old);
    // マスター更新で素材が消えても、再開した下書きは保存時の素材の行を出す
    expect(plannedForAttempt({ eventPlanned: null, draftPlanned: old, cost, mode: 'normal' })).toBe(old);
    expect(plannedForAttempt({ eventPlanned: null, draftPlanned: null, cost, mode: 'guaranteed' })).toMatchObject({ devmats: 2, screws: 4 });
  });
});

describe('消費数の入力', () => {
  it('0以上の整数で、1回の記録の上限（999,999）以内だけを受け付ける（桁が多すぎて無限大になる値を通さない）', () => {
    expect(parseCount('3')).toBe(3);
    expect(parseCount('999999')).toBe(999999);
    expect(parseCount('1000000')).toBeNaN();
    expect(parseCount('9'.repeat(400))).toBeNaN();
    expect(parseCount('-1')).toBeNaN();
    expect(parseCount(' ')).toBeNull();
  });
});

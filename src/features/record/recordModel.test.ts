import { describe, expect, it } from 'vitest';
import type { Delta } from '../../domain/model';
import { projectInventory } from '../../domain/inventory/projection';
import { buildMasterIndex } from '../../domain/master';
import { FX, fixtureMaster } from '../../test-support/fixtureMaster';
import { consumedDeltas, consumptionRows, correctionEffect, savedValues } from './recordModel';

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
    expect(v.values[`equipment:${FX.materialA}`]).toBe('2');
  });

  it('失敗の記録は★変化がないので、装備の消費はそのまま行にする', () => {
    const failure: Delta[] = [eq(FX.materialA, 0, -2), { scope: 'resource:8', amount: -3 }];
    expect(consumedDeltas(failure, t, 'failure')).toEqual(failure);
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

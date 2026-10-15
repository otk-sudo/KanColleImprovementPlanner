import { describe, expect, it } from 'vitest';
import { buildMasterIndex } from '../../domain/master';
import { FX, fixtureMaster } from '../../test-support/fixtureMaster';
import { projectInventory } from '../../domain/inventory/projection';
import { baselinesFrom, goal, planInput } from '../../test-support/planFixtures';
import { buildPlan } from '../../domain/planning/plan';
import { equipmentRows, helperRows, requiredLabel, stageName } from './inventoryModel';

describe('改造段階名（S16・S05）', () => {
  const m = buildMasterIndex(fixtureMaster());

  it('改造前の艦を基準に、改・改二などの段階名を返す', () => {
    expect(stageName(m, FX.shipA)).toBe('未改造');
    expect(stageName(m, FX.shipAKai)).toBe('改');
    expect(stageName(m, FX.shipAKai2)).toBe('改二');
  });

  it('系統の途中の艦（改）を基準にしない（「二を所持」のような誤表示をしない）', () => {
    expect(stageName(m, FX.shipCKai2)).toBe('改二');
    expect(stageName(m, FX.shipCKai2)).not.toBe('二');
  });

  it('マスターにない艦はIDで示す', () => {
    expect(stageName(m, 99999)).toBe('ID 99999');
  });
});

describe('目標に関係する担当艦（S16）', () => {
  it('同じ系統でも装備ごとに要求する改造段階が違えば、要求ごとに行を分けて状態を判定する', () => {
    const f = fixtureMaster();
    // 主砲A は艦娘A のどの段階でも可、副砲B は艦娘A改二が必要。所持は艦娘A（未改造）だけ
    f.recipes = f.recipes.map((r) =>
      r.equipmentId === FX.mainGunA
        ? { ...r, entries: r.entries.map((e) => ({ ...e, helpers: [{ shipIds: [FX.shipA, FX.shipAKai, FX.shipAKai2], days: [1, 3, 5] }] })) }
        : r.equipmentId === FX.secondaryB
          ? { ...r, entries: r.entries.map((e) => ({ ...e, helpers: [{ shipIds: [FX.shipAKai2], days: [1, 3, 5] }] })) }
          : r,
    );
    const m = buildMasterIndex(f);
    const projection = projectInventory(baselinesFrom({ ships: [FX.shipA] }), [], []);
    const goals = [goal({ goalId: 'a', equipmentId: FX.mainGunA, targetStar: 1, count: 1 }), goal({ goalId: 'b', equipmentId: FX.secondaryB, targetStar: 1, count: 1 })];
    const rows = helperRows(m, projection, goals, null);
    expect(rows.map((r) => [r.status, r.targets])).toEqual([
      ['ok', [FX.mainGunA]],
      ['remodel', [FX.secondaryB]],
    ]);
    expect(requiredLabel(m, rows[1]!)).toBe('! 改二が必要');
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe('装備一覧（S17）', () => {
  it('取り込みで所持が0になった保護対象の★も、保護の確認が必要な行として残す', () => {
    const prot = { bucket: `${FX.mainGunA}:6`, equipmentId: FX.mainGunA, star: 6, count: 1, instanceIds: null, reason: '', reconciliationRequired: true, reconciliationSnapshotId: 's', previousOwned: 1, updatedAt: '' };
    const input = planInput({ inventory: { equipment: [[FX.mainGunA, 5, 1]], ships: [], resources: {} }, goals: [], protections: [prot] });
    const rows = equipmentRows(input.inventory, buildPlan(input));
    const zero = rows.find((r) => r.key === `${FX.mainGunA}:6`);
    expect(zero).toMatchObject({ owned: 0, reconciliationRequired: true, protectionRequested: 1 });
    expect(rows.find((r) => r.key === `${FX.mainGunA}:5`)?.owned).toBe(1);
  });
});

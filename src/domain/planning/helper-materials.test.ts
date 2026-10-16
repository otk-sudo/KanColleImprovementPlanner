import { describe, expect, it } from 'vitest';
import { fixtureMaster, FX, stage } from '../../test-support/fixtureMaster';
import { attempt, goal, planInput } from '../../test-support/planFixtures';
import { buildPlan } from './plan';

const days = [0, 1, 2, 3, 4, 5, 6];
const key = (g = 'g', star = 0, ordinal = 0) => `${g}|${FX.mainGunA}:${star}>${star + 1}|${ordinal}`;
function master() {
  const m = fixtureMaster();
  const base = { fuel: 0, ammo: 0, steel: 0, bauxite: 0, conv: null, extra: [] };
  const a = stage({ screws: 1, screwsGuaranteed: 2, equipment: [{ equipmentId: FX.materialA, count: 1 }] });
  const b = stage({ screws: 3, screwsGuaranteed: 4, equipment: [{ equipmentId: FX.secondaryB, count: 2 }], useItems: [{ useItemId: FX.itemB, count: 1 }] });
  const free = stage();
  m.recipes = [
    { equipmentId: FX.mainGunA, entries: [
      { entryIndex: 0, helpers: [{ shipIds: [FX.shipAKai2], days }], convert: null, cost: { ...base, p1: a, p2: a } },
      { entryIndex: 1, helpers: [{ shipIds: [FX.shipBKai2], days }], convert: null, cost: { ...base, p1: b, p2: b } },
    ] },
    { equipmentId: FX.craftSource, entries: [{ entryIndex: 0, helpers: [{ shipIds: [FX.shipAKai2], days }], convert: { toEquipmentId: FX.secondaryB, toStar: 0 }, cost: { ...base, p1: free, p2: free, conv: free } }] },
  ];
  return m;
}
const inventory = { equipment: [[FX.mainGunA, 0, 1], [FX.materialA, 0, 10], [FX.secondaryB, 0, 10]] as [number, number, number][], ships: [FX.shipAKai2, FX.shipBKai2], resources: { 8: 100 }, items: { [FX.itemB]: 100 } };
const target = () => goal({ goalId: 'g', equipmentId: FX.mainGunA, targetStar: 1 });

describe('R11/R13/R19：希望担当艦に合わせた素材展開', () => {
  it('適合する別担当を指定したら、その素材・アイテム・費用で配置する', () => {
    const p = buildPlan(planInput({ master: master(), inventory, goals: [target()], preferredHelpers: [{ stepKey: key(), shipId: FX.shipBKai2 }] }));
    expect(p.unplaced).toEqual([]);
    expect(p.placements[0]).toMatchObject({ date: '2026-10-14', helperShipId: FX.shipBKai2, entryIndex: 1, tentative: false });
    expect(p.totals.find(t => t.key === `equipment:${FX.materialA}`)).toBeUndefined();
    expect(p.totals.find(t => t.key === `equipment:${FX.secondaryB}`)?.need).toBe(2);
    expect(p.totals.find(t => t.key === `item:${FX.itemB}`)?.need).toBe(1);
    expect(p.totals.find(t => t.key === 'resource:8')?.need).toBe(3);
  });

  it('選択した担当の不足素材だけを製作し、前提にする', () => {
    const inv = { ...inventory, equipment: [[FX.mainGunA, 0, 1], [FX.materialA, 0, 10], [FX.craftSource, 10, 2]] as [number, number, number][] };
    const g = { ...target(), materialRoutes: { [FX.secondaryB]: { kind: 'craft' as const, routeKey: `${FX.craftSource}>${FX.secondaryB}` } } };
    const p = buildPlan(planInput({ master: master(), inventory: inv, goals: [g], preferredHelpers: [{ stepKey: key(), shipId: FX.shipBKai2 }], settings: { weekdayLimits: days.map(() => 3) } }));
    const parent = p.steps.find(s => s.role === 'target')!;
    expect(parent.predecessorKeys).toHaveLength(2);
    expect(p.steps.filter(s => s.role === 'craft')).toHaveLength(2);
    expect(p.placements.find(x => x.stepKey === parent.stepKey)).toMatchObject({ date: '2026-10-14', tentative: false });
    expect(p.totals.find(t => t.key === `equipment:${FX.materialA}`)).toBeUndefined();
  });

  it('同じ目標の別個数枠に別担当を指定しても、素材を混ぜない', () => {
    const inv = { ...inventory, equipment: [[FX.mainGunA, 0, 2], [FX.materialA, 0, 1], [FX.secondaryB, 0, 2]] as [number, number, number][] };
    const p = buildPlan(planInput({ master: master(), inventory: inv, goals: [{ ...target(), count: 2 }], preferredHelpers: [{ stepKey: key('g', 0, 1), shipId: FX.shipBKai2 }], settings: { weekdayLimits: days.map(() => 2) } }));
    expect(p.unplaced).toEqual([]);
    expect(p.placements.every(x => !x.tentative)).toBe(true);
    expect(p.totals.find(t => t.key === `equipment:${FX.materialA}`)?.need).toBe(1);
    expect(p.totals.find(t => t.key === `equipment:${FX.secondaryB}`)?.need).toBe(2);
  });

  it('取消済みの番号を再利用せず、既存の生きた工程の希望を保つ', () => {
    const transition = { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 0, toStar: 1 };
    const attempts = [attempt({ attemptId: 'old', stepKey: key(), goalId: 'g', transition, lifecycle: 'cancelled' }), attempt({ attemptId: 'live', stepKey: key('g', 0, 2), goalId: 'g', transition, scheduledDate: '2026-10-15', helperShipId: FX.shipBKai2 })];
    const p = buildPlan(planInput({ master: master(), inventory, goals: [target()], attempts, preferredHelpers: [{ stepKey: key('g', 0, 2), shipId: FX.shipBKai2 }] }));
    expect(p.steps.map(s => s.stepKey)).toEqual([key('g', 0, 2)]);
    expect(p.placements[0]).toMatchObject({ attemptId: 'live', helperShipId: FX.shipBKai2, entryIndex: 1 });
    expect(p.unplaced).toEqual([]);
  });

  it('希望を解除すると既定担当の素材へ戻り、別目標への指定は混ざらない', () => {
    const inv = { ...inventory, equipment: [[FX.mainGunA, 0, 2], [FX.materialA, 0, 1], [FX.secondaryB, 0, 2]] as [number, number, number][] };
    const goals = [target(), goal({ goalId: 'other', equipmentId: FX.mainGunA, targetStar: 1 })];
    const spec = { master: master(), inventory: inv, goals, settings: { weekdayLimits: days.map(() => 2) } };
    const selected = buildPlan(planInput({ ...spec, preferredHelpers: [{ stepKey: key(), shipId: FX.shipBKai2 }] }));
    expect(selected.placements.find(p => p.goalId === 'g')?.helperShipId).toBe(FX.shipBKai2);
    expect(selected.placements.find(p => p.goalId === 'other')?.helperShipId).toBe(FX.shipAKai2);
    expect(selected.totals.find(t => t.key === `equipment:${FX.materialA}`)?.need).toBe(1);
    const cleared = buildPlan(planInput(spec));
    expect(cleared.placements.every(p => p.helperShipId === FX.shipAKai2)).toBe(true);
    expect(cleared.totals.find(t => t.key === `equipment:${FX.materialA}`)?.need).toBe(2);
    expect(cleared.totals.find(t => t.key === `equipment:${FX.secondaryB}`)).toBeUndefined();
    expect(buildPlan(planInput(spec))).toEqual(cleared);
  });

  it('素材が保護されていれば、担当に適合しても不足の仮配置にする', () => {
    const p = buildPlan(planInput({ master: master(), inventory, goals: [target()], preferredHelpers: [{ stepKey: key(), shipId: FX.shipBKai2 }], protections: [{ bucket: `${FX.secondaryB}:0`, equipmentId: FX.secondaryB, star: 0, count: 10, instanceIds: null, reason: '', reconciliationRequired: false, reconciliationSnapshotId: null, previousOwned: null, updatedAt: '' }] }));
    expect(p.unplaced).toEqual([]);
    expect(p.placements[0]).toMatchObject({ helperShipId: FX.shipBKai2, tentative: true });
    expect(p.totals.find(t => t.key === `equipment:${FX.secondaryB}`)?.shortage).toBe(2);
  });

  it('未所持の希望担当を別担当に置き換えない', () => {
    const p = buildPlan(planInput({ master: master(), inventory: { ...inventory, ships: [FX.shipAKai2] }, goals: [target()], preferredHelpers: [{ stepKey: key(), shipId: FX.shipBKai2 }] }));
    expect(p.unplaced[0]?.reasons).toContain('PREFERRED_HELPER_UNAVAILABLE');
    expect(p.placements[0]?.date).toBeNull();
  });

  it('当日に不適合な希望を指定したら、既存担当と素材を保って確認待ちにする', () => {
    const transition = { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 0, toStar: 1 };
    const fixed = attempt({ attemptId: `${key()}@1`, stepKey: key(), goalId: 'g', transition, scheduledDate: '2026-10-14', helperShipId: FX.shipAKai2 });
    const m = master();
    m.recipes[0]!.entries[1]!.helpers[0]!.days = [1];
    const p = buildPlan(planInput({ master: m, inventory, goals: [target()], attempts: [fixed], preferredHelpers: [{ stepKey: key(), shipId: FX.shipBKai2 }] }));
    expect(p.placements[0]).toMatchObject({ attemptId: fixed.attemptId, date: '2026-10-14', executionGate: 'reviewRequired' });
    expect(p.attemptChanges.cancel).toEqual([]);
    expect(p.attemptChanges.create).toEqual([]);
    expect(p.placements[0]).toMatchObject({ helperShipId: FX.shipAKai2, entryIndex: 0 });
    expect(p.totals.find(t => t.key === `equipment:${FX.materialA}`)?.need).toBe(1);
    expect(p.totals.find(t => t.key === `equipment:${FX.secondaryB}`)).toBeUndefined();
  });

  it('当日に適合する希望担当への明示変更は、日付と枠を変えずその素材で反映する', () => {
    const transition = { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 0, toStar: 1 };
    const fixed = attempt({ attemptId: `${key()}@1`, stepKey: key(), goalId: 'g', transition, scheduledDate: '2026-10-14', helperShipId: FX.shipAKai2 });
    const p = buildPlan(planInput({ master: master(), inventory, goals: [target()], attempts: [fixed], preferredHelpers: [{ stepKey: key(), shipId: FX.shipBKai2 }] }));
    expect(p.placements[0]).toMatchObject({ attemptId: fixed.attemptId, date: '2026-10-14', dayOrder: 1, executionGate: 'ready', helperShipId: FX.shipBKai2, entryIndex: 1 });
    expect(p.totals.find(t => t.key === `equipment:${FX.materialA}`)).toBeUndefined();
    expect(p.totals.find(t => t.key === `equipment:${FX.secondaryB}`)?.need).toBe(2);
    expect(p.attemptChanges.update[0]).toMatchObject({ attemptId: fixed.attemptId, helperShipId: FX.shipBKai2, scheduledDate: fixed.scheduledDate });
    expect(p.attemptChanges.cancel).toEqual([]);
    expect(p.attemptChanges.create).toEqual([]);
  });

  it('素材製作の工程にも希望担当を適用し、子工程の消費を一度だけ足す', () => {
    const m = master();
    const recipe = m.recipes.find(r => r.equipmentId === FX.craftSource)!;
    const alternate = structuredClone(recipe.entries[0]!);
    alternate.entryIndex = 1;
    alternate.helpers = [{ shipIds: [FX.shipBKai2], days }];
    alternate.cost.conv = stage({ equipment: [{ equipmentId: FX.materialA, count: 2 }] });
    recipe.entries.push(alternate);
    const inv = { ...inventory, equipment: [[FX.mainGunA, 0, 1], [FX.materialA, 0, 2], [FX.craftSource, 10, 2]] as [number, number, number][] };
    const g = { ...target(), materialRoutes: { [FX.secondaryB]: { kind: 'craft' as const, routeKey: `${FX.craftSource}>${FX.secondaryB}` } } };
    const craftKey = `g|craft:${FX.secondaryB}|${FX.craftSource}:10>${FX.secondaryB}:0|0`;
    const spec = { master: m, inventory: inv, goals: [g], preferredHelpers: [{ stepKey: key(), shipId: FX.shipBKai2 }, { stepKey: craftKey, shipId: FX.shipBKai2 }], settings: { weekdayLimits: days.map(() => 3) } };
    const p = buildPlan(planInput(spec));
    expect(p.unplaced).toEqual([]);
    expect(p.placements.find(x => x.stepKey === craftKey)).toMatchObject({ entryIndex: 1, helperShipId: FX.shipBKai2, tentative: false });
    expect(p.totals.find(t => t.key === `equipment:${FX.materialA}`)?.need).toBe(2);
    expect(new Set(p.steps.map(s => s.stepKey)).size).toBe(p.steps.length);
    expect(buildPlan(planInput({ ...spec, inventory: { ...inv, equipment: [...inv.equipment].reverse() } }))).toEqual(p);
  });

  it('同じ担当艦に曜日別の別素材がある当日固定では、今日のエントリで展開する', () => {
    const m = master();
    m.recipes[0]!.entries[0]!.helpers = [{ shipIds: [FX.shipAKai2], days: [1] }];
    m.recipes[0]!.entries[1]!.helpers = [{ shipIds: [FX.shipAKai2], days: [3] }];
    const transition = { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 0, toStar: 1 };
    const fixed = attempt({ attemptId: `${key()}@1`, stepKey: key(), goalId: 'g', transition, scheduledDate: '2026-10-14', helperShipId: FX.shipAKai2 });
    const p = buildPlan(planInput({ master: m, inventory, goals: [target()], attempts: [fixed] }));
    expect(p.placements[0]).toMatchObject({ entryIndex: 1, helperShipId: FX.shipAKai2, executionGate: 'ready', tentative: false });
    expect(p.totals.find(t => t.key === `equipment:${FX.secondaryB}`)?.need).toBe(2);
    expect(p.totals.find(t => t.key === `equipment:${FX.materialA}`)).toBeUndefined();
    expect(p.steps[0]?.helperNote?.preferredShipId).toBeNull();
  });

  it('当日固定の担当が未所持になった場合、希望未指定なのに希望担当のエラーとしない', () => {
    const transition = { kind: 'improve' as const, equipmentId: FX.mainGunA, fromStar: 0, toStar: 1 };
    const fixed = attempt({ attemptId: `${key()}@1`, stepKey: key(), goalId: 'g', transition, scheduledDate: '2026-10-14', helperShipId: FX.shipAKai2 });
    const p = buildPlan(planInput({ master: master(), inventory: { ...inventory, ships: [FX.shipBKai2] }, goals: [target()], attempts: [fixed] }));
    expect(p.placements[0]).toMatchObject({ helperShipId: FX.shipAKai2, entryIndex: 0, executionGate: 'reviewRequired', date: fixed.scheduledDate });
    expect(p.steps[0]!.blockers).toContain('HELPER_MISSING');
    expect(p.steps[0]!.blockers).not.toContain('PREFERRED_HELPER_UNAVAILABLE');
  });
});

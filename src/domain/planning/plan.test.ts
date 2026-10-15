import { describe, expect, it } from 'vitest';
import { FX, fixtureMaster, stage } from '../../test-support/fixtureMaster';
import { attempt, goal, planInput } from '../../test-support/planFixtures';
import type { MasterFile } from '../master/schema';
import type { DraftResult, ResultEvent } from '../model';
import { buildPlan, COMPUTATION_LIMITS } from './plan';

const ALL = [0, 1, 2, 3, 4, 5, 6];

/** 単純な架空マスター：X(1) の★改修はネジ screws 個・素材 Y(2) を fodder 個。担当艦 H改二(101) は days。 */
function simpleMaster(opts: { screws?: number; fodder?: number; days?: number[]; helpers?: boolean; craft?: boolean; cycle?: boolean } = {}): MasterFile {
  const m = fixtureMaster();
  const st = stage({ devmats: 1, devmatsGuaranteed: 2, screws: opts.screws ?? 4, screwsGuaranteed: (opts.screws ?? 4) + 2, equipment: opts.fodder ? [{ equipmentId: 2, count: opts.fodder }] : [] });
  m.equipment = [
    { id: 1, name: 'X', typeId: 1, typeName: '', iconId: 1, sortNo: 1 },
    { id: 2, name: 'Y', typeId: 1, typeName: '', iconId: 1, sortNo: 2 },
    { id: 3, name: 'Z', typeId: 1, typeName: '', iconId: 1, sortNo: 3 },
  ];
  m.ships = [
    { id: 100, name: 'H', yomi: '', shipTypeId: 2, afterShipId: 101, afterLevel: 50, familyId: 100, sortNo: 1 },
    { id: 101, name: 'H改二', yomi: '', shipTypeId: 2, afterShipId: null, afterLevel: null, familyId: 100, sortNo: 2 },
  ];
  const helpers = opts.helpers === false ? [] : [{ shipIds: [101], days: opts.days ?? ALL }];
  const cost = { fuel: 0, ammo: 0, steel: 0, bauxite: 0, p1: st, p2: st, conv: null, extra: [] };
  m.recipes = [{ equipmentId: 1, entries: [{ entryIndex: 0, helpers, convert: null, cost }] }];
  if (opts.craft) {
    // Z ★MAX → Y★0（素材Yの製作経路）。Z の改修はネジ1
    const zs = stage({ screws: 1, screwsGuaranteed: 1, equipment: opts.cycle ? [{ equipmentId: 1, count: 1 }] : [] });
    m.recipes.push({ equipmentId: 3, entries: [{ entryIndex: 0, helpers: [{ shipIds: [101], days: ALL }], convert: { toEquipmentId: 2, toStar: 0 }, cost: { fuel: 0, ammo: 0, steel: 0, bauxite: 0, p1: zs, p2: zs, conv: zs, extra: [] } }] });
    if (opts.cycle) {
      // X ★MAX → Z★0 も追加（Y を作るのに X が要り、X の改修に Y が要る）
      m.recipes[0]!.entries.push({ entryIndex: 1, helpers: [{ shipIds: [101], days: ALL }], convert: { toEquipmentId: 3, toStar: 0 }, cost: { ...cost, conv: st } });
    }
  }
  return m;
}

describe('完成品と改修対象の配分', () => {
  it('P01：★6以上2個と★10を1個。★10を二重に数えず残り1', () => {
    const g6 = goal({ goalId: 'g6', equipmentId: 1, targetStar: 6, count: 2 });
    const g10 = goal({ goalId: 'g10', equipmentId: 1, targetStar: 10, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 6, 1], [1, 10, 1]], ships: [101], resources: { 8: 100, 7: 100 } }, goals: [g6, g10] }));
    const p6 = plan.goals.find((g) => g.goalId === 'g6')!;
    const p10 = plan.goals.find((g) => g.goalId === 'g10')!;
    expect(p10.completed).toBe(1);
    expect(p10.completedBuckets).toEqual([{ equipmentId: 1, star: 10, count: 1 }]);
    expect(p6.completed).toBe(1);
    expect(p6.completed + p10.completed).toBe(2);
    expect(p6.missingUnits).toBe(1);
  });

  it('P02：手動保護と目標の完成品が同じ1個なら保護は1個', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 6, count: 1 });
    const plan = buildPlan(
      planInput({
        master: simpleMaster(),
        inventory: { equipment: [[1, 6, 1]], ships: [101] },
        goals: [g],
        protections: [{ bucket: '1:6', equipmentId: 1, star: 6, count: 1, instanceIds: null, reason: '手動', reconciliationRequired: false, reconciliationSnapshotId: null, previousOwned: null, updatedAt: '' }],
      }),
    );
    const b = plan.buckets.find((x) => x.equipmentId === 1 && x.star === 6)!;
    expect(b.effectiveProtection).toBe(1);
    expect(b.materialAvailable).toBe(0);
  });

  it('P03：低優先度目標の改修対象は高優先度の素材にしない', () => {
    const high = goal({ goalId: 'high', equipmentId: 1, targetStar: 1, count: 1, priority: 1 });
    const low = goal({ goalId: 'low', equipmentId: 2, targetStar: 1, count: 1, priority: 2 });
    const m = simpleMaster({ fodder: 1 });
    m.recipes.push({ equipmentId: 2, entries: [{ entryIndex: 0, helpers: [{ shipIds: [101], days: ALL }], convert: null, cost: { fuel: 0, ammo: 0, steel: 0, bauxite: 0, p1: stage(), p2: stage(), conv: null, extra: [] } }] });
    const plan = buildPlan(planInput({ master: m, inventory: { equipment: [[1, 0, 1], [2, 0, 1]], ships: [101], resources: { 8: 100, 7: 100 } }, goals: [high, low] }));
    expect(plan.goals.find((g) => g.goalId === 'low')!.targetUnits).toEqual([{ equipmentId: 2, star: 0 }]);
    const y = plan.totals.find((t) => t.key === 'equipment:2')!;
    expect(y.need).toBe(1);
    expect(y.available).toBe(0);
    expect(y.shortage).toBe(1);
  });
});

describe('素材の製作と循環', () => {
  it('P04：不足する素材Yを製作経路で補い、製作工程を親の前提にする', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1, materialRoutes: { '2': { kind: 'craft', routeKey: '3>2' } } });
    const plan = buildPlan(planInput({ master: simpleMaster({ fodder: 2, craft: true }), inventory: { equipment: [[1, 0, 1], [3, 9, 2]], ships: [101], resources: { 8: 100, 7: 100 } }, goals: [g] }));
    const crafts = plan.steps.filter((s) => s.role === 'craft');
    // Z★9 2個をそれぞれ ★10 → Y へ更新：各2工程×2
    expect(crafts).toHaveLength(4);
    const parent = plan.steps.find((s) => s.role === 'target')!;
    const finals = crafts.filter((s) => s.transition.kind === 'convert').map((s) => s.stepKey);
    expect(parent.predecessorKeys.sort()).toEqual(finals.sort());
    const y = plan.totals.find((t) => t.key === 'equipment:2')!;
    expect(y.planned).toBe(2);
    expect(y.shortage).toBe(0);
    // ネジは X の1回(4) + Z 4工程(各1) を一度ずつ
    expect(plan.totals.find((t) => t.key === 'resource:8')!.need).toBe(8);
  });

  it('P05：Y を X から作る経路で、X の改修に Y が要るなら循環として未配置', () => {
    // X(1)★9 → ★10 → Z(3) → … → Y(2)。X の改修そのものに Y が必要
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1, matchMode: 'exact', materialRoutes: { '2': { kind: 'craft', routeKey: '1>3>2' } } });
    const plan = buildPlan(planInput({ master: simpleMaster({ fodder: 1, craft: true, cycle: true }), inventory: { equipment: [[1, 0, 1], [1, 9, 1]], ships: [101], resources: { 8: 100, 7: 100 } }, goals: [g] }));
    expect(plan.unplaced.some((p) => p.reasons.includes('CYCLE'))).toBe(true);
    const target = plan.steps.find((s) => s.role === 'target')!;
    expect(plan.unplaced.find((p) => p.stepKey === target.stepKey)?.reasons).toContain('PREDECESSOR_BLOCKED');
  });

  it('P05：別の枝で同じ素材を2回使うのは循環ではない', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 2, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster({ fodder: 1 }), inventory: { equipment: [[1, 0, 1], [2, 0, 2]], ships: [101], resources: { 8: 100, 7: 100 } }, goals: [g] }));
    expect(plan.unplaced).toEqual([]);
    expect(plan.totals.find((t) => t.key === 'equipment:2')!.shortage).toBe(0);
  });
});

describe('日程配置と仮想在庫', () => {
  it('P06：ネジ6・各工程4なら累積不足は 0・2・6（丸めない）', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 3, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster({ screws: 4 }), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 6, 7: 100 } }, goals: [g], settings: { weekdayLimits: [1, 1, 1, 1, 1, 1, 1] } }));
    const placed = plan.placements.filter((p) => p.date).sort((a, b) => (a.date! < b.date! ? -1 : 1));
    expect(placed.map((p) => p.shortages.find((s) => s.key === 'resource:8')?.deficit ?? 0)).toEqual([0, 2, 6]);
    expect(placed.map((p) => p.tentative)).toEqual([false, true, true]);
    expect(placed.map((p) => p.date)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
  });

  it('素材装備が足りていれば仮配置にしない（割当済みの素材を日程の仮想在庫で二重に引かない）', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 6, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster({ fodder: 2 }), inventory: { equipment: [[1, 5, 1], [2, 0, 3]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g] }));
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0]!.tentative).toBe(false);
    // shortages は消費する全項目を持つ。素材装備Y（ID 2）を含め、どれも不足0
    expect(plan.placements[0]!.shortages.map((s) => [s.key, s.deficit])).toEqual(expect.arrayContaining([['equipment:2', 0]]));
    expect(plan.placements[0]!.shortages.every((s) => s.deficit === 0)).toBe(true);
    expect(plan.totals.find((t) => t.key === 'equipment:2')?.shortage ?? 0).toBe(0);
  });

  it('P07：艦娘未取得は未配置、資材不足は仮配置、条件不明は未配置', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const unknownShips = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], resources: { 8: 0, 7: 0 } }, goals: [g] }));
    expect(unknownShips.unplaced[0]?.reasons).toContain('HELPER_UNKNOWN');

    const short = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 0, 7: 0 } }, goals: [g] }));
    expect(short.unplaced).toEqual([]);
    expect(short.placements[0]?.tentative).toBe(true);

    const noHelpers = buildPlan(planInput({ master: simpleMaster({ helpers: false }), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 100, 7: 100 } }, goals: [g] }));
    expect(noHelpers.unplaced[0]?.reasons).toContain('RECIPE_UNKNOWN');
  });

  it('担当艦の改造段階が違う・未所持を区別する', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const mismatch = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [100], resources: { 8: 9, 7: 9 } }, goals: [g] }));
    expect(mismatch.unplaced[0]?.reasons).toContain('REMODEL_MISMATCH');
    const missing = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [], resources: { 8: 9, 7: 9 } }, goals: [g] }));
    expect(missing.unplaced[0]?.reasons).toContain('HELPER_MISSING');
  });

  it('P08：前提と後続は上限2なら同日（前提が先）、上限1なら別日', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 2, count: 1 });
    const two = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], settings: { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] } }));
    const sorted = two.placements.slice().sort((a, b) => a.dayOrder - b.dayOrder);
    expect(sorted.map((p) => p.date)).toEqual(['2026-10-14', '2026-10-14']);
    expect(sorted.map((p) => p.stepKey.split('|')[1])).toEqual(['1:0>1', '1:1>2']);
    const one = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], settings: { weekdayLimits: [1, 1, 1, 1, 1, 1, 1] } }));
    expect(one.placements.map((p) => p.date).sort()).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('担当艦の曜日・利用者の休み・曜日上限を守る', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 3, count: 1 });
    // 担当艦は月・水・金（1,3,5）。10/14(水) は休み指定、金曜上限0
    const plan = buildPlan(
      planInput({
        master: simpleMaster({ days: [1, 3, 5] }),
        inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } },
        goals: [g],
        settings: { weekdayLimits: [1, 1, 1, 1, 1, 0, 1], holidays: [{ holidayId: 'h', start: '2026-10-14', end: '2026-10-14' }] },
      }),
    );
    expect(plan.placements.map((p) => p.date)).toEqual(['2026-10-19', '2026-10-21', '2026-10-26']);
  });

  it('P19：探索期間内に空きがなければ SEARCH_LIMIT（改修不可とは表示しない）', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 3, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], settings: { weekdayLimits: [1, 1, 1, 1, 1, 1, 1], searchDays: 2 } }));
    expect(plan.unplaced.map((p) => p.reasons[0])).toEqual(['SEARCH_LIMIT']);
  });

  it('担当艦の曜日と実施できる曜日が重ならなければ NO_AVAILABLE_DAY', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster({ days: [2] }), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], settings: { weekdayLimits: [1, 1, 0, 1, 1, 1, 1] } }));
    expect(plan.unplaced[0]?.reasons).toContain('NO_AVAILABLE_DAY');
  });

  it('P21：同じ入力で3回計算すると同じ工程・日付・順番・理由', () => {
    const goals = [goal({ goalId: 'a', equipmentId: 1, targetStar: 4, count: 2, priority: 1 }), goal({ goalId: 'b', equipmentId: 1, targetStar: 2, count: 1, priority: 2 })];
    const spec = { master: simpleMaster({ fodder: 1 }), inventory: { equipment: [[1, 0, 3], [2, 0, 2]] as [number, number, number][], ships: [101], resources: { 8: 10, 7: 10 } }, goals };
    const r = [buildPlan(planInput(spec)), buildPlan(planInput(spec)), buildPlan(planInput(spec))].map((p) => JSON.stringify({ s: p.steps, p: p.placements, u: p.unplaced }));
    expect(r[1]).toBe(r[0]);
    expect(r[2]).toBe(r[0]);
  });
});

describe('当日の固定・スキップ・失敗', () => {
  const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 2, count: 1 });
  const t01 = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };

  it('P09：当日スキップした枠は自動補充せず、その工程は翌日以降の見込みとして表示する', () => {
    const skipped = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', outcome: 'skip' });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [skipped], settings: { weekdayLimits: [1, 1, 1, 1, 1, 1, 1] } }));
    const today = plan.placements.filter((p) => p.date === '2026-10-14');
    expect(today).toEqual([]);
    const first = plan.placements.find((p) => p.stepKey === 'g|1:0>1|0')!;
    expect(first.provisional).toBe(true);
    expect(first.date).toBe('2026-10-15');
    expect(plan.attemptChanges.create.some((a) => a.stepKey === 'g|1:0>1|0')).toBe(false);
  });

  it('P11：成功1・失敗1で上限2なら当日の追加はなく、失敗の再挑戦は翌日以降', () => {
    const goal2 = goal({ goalId: 'g', equipmentId: 1, targetStar: 3, count: 1 });
    const t12 = { kind: 'improve' as const, equipmentId: 1, fromStar: 1, toStar: 2 };
    const succeeded = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', outcome: 'success', dayOrder: 1 });
    const failed = attempt({ attemptId: 'g|1:1>2|0@1', stepKey: 'g|1:1>2|0', goalId: 'g', transition: t12, scheduledDate: '2026-10-14', outcome: 'failure', dayOrder: 2 });
    // 成功で★1になった在庫
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 1, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [goal2], attempts: [succeeded, failed], settings: { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] } }));
    expect(plan.placements.filter((p) => p.date === '2026-10-14')).toEqual([]);
    const retry = plan.placements.find((p) => p.stepKey === 'g|1:1>2|0')!;
    expect(retry.date).toBe('2026-10-15');
    expect(retry.attemptId).toBe('g|1:1>2|0@2');
  });

  it('P22：当日の予定の対象が在庫更新で消えたら当日に残して確認待ち（自動で翌日へ移さない）', () => {
    const today = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14' });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [today] }));
    const kept = plan.placements.find((p) => p.attemptId === today.attemptId)!;
    expect(kept.date).toBe('2026-10-14');
    expect(kept.executionGate).toBe('reviewRequired');
    expect(plan.attemptChanges.cancel).toEqual([]);
  });

  it('P25：同日 A→B の A をスキップすると、B は当日に残して前提待ち（自動で翌日へ移さない）', () => {
    const t12 = { kind: 'improve' as const, equipmentId: 1, fromStar: 1, toStar: 2 };
    const skipA = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', outcome: 'skip', dayOrder: 1 });
    const b = attempt({ attemptId: 'g|1:1>2|0@1', stepKey: 'g|1:1>2|0', goalId: 'g', transition: t12, scheduledDate: '2026-10-14', dayOrder: 2, predecessorAttemptId: skipA.attemptId });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [skipA, b], settings: { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] } }));
    const kept = plan.placements.find((p) => p.attemptId === b.attemptId)!;
    expect(kept.date).toBe('2026-10-14');
    expect(kept.executionGate).toBe('predecessorPending');
    expect(plan.attemptChanges.cancel).toEqual([]);
    // A の次回は翌日以降の見込み（当日枠を自動補充しない）
    const nextA = plan.placements.find((p) => p.stepKey === 'g|1:0>1|0')!;
    expect(nextA.date).toBe('2026-10-15');
  });

  it('P26：A 失敗後に同日再挑戦で成功したら、日上限内の B は前提待ちを解除する', () => {
    const t12 = { kind: 'improve' as const, equipmentId: 1, fromStar: 1, toStar: 2 };
    const failA = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', outcome: 'failure', dayOrder: 1, lifecycle: 'superseded' });
    const retryA = attempt({ attemptId: 'g|1:0>1|0@2', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', outcome: 'success', dayOrder: 2, predecessorAttemptId: null });
    const b = attempt({ attemptId: 'g|1:1>2|0@1', stepKey: 'g|1:1>2|0', goalId: 'g', transition: t12, scheduledDate: '2026-10-14', dayOrder: 3, predecessorAttemptId: failA.attemptId, executionGate: 'predecessorPending' });
    // A の成功で X は★1 になっている
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 1, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [failA, retryA, b], settings: { weekdayLimits: [3, 3, 3, 3, 3, 3, 3] } }));
    const kept = plan.placements.find((p) => p.attemptId === b.attemptId)!;
    expect(kept.date).toBe('2026-10-14');
    expect(kept.executionGate).toBe('ready');
    expect(plan.attemptChanges.update.find((u) => u.attemptId === b.attemptId)?.executionGate ?? 'ready').toBe('ready');
  });

  it('日全体スキップの日には新しい予定を置かない', () => {
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], daySkips: [{ date: '2026-10-14', createdAt: '' }] }));
    expect(plan.placements.every((p) => p.date !== '2026-10-14')).toBe(true);
  });

  it('当日の既存予定は日付と順番を保ち、将来分だけ再配置する', () => {
    const fixed = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', dayOrder: 1 });
    const future = attempt({ attemptId: 'g|1:1>2|0@1', stepKey: 'g|1:1>2|0', goalId: 'g', transition: { kind: 'improve', equipmentId: 1, fromStar: 1, toStar: 2 }, scheduledDate: '2026-10-20' });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [fixed, future], settings: { weekdayLimits: [1, 1, 1, 1, 1, 1, 1] } }));
    expect(plan.placements.find((p) => p.attemptId === fixed.attemptId)!.date).toBe('2026-10-14');
    expect(plan.placements.find((p) => p.attemptId === future.attemptId)!.date).toBe('2026-10-15');
    expect(plan.attemptChanges.update.find((u) => u.attemptId === future.attemptId)?.scheduledDate).toBe('2026-10-15');
    expect(plan.attemptChanges.create).toEqual([]);
  });
});

describe('確実化と完了予定（design/17）', () => {
  it('P35：★6になる改修から確実化なら ★4→5 は通常、★5→6 は確実化', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 6, count: 1, guarantee: { mode: 'fromTargetStar', fromStar: 6 } });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 4, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g] }));
    const modes = Object.fromEntries(plan.steps.map((s) => [s.transitionKey, s.mode]));
    expect(modes).toEqual({ '1:4>5': 'normal', '1:5>6': 'guaranteed' });
  });

  it('P36：更新を確実化する指定は更新後★0でも確実化のまま', () => {
    const g = goal({ goalId: 'g', equipmentId: FX.gunUpgraded, targetStar: 0, count: 1, routeKey: `${FX.gunBase}>${FX.gunUpgraded}`, updateGuarantee: true });
    const plan = buildPlan(planInput({ inventory: { equipment: [[FX.gunBase, 10, 1]], ships: [FX.shipAKai2], resources: { 8: 99, 7: 99 }, items: { [FX.itemB]: 5 } }, goals: [g] }));
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.transition.kind).toBe('convert');
    expect(plan.steps[0]?.mode).toBe('guaranteed');
  });

  it('P37：1工程でも未配置なら目標の完了予定日は未定', () => {
    const m = simpleMaster();
    m.recipes.push({ equipmentId: 3, entries: [{ entryIndex: 0, helpers: [], convert: null, cost: { fuel: 0, ammo: 0, steel: 0, bauxite: 0, p1: stage(), p2: stage(), conv: null, extra: [] } }] });
    const g1 = goal({ goalId: 'ok', equipmentId: 1, targetStar: 1, count: 1 });
    const g2 = goal({ goalId: 'ng', equipmentId: 3, targetStar: 1, count: 1 });
    const plan = buildPlan(planInput({ master: m, inventory: { equipment: [[1, 0, 1], [3, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g1, g2] }));
    expect(plan.goals.find((g) => g.goalId === 'ok')!.completionDate).toBe('2026-10-14');
    expect(plan.goals.find((g) => g.goalId === 'ng')!.completionDate).toBeNull();
    expect(plan.goals.find((g) => g.goalId === 'ng')!.status).toBe('undetermined');
  });

  it('所持だけで達成した目標は「所持で達成」で予定日を付けない', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 5, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 7, 1]], ships: [101] }, goals: [g] }));
    expect(plan.goals[0]?.status).toBe('achieved');
    expect(plan.goals[0]?.completionDate).toBeNull();
  });

  it('完全一致の目標は★が高い装備を完成品に数えない', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 5, count: 1, matchMode: 'exact' });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 7, 1]], ships: [101] }, goals: [g] }));
    expect(plan.goals[0]?.completed).toBe(0);
    expect(plan.goals[0]?.missingUnits).toBe(1);
  });
});

describe('レビュー指摘（PR #1）', () => {
  const draftOf = (attemptId: string, stepKey: string, reportedOutcome: 'success' | 'failure', knownConsumptions: DraftResult['knownConsumptions']): DraftResult => ({ draftId: `d-${attemptId}`, attemptId, stepKey, occurredDateJst: '2026-10-13', occurredOrder: 1, reportedOutcome, knownConsumptions, unknownScopes: [], scopeAnswers: {}, createdRevision: 1, updatedRevision: 1, createdAt: '', status: 'open', cancelReason: null, recipeSnapshot: null });

  it('目標ごとの使える数は、優先度の高い目標が使った後の残り（同じ在庫を複数の目標に使えると見せない）', () => {
    // ネジ 10。ネジ 6 を使う目標が2つ（優先度 h → g）
    const h = goal({ goalId: 'h', equipmentId: 1, targetStar: 1, count: 1, priority: 1 });
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1, priority: 2 });
    const plan = buildPlan(planInput({ master: simpleMaster({ screws: 6 }), inventory: { equipment: [[1, 0, 2]], ships: [101], resources: { 8: 10, 7: 99 } }, goals: [h, g], settings: { weekdayLimits: [2, 2, 2, 2, 2, 2, 2] } }));
    const screwsOf = (id: string) => plan.goals.find((x) => x.goalId === id)!.availability.find((s) => s.key === 'resource:8');
    expect(screwsOf('h')).toEqual({ key: 'resource:8', available: 10, planned: 0 });
    expect(screwsOf('g')).toEqual({ key: 'resource:8', available: 4, planned: 0 });
    expect(plan.goals.find((x) => x.goalId === 'g')!.shortages).toEqual([{ key: 'resource:8', amount: 2 }]);
  });

  it('装備の消費が不明な確認待ちの下書きがある間は、目標の達成や完了予定を断定しない', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const other = attempt({ attemptId: 'o|9:0>1|0@1', stepKey: 'o|9:0>1|0', goalId: 'o', transition: { kind: 'improve', equipmentId: 9, fromStar: 0, toStar: 1 }, scheduledDate: '2026-10-13', outcome: 'draft' });
    const draft = { ...draftOf(other.attemptId, other.stepKey, 'failure', []), unknownScopes: ['equipment' as const] };
    const spec = { master: simpleMaster(), inventory: { equipment: [[1, 1, 1]] as [number, number, number][], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [other] };
    expect(buildPlan(planInput(spec)).goals[0]?.status).toBe('achieved');
    const pending = buildPlan(planInput({ ...spec, drafts: [draft] })).goals[0]!;
    expect(pending.status).toBe('undetermined');
    expect(pending.reasons).toContain('RESULT_PENDING');
  });

  it('確認待ちの下書きが確保した素材装備は、計画で別の工程に割り当てない', () => {
    // Y★0 を2個所持。別の改修の下書きが Y★0 を2個確保済み。X★0→★1 は Y を2個使う
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const other = attempt({ attemptId: 'o|9:0>1|0@1', stepKey: 'o|9:0>1|0', goalId: 'o', transition: { kind: 'improve', equipmentId: 9, fromStar: 0, toStar: 1 }, scheduledDate: '2026-10-13', outcome: 'draft' });
    const draft = draftOf(other.attemptId, other.stepKey, 'failure', [{ scope: 'equipment', equipmentId: 2, star: 0, amount: -2 }]);
    const plan = buildPlan(planInput({ master: simpleMaster({ fodder: 2 }), inventory: { equipment: [[1, 0, 1], [2, 0, 2]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [other], drafts: [draft] }));
    const p = plan.placements.find((x) => x.goalId === 'g')!;
    expect(p.shortages.find((s) => s.key === 'equipment:2')?.deficit).toBe(2);
  });

  it('成功と報告した下書きの改修対象は、その目標の工程として残し、他の目標や素材に使わない', () => {
    // X★0 を1個所持。目標 g の X★0→★1 を成功と報告して確認待ち。優先度の高い目標 h も X★1 を目指す
    const t01 = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1, priority: 2 });
    const h = goal({ goalId: 'h', equipmentId: 1, targetStar: 1, count: 1, priority: 1 });
    const pending = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', outcome: 'draft' });
    const draft = draftOf(pending.attemptId, pending.stepKey, 'success', [{ scope: 'equipment', equipmentId: 1, star: 0, amount: -1 }]);
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [h, g], attempts: [pending], drafts: [draft] }));
    expect(plan.steps.find((s) => s.stepKey === pending.stepKey)?.blockers).toContain('RESULT_PENDING');
    expect(plan.steps.filter((s) => s.goalId === 'h')).toEqual([]);
    expect(plan.unplaced.find((p) => p.goalId === 'h')?.reasons).toEqual(['TARGET_MISSING']);
  });

  it('工程数が計算の上限に達したら、それ以上の改修対象の工程を展開せず、残りを計算上限として未配置にする', () => {
    // ★0 を 1,100 個所持し ★10 を 1,100 個目指す（10 工程 × 1,100 = 11,000 工程 > 上限 10,000）
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 10, count: 1100 });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1100]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], settings: { searchDays: 7 } }));
    expect(plan.computationLimited).toBe(true);
    expect(plan.steps.length).toBeLessThanOrEqual(COMPUTATION_LIMITS.maxSteps + 10);
    const limited = plan.unplaced.filter((p) => p.goalId === 'g' && p.reasons.includes('COMPUTATION_LIMIT'));
    expect(limited.length).toBeGreaterThan(0);
    expect(plan.goals.find((x) => x.goalId === 'g')?.status).toBe('undetermined');
  });

  it('素材の製作でも工程数が計算の上限に達したら、それ以上の製作の鎖を作らず計算上限として示す', () => {
    // X★0→★10 の各段階で Y を 100 個使い、Y は Z★0→★MAX→Y で製作（11 工程）。製作 1,000 個 = 11,000 工程 > 上限
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 10, count: 1, materialRoutes: { '2': { kind: 'craft', routeKey: '3>2' } } });
    const plan = buildPlan(planInput({ master: simpleMaster({ fodder: 100, craft: true }), inventory: { equipment: [[1, 0, 1], [3, 0, 1000]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], settings: { searchDays: 7 } }));
    expect(plan.computationLimited).toBe(true);
    expect(plan.steps.length).toBeLessThanOrEqual(COMPUTATION_LIMITS.maxSteps + 11);
    expect(plan.unplaced.some((p) => p.goalId === 'g' && p.reasons.includes('COMPUTATION_LIMIT'))).toBe(true);
    expect(plan.goals.find((x) => x.goalId === 'g')?.status).toBe('undetermined');
  });

  it('取り消された再挑戦の後ろでも、元の失敗が工程の番号を保ち続ける（同じ工程を別のキーで作り直さない）', () => {
    const t01 = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    // 失敗 → 再挑戦 → 元を成功へ訂正（再挑戦は取消）→ 元を失敗へ戻した状態
    const failed = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-13', outcome: 'failure' });
    const cancelledRetry = attempt({ attemptId: 'g|1:0>1|0@2', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-13', outcome: 'none', lifecycle: 'cancelled' });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [failed, cancelledRetry] }));
    expect(plan.steps.map((s) => s.stepKey)).toEqual(['g|1:0>1|0']);
    expect(plan.placements.find((p) => p.stepKey === 'g|1:0>1|0')?.attemptId).toBe('g|1:0>1|0@3');
  });

  it('失敗の翌日送りは実施日で判断する（今日の予定を昨日失敗したと記録したら、今日から再挑戦できる）', () => {
    const t01 = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const failed = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', outcome: 'failure', resultEventId: 'e1' });
    const ev = (date: string): ResultEvent => ({ eventId: 'e1', attemptId: failed.attemptId, stepKey: failed.stepKey, goalId: 'g', originalSequence: 1, revision: 1, status: 'active', outcome: 'failure', occurredDateJst: date, occurredOrder: 1, recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] });
    const spec = { master: simpleMaster(), inventory: { equipment: [[1, 0, 1]] as [number, number, number][], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [failed] };
    expect(buildPlan(planInput({ ...spec, events: [ev('2026-10-13')] })).placements.find((p) => p.stepKey === failed.stepKey)?.date).toBe('2026-10-14');
    expect(buildPlan(planInput({ ...spec, events: [ev('2026-10-14')] })).placements.find((p) => p.stepKey === failed.stepKey)?.date).toBe('2026-10-15');
  });

  it('今日の実施枠は、結果の実施日で数える（繰越元を今日実施した記録は今日の枠を使い、別の日に記録した今日の予定は使わない）', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const ev = (id: string, attemptId: string, date: string): ResultEvent => ({ eventId: id, attemptId, stepKey: 'o', goalId: 'o', originalSequence: 1, revision: 1, status: 'active', outcome: 'failure', occurredDateJst: date, occurredOrder: 1, recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] });
    const spec = { master: simpleMaster(), inventory: { equipment: [[1, 0, 1]] as [number, number, number][], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], settings: { weekdayLimits: [1, 1, 1, 1, 1, 1, 1] } };
    // 昨日の予定（繰越元）を今日実施したと記録 → 今日の1枠を使う
    const late = attempt({ attemptId: 'o|9:0>1|0@1', stepKey: 'o|9:0>1|0', goalId: 'o', transition: { kind: 'improve', equipmentId: 9, fromStar: 0, toStar: 1 }, scheduledDate: '2026-10-13', outcome: 'failure', lifecycle: 'superseded', resultEventId: 'e1' });
    const lateToday = buildPlan(planInput({ ...spec, attempts: [late], events: [ev('e1', late.attemptId, '2026-10-14')] }));
    expect(lateToday.placements.find((p) => p.goalId === 'g')?.date).toBe('2026-10-15');
    // 今日の予定を昨日実施したと記録 → 今日の枠は空く
    const back = { ...late, scheduledDate: '2026-10-14', lifecycle: 'active' as const };
    const backdated = buildPlan(planInput({ ...spec, attempts: [back], events: [ev('e1', back.attemptId, '2026-10-13')] }));
    expect(backdated.placements.find((p) => p.goalId === 'g')?.date).toBe('2026-10-14');
  });

  it('今日に固定した予定は、今日を休みにした・今日の上限を0にした場合も確認待ちにする（日付が変わるまで当日に残す）', () => {
    const t = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const fixedToday = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t, scheduledDate: '2026-10-14', helperShipId: 101 });
    const spec = { master: simpleMaster(), inventory: { equipment: [[1, 0, 1]] as [number, number, number][], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [fixedToday] };
    const gate = (settings: Parameters<typeof planInput>[0]['settings']) => buildPlan(planInput({ ...spec, settings })).placements.find((p) => p.attemptId === fixedToday.attemptId);
    expect(gate({})?.executionGate).toBe('ready');
    const holiday = gate({ holidays: [{ holidayId: 'h', start: '2026-10-14', end: '2026-10-14' }] });
    expect([holiday?.date, holiday?.executionGate]).toEqual(['2026-10-14', 'reviewRequired']);
    expect(gate({ weekdayLimits: [2, 2, 2, 0, 2, 2, 2] })?.executionGate).toBe('reviewRequired'); // 水曜を0
  });

  it('今日に固定した予定でも、担当艦が今日の曜日に担当できなくなったら確認待ちにする', () => {
    // 2026-10-14 は水曜。担当艦 H改二 は月・金だけ（マスター更新で曜日が変わった、または他曜日の担当艦を選んだ）
    const t = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const fixedToday = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t, scheduledDate: '2026-10-14', helperShipId: 101 });
    const plan = buildPlan(planInput({ master: simpleMaster({ days: [1, 5] }), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [fixedToday] }));
    expect(plan.placements.find((p) => p.attemptId === fixedToday.attemptId)?.executionGate).toBe('reviewRequired');
    // 曜日が合えば実行できる
    const ok = buildPlan(planInput({ master: simpleMaster({ days: [3] }), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [fixedToday] }));
    expect(ok.placements.find((p) => p.attemptId === fixedToday.attemptId)?.executionGate).toBe('ready');
  });

  it('担当艦で素材が変わる改修は、素材計画に使ったエントリの担当艦だけで配置する（素材計画と予定を食い違わせない）', () => {
    const m = simpleMaster();
    m.ships.push({ id: 102, name: 'K', yomi: '', shipTypeId: 2, afterShipId: null, afterLevel: null, familyId: 102, sortNo: 3 });
    const zero = { fuel: 0, ammo: 0, steel: 0, bauxite: 0, conv: null, extra: [] };
    const useY = stage({ screws: 1, screwsGuaranteed: 1, equipment: [{ equipmentId: 2, count: 1 }] });
    const useZ = stage({ screws: 1, screwsGuaranteed: 1, equipment: [{ equipmentId: 3, count: 1 }] });
    // エントリ0：H改二（月曜のみ）で素材Y、エントリ1：K（毎日）で素材Z
    m.recipes = [
      {
        equipmentId: 1,
        entries: [
          { entryIndex: 0, helpers: [{ shipIds: [101], days: [1] }], convert: null, cost: { ...zero, p1: useY, p2: useY } },
          { entryIndex: 1, helpers: [{ shipIds: [102], days: ALL }], convert: null, cost: { ...zero, p1: useZ, p2: useZ } },
        ],
      },
    ];
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const plan = buildPlan(planInput({ master: m, inventory: { equipment: [[1, 0, 1], [2, 0, 1]], ships: [101, 102], resources: { 8: 99, 7: 99 } }, goals: [g] }));
    const p = plan.placements.find((x) => x.stepKey.startsWith('g|'))!;
    expect(p.entryIndex).toBe(0);
    expect(p.date).toBe('2026-10-19'); // 次の月曜
    expect(p.tentative).toBe(false);
    expect(plan.totals.find((t) => t.key === 'equipment:3')).toBeUndefined();
  });

  it('繰越後に元の試行を確認待ちで保存したら、同じ工程の後継は実行できない（結果確認待ち）', () => {
    const t01 = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const original = attempt({ attemptId: 'g|1:0>1|0@1', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-13', outcome: 'draft', lifecycle: 'superseded' });
    const successor = attempt({ attemptId: 'g|1:0>1|0@2', stepKey: 'g|1:0>1|0', goalId: 'g', transition: t01, scheduledDate: '2026-10-14', predecessorAttemptId: original.attemptId });
    const draft = { draftId: 'd1', attemptId: original.attemptId, stepKey: original.stepKey, occurredDateJst: '2026-10-13', occurredOrder: 1, reportedOutcome: 'success' as const, knownConsumptions: [], unknownScopes: [], scopeAnswers: {}, createdRevision: 1, updatedRevision: 1, createdAt: '', status: 'open' as const, cancelReason: null, recipeSnapshot: null };
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [g], attempts: [original, successor], drafts: [draft] }));
    expect(plan.steps.find((s) => s.stepKey === original.stepKey)?.blockers).toContain('RESULT_PENDING');
    const kept = plan.placements.find((p) => p.attemptId === successor.attemptId);
    expect(kept?.executionGate).not.toBe('ready');
    expect(plan.attemptChanges.update.find((u) => u.attemptId === successor.attemptId)?.executionGate).toBe('reviewRequired');
  });

  it('更新経路で「この装備だけを改修」を明示した目標は、対象がなければ経路未選択ではなく対象不足', () => {
    const m = simpleMaster({ craft: true }); // Z ★MAX → Y の更新経路がある
    const explicit = goal({ goalId: 'e', equipmentId: 2, targetStar: 1, count: 1, routeKey: '2' });
    const undecided = goal({ goalId: 'u', equipmentId: 2, targetStar: 1, count: 1, routeKey: null });
    const plan = buildPlan(planInput({ master: m, inventory: { equipment: [], ships: [101], resources: { 8: 99, 7: 99 } }, goals: [explicit, undecided] }));
    expect(plan.unplaced.find((p) => p.goalId === 'e')?.reasons).toEqual(['TARGET_MISSING']);
    expect(plan.unplaced.find((p) => p.goalId === 'u')?.reasons).toEqual(['ROUTE_REQUIRED']);
  });
});

describe('不明と0の区別', () => {
  it('所持数が未取得の資材は不足を0と表示せず不明', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { equipment: [[1, 0, 1]], ships: [101], resources: { 7: 99 } }, goals: [g] }));
    const screws = plan.totals.find((t) => t.key === 'resource:8')!;
    expect(screws.available).toBeNull();
    expect(screws.shortage).toBeNull();
    expect(plan.placements[0]?.tentative).toBe(true);
    expect(plan.placements[0]?.shortages.find((s) => s.key === 'resource:8')?.deficit).toBeNull();
  });

  it('装備が未取得なら工程を作らず理由を返す', () => {
    const g = goal({ goalId: 'g', equipmentId: 1, targetStar: 1, count: 1 });
    const plan = buildPlan(planInput({ master: simpleMaster(), inventory: { ships: [101] }, goals: [g] }));
    expect(plan.goals[0]?.reasons).toContain('EQUIPMENT_UNKNOWN');
    expect(plan.steps).toEqual([]);
  });
});

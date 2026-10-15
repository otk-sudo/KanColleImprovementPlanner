import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/model';
import type { Placement, PlanResult } from '../../domain/planning/types';
import type { AppData } from '../../infrastructure/repository';
import { attempt } from '../../test-support/planFixtures';
import { buildDays, dayRequirements, entryCost, latestAttemptOf, monthCellSummary, type DayEntry } from './calendarModel';
import { buildMasterIndex } from '../../domain/master';
import { fixtureMaster } from '../../test-support/fixtureMaster';

const t = (from: number) => ({ kind: 'improve' as const, equipmentId: 1, fromStar: from, toStar: from + 1 });

function data(attempts: AppData['attempts']): AppData {
  return {
    meta: { revision: 1 } as AppData['meta'],
    baselines: [],
    resultEvents: [],
    drafts: [],
    attempts,
    goals: [],
    protections: [],
    settings: { ...DEFAULT_SETTINGS, weekdayLimits: [3, 3, 3, 3, 3, 3, 3] },
    preferredHelpers: [],
    daySkips: [],
  };
}

function placement(attemptId: string, stepKey: string, date: string, dayOrder: number): Placement {
  return { attemptId, stepKey, goalId: 'g', date, dayOrder, persisted: true, provisional: false, tentative: false, predecessorTentative: false, executionGate: 'ready' } as Placement;
}

describe('カレンダーの件数（design/17）', () => {
  it('P38：今日成功1・失敗1・予定1と繰越元1なら、実施2・予定1。繰越元を二重に数えない', () => {
    const success = attempt({ attemptId: 'a@1', stepKey: 'a', goalId: 'g', transition: t(0), scheduledDate: '2026-10-14', outcome: 'success', dayOrder: 1 });
    const failure = attempt({ attemptId: 'c@1', stepKey: 'c', goalId: 'g', transition: t(3), scheduledDate: '2026-10-14', outcome: 'failure', dayOrder: 2 });
    const source = attempt({ attemptId: 'b@1', stepKey: 'b', goalId: 'g', transition: t(1), scheduledDate: '2026-10-13', outcome: 'none', lifecycle: 'superseded' });
    const successor = attempt({ attemptId: 'b@2', stepKey: 'b', goalId: 'g', transition: t(1), scheduledDate: '2026-10-14', dayOrder: 3, predecessorAttemptId: null });
    const plan = { placements: [placement('b@2', 'b', '2026-10-14', 3)], steps: [], goals: [] } as unknown as PlanResult;
    const days = buildDays(data([success, failure, source, successor]), plan, '2026-10-13', '2026-10-14', '2026-10-14');
    const today = days.get('2026-10-14')!;
    expect(today.doneCount).toBe(2);
    expect(today.plannedCount).toBe(1);
    expect(today.entries.map((e) => e.kind)).toEqual(['success', 'failure', 'planned']);
    // 繰越元の日は「繰り越し」として表示し、予定にも実施にも数えない
    const yesterday = days.get('2026-10-13')!;
    expect(yesterday.entries.map((e) => e.kind)).toEqual(['superseded']);
    expect(yesterday.plannedCount + yesterday.doneCount).toBe(0);
  });

  it('スキップは実施にも予定にも数えず、スキップ件数として分ける', () => {
    const skipped = attempt({ attemptId: 'a@1', stepKey: 'a', goalId: 'g', transition: t(0), scheduledDate: '2026-10-14', outcome: 'skip' });
    const days = buildDays(data([skipped]), null, '2026-10-14', '2026-10-14', '2026-10-14');
    const today = days.get('2026-10-14')!;
    expect([today.doneCount, today.plannedCount, today.skipCount]).toEqual([0, 0, 1]);
  });
});

describe('前提工程の最新の試行（S30）', () => {
  it('試行が10回以上でも番号の数値で最新を選ぶ（@9 より @10 が新しい）', () => {
    const list = [1, 2, 9, 10].map((n) => attempt({ attemptId: `s@${n}`, stepKey: 's', goalId: 'g', transition: t(0), outcome: n === 10 ? 'success' : 'failure' }));
    expect(latestAttemptOf(list, 's')?.attemptId).toBe('s@10');
    expect(latestAttemptOf(list, 'other')).toBeUndefined();
  });
});

describe('日別の必要量と見込み在庫（S18）', () => {
  const zero = { normal: 0, guaranteed: 0 };
  const cost = (equipment: { equipmentId: number; count: number }[]) => ({ fuel: 0, ammo: 0, steel: 0, bauxite: 0, devmats: zero, screws: zero, equipment, useItems: [] });
  const placement = (stepKey: string, date: string, equipment: { equipmentId: number; count: number }[]) => ({ stepKey, date, dayOrder: 1, mode: 'normal', cost: cost(equipment) }) as unknown as Placement;
  const step = (stepKey: string, role: 'target' | 'craft', craftFor: number | null, transition: unknown) => ({ stepKey, role, craftFor, transition }) as unknown as PlanResult['steps'][number];

  it('後日に製作する素材は、その日の見込み在庫に数えない', () => {
    // Y（ID 2）は 10/15 の製作で1個できる。10/14 の別の改修が Y を1個使う
    const plan = {
      placements: [placement('craft', '2026-10-15', []), placement('use', '2026-10-14', [{ equipmentId: 2, count: 1 }])],
      steps: [step('craft', 'craft', 2, { kind: 'convert', equipmentId: 3, toEquipmentId: 2, toStar: 0 }), step('use', 'target', null, t(0))],
      totals: [{ key: 'equipment:2', need: 1, available: 0, planned: 1, shortage: 0, held: 0 }],
    } as unknown as PlanResult;
    expect(dayRequirements(plan, '2026-10-14')).toEqual([{ key: 'equipment:2', need: 1, available: 0 }]);
    // 製作が同じ日以前なら数える
    const sameDay = { ...plan, placements: [placement('craft', '2026-10-14', []), placement('use', '2026-10-14', [{ equipmentId: 2, count: 1 }])] } as PlanResult;
    expect(dayRequirements(sameDay, '2026-10-14')).toEqual([{ key: 'equipment:2', need: 1, available: 1 }]);
  });
});

describe('月表示のセルの集計（S01）', () => {
  const entry = (kind: DayEntry['kind'], transition: DayEntry['transition'] = t(0)): DayEntry => ({ kind, attemptId: null, stepKey: 's', goalId: 'g', transition, placement: null, attempt: null, event: null, order: 1 });
  const conv = { kind: 'convert' as const, equipmentId: 1, toEquipmentId: 2, toStar: 0 };

  it('失敗・スキップ・確認待ちは実施回数に数えるが、★の進みや更新には数えない', () => {
    expect(monthCellSummary([entry('failure')])).toBe('1回');
    expect(monthCellSummary([entry('skip'), entry('review'), entry('draft')])).toBe('3回');
    expect(monthCellSummary([entry('success'), entry('failure')])).toBe('2回 / ★+1');
  });

  it('予定（仮配置・前提待ちを含む）と成功は進みとして数え、繰り越した試行は数えない', () => {
    expect(monthCellSummary([entry('planned'), entry('tentative'), entry('pending'), entry('superseded')])).toBe('3回 / ★+3');
    expect(monthCellSummary([entry('planned'), entry('success', conv)])).toBe('2回 / ★+1・更新1');
    expect(monthCellSummary([entry('provisional', conv)])).toBe('1回 / 更新1');
  });
});

describe('記録済みの結果の費用（S02・S18）', () => {
  it('記録時のレシピの費用で表示し、現在のマスターの変更に左右されない', () => {
    const m = buildMasterIndex(fixtureMaster());
    const plannedCost = { fuel: 1, ammo: 2, steel: 3, bauxite: 4, devmats: 5, screws: 6, equipment: [{ equipmentId: 2, count: 1 }], useItems: [] };
    // 現在のマスターに改修データがない装備（ID 999）でも、保存した費用を表示する
    const event = { recipeSnapshot: { masterVersion: 'old', transition: t(0), fromName: '', toName: '', mode: 'guaranteed', entryIndex: 3, plannedCost, helperShipId: null, helperShipName: null } } as unknown as DayEntry['event'];
    const e: DayEntry = { kind: 'success', attemptId: 'a', stepKey: 's', goalId: 'g', transition: { kind: 'improve', equipmentId: 999, fromStar: 0, toStar: 1 }, placement: null, attempt: null, event, order: 1 };
    const cost = entryCost(m, e)!;
    expect([cost.fuel, cost.devmats.normal, cost.devmats.guaranteed, cost.screws.guaranteed, cost.equipment]).toEqual([1, 5, 5, 6, [{ equipmentId: 2, count: 1 }]]);
  });
});

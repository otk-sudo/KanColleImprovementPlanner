import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/model';
import type { Placement, PlanResult } from '../../domain/planning/types';
import type { AppData } from '../../infrastructure/repository';
import { attempt } from '../../test-support/planFixtures';
import { buildDays } from './calendarModel';

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

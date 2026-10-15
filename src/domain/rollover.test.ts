import { describe, expect, it } from 'vitest';
import { attempt } from '../test-support/planFixtures';
import { computeRollover } from './rollover';

const t = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };

describe('日本時間の翌日処理', () => {
  it('今日より前の未実施・スキップだけを後継へ引き継ぐ。成功・失敗・下書き・取消は対象外', () => {
    const attempts = [
      attempt({ attemptId: 'a|1@1', stepKey: 'a|1', goalId: 'g', transition: t, scheduledDate: '2026-10-13', outcome: 'none' }),
      attempt({ attemptId: 'b|1@1', stepKey: 'b|1', goalId: 'g', transition: t, scheduledDate: '2026-10-13', outcome: 'skip' }),
      attempt({ attemptId: 'c|1@1', stepKey: 'c|1', goalId: 'g', transition: t, scheduledDate: '2026-10-13', outcome: 'success' }),
      attempt({ attemptId: 'd|1@1', stepKey: 'd|1', goalId: 'g', transition: t, scheduledDate: '2026-10-13', outcome: 'draft' }),
      attempt({ attemptId: 'e|1@1', stepKey: 'e|1', goalId: 'g', transition: t, scheduledDate: '2026-10-13', outcome: 'none', lifecycle: 'cancelled' }),
      attempt({ attemptId: 'f|1@1', stepKey: 'f|1', goalId: 'g', transition: t, scheduledDate: '2026-10-14', outcome: 'none' }),
      attempt({ attemptId: 'g|1@1', stepKey: 'g|1', goalId: 'g', transition: t, scheduledDate: null, outcome: 'none' }),
    ];
    const r = computeRollover(attempts, '2026-10-14');
    expect(r.superseded.map((a) => a.attemptId)).toEqual(['a|1@1', 'b|1@1']);
    expect(r.successors.map((a) => [a.attemptId, a.predecessorAttemptId, a.scheduledDate, a.outcome])).toEqual([
      ['a|1@2', 'a|1@1', null, 'none'],
      ['b|1@2', 'b|1@1', null, 'none'],
    ]);
  });

  it('取り消した試行の後ろで未実施に戻った試行も、最新の試行として引き継ぐ', () => {
    const attempts = [
      attempt({ attemptId: 'a|1@1', stepKey: 'a|1', goalId: 'g', transition: t, scheduledDate: '2026-10-13', outcome: 'none' }),
      attempt({ attemptId: 'a|1@2', stepKey: 'a|1', goalId: 'g', transition: t, scheduledDate: '2026-10-13', outcome: 'none', lifecycle: 'cancelled' }),
    ];
    const r = computeRollover(attempts, '2026-10-14');
    expect(r.superseded.map((a) => a.attemptId)).toEqual(['a|1@1']);
    expect(r.successors.map((a) => a.attemptId)).toEqual(['a|1@3']);
  });

  it('削除した目標の試行（スキップの結果を含む）は引き継がない', () => {
    const attempts = [
      attempt({ attemptId: 'a|1@1', stepKey: 'a|1', goalId: 'deleted', transition: t, scheduledDate: '2026-10-13', outcome: 'skip' }),
      attempt({ attemptId: 'b|1@1', stepKey: 'b|1', goalId: 'g', transition: t, scheduledDate: '2026-10-13', outcome: 'skip' }),
    ];
    const r = computeRollover(attempts, '2026-10-14', '', new Set(['g']));
    expect(r.superseded.map((a) => a.attemptId)).toEqual(['b|1@1']);
    expect(r.fromDates).toEqual([{ date: '2026-10-13', count: 1 }]);
  });

  it('P10：何日閉じていても今日から一度だけ。既に後継があれば重複作成しない', () => {
    const first = computeRollover([attempt({ attemptId: 'a|1@1', stepKey: 'a|1', goalId: 'g', transition: t, scheduledDate: '2026-10-10' })], '2026-10-14');
    expect(first.successors).toHaveLength(1);
    const after = [
      { ...attempt({ attemptId: 'a|1@1', stepKey: 'a|1', goalId: 'g', transition: t, scheduledDate: '2026-10-10' }), lifecycle: 'superseded' as const },
      ...first.successors,
    ];
    expect(computeRollover(after, '2026-10-14').successors).toEqual([]);
  });

  it('移動元の日付ごとの件数を返す', () => {
    const r = computeRollover(
      [
        attempt({ attemptId: 'a|1@1', stepKey: 'a|1', goalId: 'g', transition: t, scheduledDate: '2026-10-09' }),
        attempt({ attemptId: 'b|1@1', stepKey: 'b|1', goalId: 'g', transition: t, scheduledDate: '2026-10-09' }),
        attempt({ attemptId: 'c|1@1', stepKey: 'c|1', goalId: 'g', transition: t, scheduledDate: '2026-10-12' }),
      ],
      '2026-10-14',
    );
    expect(r.fromDates).toEqual([
      { date: '2026-10-09', count: 2 },
      { date: '2026-10-12', count: 1 },
    ]);
  });
});

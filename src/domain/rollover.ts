import { compareDate, type DateJst } from './jst';
import type { Attempt } from './model';

// 日本時間で翌日になった時点の処理（design/10・12）。
// 今日より前の未実施・スキップのうち、有効な後継がないものだけを一度だけ引き継ぐ。
// 閉じていた各日に架空の試行は作らない。配置は計画の再計算で今日以降に行う。

export interface RolloverResult {
  superseded: Attempt[];
  successors: Attempt[];
  fromDates: { date: DateJst; count: number }[];
}

function seqOf(a: Attempt): number {
  return Number(a.attemptId.slice(a.attemptId.lastIndexOf('@') + 1)) || 0;
}

/** goalIds を渡すと、削除した目標の試行（当日のスキップの結果を含む）は引き継がない */
export function computeRollover(attempts: Attempt[], today: DateJst, nowIso = '', goalIds: ReadonlySet<string> | null = null): RolloverResult {
  const latestByStep = new Map<string, Attempt>();
  const countByStep = new Map<string, number>();
  for (const a of attempts) {
    countByStep.set(a.stepKey, Math.max(countByStep.get(a.stepKey) ?? 0, seqOf(a)));
    const cur = latestByStep.get(a.stepKey);
    if (!cur || seqOf(a) > seqOf(cur)) latestByStep.set(a.stepKey, a);
  }
  const superseded: Attempt[] = [];
  const successors: Attempt[] = [];
  const dates = new Map<DateJst, number>();
  const targets = attempts
    .filter((a) => a.scheduledDate !== null && compareDate(a.scheduledDate, today) < 0)
    .filter((a) => a.lifecycle === 'active' && (a.outcome === 'none' || a.outcome === 'skip'))
    .filter((a) => goalIds === null || goalIds.has(a.goalId))
    .filter((a) => latestByStep.get(a.stepKey)?.attemptId === a.attemptId)
    .sort((a, b) => compareDate(a.scheduledDate!, b.scheduledDate!) || a.dayOrder - b.dayOrder || a.attemptId.localeCompare(b.attemptId));
  for (const a of targets) {
    superseded.push({ ...a, lifecycle: 'superseded' });
    const n = (countByStep.get(a.stepKey) ?? seqOf(a)) + 1;
    countByStep.set(a.stepKey, n);
    successors.push({
      attemptId: `${a.stepKey}@${n}`,
      stepKey: a.stepKey,
      goalId: a.goalId,
      transition: a.transition,
      scheduledDate: null,
      dayOrder: 0,
      outcome: 'none',
      lifecycle: 'active',
      executionGate: 'ready',
      predecessorAttemptId: a.attemptId,
      createdAt: nowIso,
      helperShipId: null,
      mode: a.mode,
      resultEventId: null,
      cancelReason: null,
    });
    dates.set(a.scheduledDate!, (dates.get(a.scheduledDate!) ?? 0) + 1);
  }
  return {
    superseded,
    successors,
    fromDates: [...dates.entries()].sort((a, b) => compareDate(a[0], b[0])).map(([date, count]) => ({ date, count })),
  };
}

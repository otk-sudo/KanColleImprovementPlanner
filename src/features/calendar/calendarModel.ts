import { compareDate, type DateJst, weekdayOf } from '../../domain/jst';
import type { Transition } from '../../domain/master';
import type { Attempt, ResultEvent, Settings } from '../../domain/model';
import type { Placement, PlanResult } from '../../domain/planning/types';
import { holidaySet } from '../../domain/planning/schedule';
import type { AppData } from '../../infrastructure/repository';

// 日別・週別・月別を同じ投影から集計する（design/17「カレンダーの件数」）。

export type EntryKind = 'planned' | 'tentative' | 'provisional' | 'success' | 'failure' | 'skip' | 'draft' | 'superseded' | 'review' | 'pending';

export interface DayEntry {
  kind: EntryKind;
  attemptId: string | null;
  stepKey: string;
  goalId: string;
  transition: Transition;
  placement: Placement | null;
  attempt: Attempt | null;
  event: ResultEvent | null;
  order: number;
}

export interface DayInfo {
  date: DateJst;
  limit: number;
  holiday: boolean;
  daySkipped: boolean;
  entries: DayEntry[];
  /** 有効な未実施（予定・仮配置） */
  plannedCount: number;
  tentativeCount: number;
  /** 成功・失敗・実施済み下書き */
  doneCount: number;
  skipCount: number;
  goalsCompleting: string[];
}

function kindOfPlacement(p: Placement): EntryKind {
  if (p.executionGate === 'reviewRequired') return 'review';
  if (p.executionGate === 'predecessorPending') return 'pending';
  if (p.provisional) return 'provisional';
  return p.tentative || p.predecessorTentative ? 'tentative' : 'planned';
}

export function buildDays(data: AppData, plan: PlanResult | null, from: DateJst, to: DateJst, today: DateJst): Map<DateJst, DayInfo> {
  const days = new Map<DateJst, DayInfo>();
  const holidays = holidaySet(data.settings, from, to);
  const skips = new Set(data.daySkips.map((d) => d.date));
  const inRange = (d: DateJst | null): d is DateJst => d !== null && compareDate(d, from) >= 0 && compareDate(d, to) <= 0;
  const ensure = (d: DateJst): DayInfo => {
    let info = days.get(d);
    if (!info) {
      info = { date: d, limit: limitFor(data.settings, holidays, d), holiday: holidays.has(d), daySkipped: skips.has(d), entries: [], plannedCount: 0, tentativeCount: 0, doneCount: 0, skipCount: 0, goalsCompleting: [] };
      days.set(d, info);
    }
    return info;
  };
  const placementsByAttempt = new Map((plan?.placements ?? []).filter((p) => p.persisted).map((p) => [p.attemptId, p]));
  const eventsById = new Map(data.resultEvents.map((e) => [e.eventId, e]));
  // 保存済みの試行（過去・当日・繰越後継）
  for (const a of data.attempts) {
    if (!inRange(a.scheduledDate) || a.lifecycle === 'cancelled') continue;
    const info = ensure(a.scheduledDate);
    const event = a.resultEventId ? (eventsById.get(a.resultEventId) ?? null) : null;
    let kind: EntryKind;
    if (a.lifecycle === 'superseded') kind = 'superseded';
    else if (a.outcome === 'success' || a.outcome === 'failure' || a.outcome === 'skip' || a.outcome === 'draft') kind = a.outcome;
    else {
      const p = placementsByAttempt.get(a.attemptId);
      if (!p) continue; // 将来の後継で再配置されたものは計画側で表示
      if (p.date !== a.scheduledDate) continue;
      kind = kindOfPlacement(p);
    }
    info.entries.push({ kind, attemptId: a.attemptId, stepKey: a.stepKey, goalId: a.goalId, transition: a.transition, placement: placementsByAttempt.get(a.attemptId) ?? null, attempt: a, event, order: a.dayOrder });
  }
  // 計画上の未保存の配置（将来）
  for (const p of plan?.placements ?? []) {
    if (!inRange(p.date)) continue;
    if (p.persisted && data.attempts.some((a) => a.attemptId === p.attemptId && a.scheduledDate === p.date)) continue;
    const step = plan?.steps.find((s) => s.stepKey === p.stepKey);
    if (!step) continue;
    const info = ensure(p.date);
    info.entries.push({ kind: kindOfPlacement(p), attemptId: p.persisted ? p.attemptId : null, stepKey: p.stepKey, goalId: p.goalId, transition: step.transition, placement: p, attempt: null, event: null, order: p.dayOrder });
  }
  for (const info of days.values()) {
    info.entries.sort((a, b) => a.order - b.order || a.stepKey.localeCompare(b.stepKey));
    for (const e of info.entries) {
      if (e.kind === 'planned' || e.kind === 'tentative' || e.kind === 'provisional' || e.kind === 'pending' || e.kind === 'review') info.plannedCount++;
      if (e.kind === 'tentative') info.tentativeCount++;
      if (e.kind === 'success' || e.kind === 'failure' || e.kind === 'draft') info.doneCount++;
      if (e.kind === 'skip') info.skipCount++;
    }
  }
  for (const g of plan?.goals ?? []) {
    if (g.completionDate && inRange(g.completionDate) && compareDate(g.completionDate, today) >= 0) ensure(g.completionDate).goalsCompleting.push(g.goalId);
  }
  return days;
}

export function limitFor(settings: Settings, holidays: Set<DateJst>, date: DateJst): number {
  if (holidays.has(date)) return 0;
  return settings.weekdayLimits[weekdayOf(date)] ?? 0;
}

export function emptyDay(data: AppData, date: DateJst): DayInfo {
  const holidays = holidaySet(data.settings, date, date);
  return { date, limit: limitFor(data.settings, holidays, date), holiday: holidays.has(date), daySkipped: data.daySkips.some((d) => d.date === date), entries: [], plannedCount: 0, tentativeCount: 0, doneCount: 0, skipCount: 0, goalsCompleting: [] };
}

export const KIND_LABEL: Record<EntryKind, string> = {
  planned: '予定',
  tentative: '! 仮配置',
  provisional: '翌日以降に再配置',
  success: '✓ 完了',
  failure: '失敗',
  skip: 'スキップ',
  draft: '確認待ち',
  superseded: '繰り越し',
  review: '! 確認待ち',
  pending: '前提待ち',
};

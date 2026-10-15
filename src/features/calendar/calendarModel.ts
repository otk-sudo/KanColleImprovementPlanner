import { compareDate, type DateJst, weekdayOf } from '../../domain/jst';
import { transitionTo, type Transition } from '../../domain/master';
import type { Attempt, ResultEvent, Settings } from '../../domain/model';
import type { CostKey, Placement, PlanResult } from '../../domain/planning/types';
import { attemptSeq, costItems } from '../../domain/planning/plan';
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

/** 工程の最新の試行（番号の数値が最大のもの） */
export function latestAttemptOf(attempts: Attempt[], stepKey: string): Attempt | undefined {
  return attempts.filter((a) => a.stepKey === stepKey).sort((a, b) => attemptSeq(a) - attemptSeq(b)).at(-1);
}

/** その日の実施前の見込み在庫（前日までの予定消費と保護指定を考慮） */
export function dayRequirements(plan: PlanResult | null, date: DateJst): { key: CostKey; need: number; available: number | null }[] {
  if (!plan) return [];
  const before = new Map<CostKey, number>();
  const day = new Map<CostKey, number>();
  for (const p of plan.placements) {
    if (!p.date || !p.cost) continue;
    const cmp = compareDate(p.date, date);
    if (cmp > 0) continue;
    for (const c of costItems(p.cost, p.mode)) (cmp < 0 ? before : day).set(c.key, ((cmp < 0 ? before : day).get(c.key) ?? 0) + c.amount);
  }
  // 素材の製作品は、その日までに製作する分だけ見込み在庫に加える（後日の製作品を前倒しで数えない）
  const stepByKey = new Map(plan.steps.map((s) => [s.stepKey, s]));
  const produced = new Map<CostKey, number>();
  for (const p of plan.placements) {
    if (!p.date || compareDate(p.date, date) > 0) continue;
    const s = stepByKey.get(p.stepKey);
    if (!s || s.role !== 'craft' || s.craftFor === null || transitionTo(s.transition).equipmentId !== s.craftFor) continue;
    const key: CostKey = `equipment:${s.craftFor}`;
    produced.set(key, (produced.get(key) ?? 0) + 1);
  }
  const avail = new Map(plan.totals.map((t) => [t.key, t.available === null ? null : t.available + (produced.get(t.key) ?? 0)]));
  const rank = (k: CostKey) => (k === 'resource:8' ? 0 : k === 'resource:7' ? 1 : k.startsWith('equipment:') ? 2 : k.startsWith('item:') ? 3 : 4);
  return [...day.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([key, need]) => {
    const a = avail.get(key);
    return { key, need, available: a === null || a === undefined ? null : Math.max(0, a - (before.get(key) ?? 0)) };
  });
}

/** 装備が進む（または進む予定の）種類。失敗・スキップ・確認待ち・要確認は★を変えない */
const PROGRESS_KINDS: ReadonlySet<EntryKind> = new Set<EntryKind>(['success', 'planned', 'tentative', 'provisional', 'pending']);

/** 月表示のセルの「n回 / ★+k・更新m」。回数は繰り越した試行を除く全件、★と更新は進みのある件だけ */
export function monthCellSummary(entries: DayEntry[]): string {
  const visible = entries.filter((e) => e.kind !== 'superseded');
  const progress = visible.filter((e) => PROGRESS_KINDS.has(e.kind));
  const improves = progress.filter((e) => e.transition.kind === 'improve').length;
  const converts = progress.length - improves;
  const parts = [improves > 0 ? `★+${improves}` : '', converts > 0 ? `更新${converts}` : ''].filter((x) => x !== '');
  return parts.length > 0 ? `${visible.length}回 / ${parts.join('・')}` : `${visible.length}回`;
}

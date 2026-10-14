import { addDays, compareDate, type DateJst, weekdayOf } from '../jst';
import type { Settings } from '../model';
import { candidateForDay } from './helpers';
import type { HelperCandidate, UnplacedReason } from './types';

// 日程配置（design/09「日程の配置規則」）。今日から探索期間内を昇順に走査し、
// 実施可能で前提を満たす工程を、目標の優先順位 → 前提順 → 安定ID の順に空き枠へ置く。
// 資材不足は配置の判断に使わない（仮配置として後で警告する）。

export interface SchedStep {
  stepKey: string;
  goalRank: number;
  depth: number;
  predecessorKeys: string[];
  candidates: HelperCandidate[];
  blockers: UnplacedReason[];
  earliestDate: DateJst;
}

export interface FixedSlot {
  stepKey: string;
  date: DateJst;
  dayOrder: number;
  helperShipId: number | null;
}

export interface ScheduleInput {
  today: DateJst;
  steps: SchedStep[];
  fixed: FixedSlot[];
  /** 日付ごとの既に枠を使っている件数と最大の日内順 */
  occupied: Map<DateJst, { count: number; maxOrder: number }>;
  daySkips: Set<DateJst>;
  settings: Settings;
}

export interface ScheduledSlot {
  date: DateJst;
  dayOrder: number;
  helper: HelperCandidate | null;
  fixed: boolean;
}

export interface ScheduleOutput {
  placed: Map<string, ScheduledSlot>;
  unplaced: Map<string, UnplacedReason[]>;
}

export function holidaySet(settings: Settings, from: DateJst, to: DateJst): Set<DateJst> {
  const out = new Set<DateJst>();
  for (const h of settings.holidays) {
    let d = compareDate(h.start, from) < 0 ? from : h.start;
    const end = compareDate(h.end, to) > 0 ? to : h.end;
    while (compareDate(d, end) <= 0) {
      out.add(d);
      d = addDays(d, 1);
    }
  }
  return out;
}

export function dayLimit(settings: Settings, holidays: Set<DateJst>, date: DateJst): number {
  if (holidays.has(date)) return 0;
  return settings.weekdayLimits[weekdayOf(date)] ?? 0;
}

export function schedule(input: ScheduleInput): ScheduleOutput {
  const { today, settings } = input;
  const end = addDays(today, Math.max(1, settings.searchDays) - 1);
  const holidays = holidaySet(settings, today, end);
  const byKey = new Map(input.steps.map((s) => [s.stepKey, s]));
  const placed = new Map<string, ScheduledSlot>();
  const unplaced = new Map<string, UnplacedReason[]>();

  for (const f of input.fixed) {
    const step = byKey.get(f.stepKey);
    placed.set(f.stepKey, { date: f.date, dayOrder: f.dayOrder, helper: step?.candidates.find((c) => c.shipId === f.helperShipId) ?? null, fixed: true });
  }

  // 配置前に判明している理由を後続へ伝える
  const blockedReason = new Map<string, UnplacedReason[]>();
  const resolveBlocked = (key: string, seen: Set<string>): UnplacedReason[] => {
    if (blockedReason.has(key)) return blockedReason.get(key)!;
    const s = byKey.get(key);
    if (!s || seen.has(key)) return [];
    seen.add(key);
    let reasons: UnplacedReason[] = [...s.blockers];
    if (reasons.length === 0 && !placed.has(key)) {
      for (const p of s.predecessorKeys) {
        const pr = resolveBlocked(p, seen);
        if (pr.length > 0) {
          reasons = [pr.includes('RESULT_PENDING') ? 'RESULT_PENDING' : 'PREDECESSOR_BLOCKED'];
          break;
        }
      }
    }
    blockedReason.set(key, reasons);
    return reasons;
  };
  for (const s of input.steps) {
    if (placed.has(s.stepKey)) continue;
    const r = resolveBlocked(s.stepKey, new Set());
    if (r.length > 0) unplaced.set(s.stepKey, r);
  }

  let remaining = input.steps.filter((s) => !placed.has(s.stepKey) && !unplaced.has(s.stepKey));
  const orderOn = new Map<DateJst, number>();
  const countOn = new Map<DateJst, number>();
  for (const [d, o] of input.occupied) {
    orderOn.set(d, o.maxOrder);
    countOn.set(d, o.count);
  }
  for (const f of input.fixed) {
    orderOn.set(f.date, Math.max(orderOn.get(f.date) ?? 0, f.dayOrder));
  }

  const ready = (s: SchedStep, d: DateJst): boolean =>
    s.predecessorKeys.every((p) => {
      const slot = placed.get(p);
      return slot !== undefined && compareDate(slot.date, d) <= 0;
    });

  for (let d = today; compareDate(d, end) <= 0 && remaining.length > 0; d = addDays(d, 1)) {
    const limit = dayLimit(settings, holidays, d);
    if (limit <= 0 || input.daySkips.has(d)) continue;
    const weekday = weekdayOf(d);
    let used = countOn.get(d) ?? 0;
    while (used < limit) {
      let best: SchedStep | null = null;
      let bestHelper: HelperCandidate | null = null;
      for (const s of remaining) {
        if (compareDate(s.earliestDate, d) > 0) continue;
        if (!ready(s, d)) continue;
        const helper = candidateForDay(s.candidates, weekday);
        if (!helper) continue;
        if (!best || s.goalRank < best.goalRank || (s.goalRank === best.goalRank && (s.depth < best.depth || (s.depth === best.depth && s.stepKey < best.stepKey)))) {
          best = s;
          bestHelper = helper;
        }
      }
      if (!best) break;
      const order = (orderOn.get(d) ?? 0) + 1;
      orderOn.set(d, order);
      placed.set(best.stepKey, { date: d, dayOrder: order, helper: bestHelper, fixed: false });
      used++;
      countOn.set(d, used);
      const chosen = best;
      remaining = remaining.filter((s) => s !== chosen);
    }
  }

  // 置けなかった工程の理由：前提未配置 → 曜日が重ならない → 探索期間内に空きなし
  const reachable = (s: SchedStep): boolean => {
    for (let d = compareDate(s.earliestDate, today) > 0 ? s.earliestDate : today; compareDate(d, end) <= 0; d = addDays(d, 1)) {
      if (dayLimit(settings, holidays, d) <= 0 || input.daySkips.has(d)) continue;
      if (candidateForDay(s.candidates, weekdayOf(d))) return true;
    }
    return false;
  };
  const finalize = (s: SchedStep): UnplacedReason[] => {
    if (unplaced.has(s.stepKey)) return unplaced.get(s.stepKey)!;
    let reasons: UnplacedReason[];
    const predUnplaced = s.predecessorKeys.some((p) => !placed.has(p));
    if (predUnplaced) {
      const predReasons = s.predecessorKeys.flatMap((p) => (byKey.get(p) && !placed.has(p) ? finalize(byKey.get(p)!) : []));
      reasons = [predReasons.includes('RESULT_PENDING') ? 'RESULT_PENDING' : 'PREDECESSOR_BLOCKED'];
    } else if (!reachable(s)) reasons = ['NO_AVAILABLE_DAY'];
    else reasons = ['SEARCH_LIMIT'];
    unplaced.set(s.stepKey, reasons);
    return reasons;
  };
  for (const s of remaining) finalize(s);
  return { placed, unplaced };
}

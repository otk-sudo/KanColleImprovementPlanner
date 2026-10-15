import type { InventoryProjection } from '../inventory/projection';
import { bucketKey, type ScopeKey } from '../inventory/types';
import type { DateJst } from '../jst';
import { compareDate } from '../jst';
import { MAX_STAR } from '../ids';
import type { Transition } from '../master';
import type { Baseline, Delta, Outcome, ResultEvent } from '../model';

// 実績の増減・基準境界・訂正の依存検査（design/06・10・12・18）。

export interface ConsumptionInput {
  /** 資材ID → 実消費 */
  resources: Record<number, number>;
  /** 素材として消費した装備（★ごと） */
  equipment: { equipmentId: number; star: number; count: number }[];
  /** アイテムID → 実消費 */
  useItems: Record<number, number>;
}

export function buildDeltas(input: { transition: Transition; outcome: Outcome; consumption: ConsumptionInput }): Delta[] {
  if (input.outcome === 'skip') return [];
  const out: Delta[] = [];
  const t = input.transition;
  if (input.outcome === 'success') {
    if (t.kind === 'improve') {
      out.push({ scope: 'equipment', equipmentId: t.equipmentId, star: t.fromStar, amount: -1 });
      out.push({ scope: 'equipment', equipmentId: t.equipmentId, star: t.toStar, amount: 1 });
    } else {
      out.push({ scope: 'equipment', equipmentId: t.equipmentId, star: MAX_STAR, amount: -1 });
      out.push({ scope: 'equipment', equipmentId: t.toEquipmentId, star: t.toStar, amount: 1 });
    }
  }
  for (const e of [...input.consumption.equipment].sort((a, b) => a.equipmentId - b.equipmentId || a.star - b.star)) {
    if (e.count > 0) out.push({ scope: 'equipment', equipmentId: e.equipmentId, star: e.star, amount: -e.count });
  }
  for (const [id, amount] of Object.entries(input.consumption.resources).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (amount > 0) out.push({ scope: `resource:${Number(id)}`, amount: -amount });
  }
  for (const [id, amount] of Object.entries(input.consumption.useItems).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (amount > 0) out.push({ scope: `item:${Number(id)}`, amount: -amount });
  }
  return out;
}

export function scopesOfDeltas(deltas: Delta[]): ScopeKey[] {
  const set = new Set<ScopeKey>();
  for (const d of deltas) set.add(d.scope);
  return [...set].sort((a, b) => (a === 'equipment' ? -1 : b === 'equipment' ? 1 : a.localeCompare(b)));
}

/** 既知在庫が負になる scope（装備は★単位）。確認待ちの下書きが確保した既知消費を差し引く。不明在庫は判定しない */
export function wouldGoNegative(p: InventoryProjection, deltas: Delta[]): ScopeKey[] {
  const out = new Set<ScopeKey>();
  const eq = new Map<string, number>();
  const other = new Map<string, number>();
  for (const d of deltas) {
    if (d.scope === 'equipment') {
      const k = bucketKey(d.equipmentId, d.star);
      eq.set(k, (eq.get(k) ?? 0) + d.amount);
    } else other.set(d.scope, (other.get(d.scope) ?? 0) + d.amount);
  }
  if (p.equipment.known) {
    for (const [k, amount] of eq) if ((p.equipment.counts.get(k) ?? 0) - (p.holds.get(`equipment:${k}`) ?? 0) + amount < 0) out.add('equipment');
  }
  for (const [scope, amount] of other) {
    const id = Number(scope.split(':')[1]);
    const v = scope.startsWith('resource:') ? p.resources.get(id) : p.items.get(id);
    if (v && v.value - (p.holds.get(scope) ?? 0) + amount < 0) out.add(scope as ScopeKey);
  }
  return [...out];
}

/** 基準に包含済み（訂正しても現在在庫に反映しない）scope */
export function fixedHistoryOnlyScopes(event: Pick<ResultEvent, 'originalSequence' | 'fromDraftId'>, scopes: ScopeKey[], baselines: Baseline[]): ScopeKey[] {
  const byScope = new Map(baselines.map((b) => [b.scope, b]));
  return scopes.filter((s) => {
    const b = byScope.get(s);
    if (!b) return false;
    if (event.originalSequence <= b.includedThroughSequence) return true;
    return !!event.fromDraftId && b.includedDraftIds.includes(event.fromDraftId);
  });
}

/** 出力利用先を推移的にたどる（P48） */
export function dependentsOf(eventId: string, events: ResultEvent[]): ResultEvent[] {
  const active = events.filter((e) => e.status === 'active');
  const out: ResultEvent[] = [];
  const queue = [eventId];
  const seen = new Set([eventId]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of active) {
      if (seen.has(e.eventId) || !e.inputSourceEventIds.includes(id)) continue;
      seen.add(e.eventId);
      out.push(e);
      queue.push(e.eventId);
    }
  }
  return out.sort((a, b) => compareDate(a.occurredDateJst, b.occurredDateJst) || a.occurredOrder - b.occurredOrder);
}

export type CorrectionCheck = { ok: true } | { ok: false; reason: 'DEPENDENT_RESULTS' | 'ORDER_VIOLATION'; dependents: ResultEvent[] };

/**
 * 訂正の整合を検査する（P18・P48・P49）。
 * 出力を後続が使っている成功を成功以外へ変える、または後続より後の日付へ動かす訂正は確定しない。
 */
export function validateCorrection(input: { event: ResultEvent; newOutcome: Outcome | 'voided'; newOccurredDate: DateJst; events: ResultEvent[] }): CorrectionCheck {
  const deps = dependentsOf(input.event.eventId, input.events);
  if (deps.length === 0) return { ok: true };
  if (input.event.outcome === 'success' && input.newOutcome !== 'success') return { ok: false, reason: 'DEPENDENT_RESULTS', dependents: deps };
  const direct = deps.filter((d) => d.inputSourceEventIds.includes(input.event.eventId));
  if (direct.some((d) => compareDate(d.occurredDateJst, input.newOccurredDate) < 0)) return { ok: false, reason: 'ORDER_VIOLATION', dependents: deps };
  return { ok: true };
}

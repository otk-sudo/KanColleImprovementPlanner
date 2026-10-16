import type { InventoryProjection } from '../inventory/projection';
import { bucketKey, type ScopeKey } from '../inventory/types';
import type { DateJst } from '../jst';
import { compareDate } from '../jst';
import { MAX_STAR } from '../ids';
import { transitionFrom, transitionTo, type Transition } from '../master';
import type { Attempt, Baseline, Delta, Outcome, ResultEvent } from '../model';

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
/** 実施の前後関係（日付 → 日内順）。a が b より前に起きたか */
export function happenedBefore(a: { date: DateJst; order: number }, b: { date: DateJst; order: number }): boolean {
  const c = compareDate(a.date, b.date);
  return c < 0 || (c === 0 && a.order < b.order);
}

export function validateCorrection(input: { event: ResultEvent; newOutcome: Outcome | 'voided'; newOccurredDate: DateJst; newOccurredOrder: number; events: ResultEvent[] }): CorrectionCheck {
  const deps = dependentsOf(input.event.eventId, input.events);
  if (deps.length === 0) return { ok: true };
  if (input.event.outcome === 'success' && input.newOutcome !== 'success') return { ok: false, reason: 'DEPENDENT_RESULTS', dependents: deps };
  // 直接の後続より前に起きたままであること（同じ日なら日内順も比べる）
  const direct = deps.filter((d) => d.inputSourceEventIds.includes(input.event.eventId));
  const at = { date: input.newOccurredDate, order: input.newOccurredOrder };
  if (direct.some((d) => !happenedBefore(at, { date: d.occurredDateJst, order: d.occurredOrder }))) return { ok: false, reason: 'ORDER_VIOLATION', dependents: deps };
  return { ok: true };
}

/**
 * 実績の入力元を推定する（訂正時の依存検査用）。同じ目標で入力状態を出力した成功実績を、
 * 古い順に未使用のものから対応付ける。素材の製作品も同様に対応付ける。
 */
export function inferInputSources(events: ResultEvent[], attempt: Attempt, deltas: Delta[], at: { date: DateJst; order: number }): string[] {
  const from = transitionFrom(attempt.transition);
  // この実施より前に起きた成功だけを入力元の候補にする（日付が逆向きの依存を作らない）
  const before = (e: ResultEvent) => happenedBefore({ date: e.occurredDateJst, order: e.occurredOrder }, at);
  const active = events.filter((e) => e.status === 'active' && e.outcome === 'success' && e.goalId === attempt.goalId && e.recipeSnapshot && before(e));
  const byId = new Map(events.map((e) => [e.eventId, e]));
  // 入力元を使い切ったか。改修対象（前の工程の出力）は成功でだけ変わるので、失敗・スキップは前の工程の成功を使い切らない
  // （素材の製作品は失敗でも消費しうるので、製作品の対応は結果によらず使い切りとする）
  const isTargetLink = (consumer: ResultEvent, source: ResultEvent | undefined): boolean => {
    const ct = consumer.recipeSnapshot?.transition;
    const st = source?.recipeSnapshot?.transition;
    if (!ct || !st) return false;
    const to = transitionTo(st);
    const from = transitionFrom(ct);
    return to.equipmentId === from.equipmentId && to.star === from.star;
  };
  const consumedBy = new Map<string, number>();
  for (const e of events) {
    if (e.status !== 'active') continue;
    for (const s of e.inputSourceEventIds) {
      if (e.outcome !== 'success' && isTargetLink(e, byId.get(s))) continue;
      consumedBy.set(s, (consumedBy.get(s) ?? 0) + 1);
    }
  }
  const out: string[] = [];
  const producer = active
    .filter((e) => {
      const to = transitionTo(e.recipeSnapshot!.transition);
      return to.equipmentId === from.equipmentId && to.star === from.star && !e.stepKey.includes('|craft:') && !consumedBy.has(e.eventId);
    })
    .sort((a, b) => a.originalSequence - b.originalSequence)[0];
  if (producer) out.push(producer.eventId);
  // 成功では改修対象そのもの（入力★の −1）を1個だけ除く。同じ装備・★を素材にも使った分は素材として扱う
  const to = transitionTo(attempt.transition);
  let targetSkipped = !deltas.some((d) => d.scope === 'equipment' && d.equipmentId === to.equipmentId && d.star === to.star && d.amount > 0);
  for (const d of deltas) {
    if (d.scope !== 'equipment' || d.amount >= 0) continue;
    if (!targetSkipped && d.equipmentId === from.equipmentId && d.star === from.star && d.amount === -1) {
      targetSkipped = true;
      continue;
    }
    let need = -d.amount;
    for (const e of active.filter((x) => x.stepKey.includes(`|craft:${d.equipmentId}|`) && !consumedBy.has(x.eventId) && !out.includes(x.eventId)).sort((a, b) => a.originalSequence - b.originalSequence)) {
      const to = transitionTo(e.recipeSnapshot!.transition);
      if (to.equipmentId !== d.equipmentId || need <= 0) continue;
      out.push(e.eventId);
      need--;
    }
  }
  return out;
}

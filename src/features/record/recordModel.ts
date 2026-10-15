import type { InventoryProjection } from '../../domain/inventory/projection';
import { equipmentStars } from '../../domain/inventory/projection';
import type { ScopeKey } from '../../domain/inventory/types';
import type { DateJst } from '../../domain/jst';
import type { AttemptCost, MasterIndex, Transition } from '../../domain/master';
import type { Delta, GuaranteeMode, PlannedCost } from '../../domain/model';
import { buildDeltas, type ConsumptionInput } from '../../domain/results/results';

// 改修結果の入力（S13）。成功は計画費用を候補として表示し利用者が確定、失敗は空欄から実消費を入力（成功時費用を写さない）。

export interface ConsumptionRow {
  key: string;
  kind: 'resource' | 'item' | 'equipment';
  id: number;
  label: string;
  planned: number;
  /** 装備素材の★（低い★を既定） */
  star: number;
  stars: number[];
  primary: boolean;
}

export interface RecordForm {
  attemptId: string;
  mode: 'record' | 'correct' | 'resume';
  eventId: string | null;
  draftId: string | null;
  outcome: 'success' | 'failure' | 'skip' | 'voided' | null;
  occurredDate: DateJst;
  missedAfterImport: boolean;
  values: Record<string, string>;
  stars: Record<string, number>;
  scopeAnswers: Partial<Record<ScopeKey, 'apply' | 'historyOnly'>>;
  reason: string;
}

export function plannedFrom(cost: AttemptCost | null, mode: GuaranteeMode): PlannedCost | null {
  if (!cost) return null;
  return {
    fuel: cost.fuel,
    ammo: cost.ammo,
    steel: cost.steel,
    bauxite: cost.bauxite,
    devmats: mode === 'guaranteed' ? cost.devmats.guaranteed : cost.devmats.normal,
    screws: mode === 'guaranteed' ? cost.screws.guaranteed : cost.screws.normal,
    equipment: cost.equipment,
    useItems: cost.useItems,
  };
}

export function consumptionRows(m: MasterIndex, planned: PlannedCost | null, projection: InventoryProjection, extra: Delta[] = []): ConsumptionRow[] {
  const rows: ConsumptionRow[] = [];
  const res = (id: number, amount: number, primary: boolean) => rows.push({ key: `resource:${id}`, kind: 'resource', id, label: m.resourceName(id).replace(/（.*）$/, ''), planned: amount, star: 0, stars: [], primary });
  res(8, planned?.screws ?? 0, true);
  res(7, planned?.devmats ?? 0, true);
  const eqIds = new Set<number>([...(planned?.equipment ?? []).map((e) => e.equipmentId), ...extra.filter((d) => d.scope === 'equipment' && d.amount < 0).map((d) => (d as { equipmentId: number }).equipmentId)]);
  for (const id of eqIds) {
    const owned = [...equipmentStars(projection, id).keys()].sort((a, b) => a - b);
    const p = planned?.equipment.find((e) => e.equipmentId === id)?.count ?? 0;
    rows.push({ key: `equipment:${id}`, kind: 'equipment', id, label: m.equipmentName(id), planned: p, star: owned[0] ?? 0, stars: owned.length > 0 ? owned : [0], primary: true });
  }
  const itemIds = new Set<number>([...(planned?.useItems ?? []).map((u) => u.useItemId), ...extra.filter((d) => d.scope.startsWith('item:')).map((d) => Number(d.scope.split(':')[1]))]);
  for (const id of itemIds) rows.push({ key: `item:${id}`, kind: 'item', id, label: m.useItemName(id), planned: planned?.useItems.find((u) => u.useItemId === id)?.count ?? 0, star: 0, stars: [], primary: true });
  // 燃料・弾薬・鋼材・ボーキはレシピで消費する場合（または保存済みの記録にある場合）だけ表示する
  const extraScopes = new Set(extra.map((d) => d.scope));
  const basic: [number, number][] = [
    [1, planned?.fuel ?? 0],
    [2, planned?.ammo ?? 0],
    [3, planned?.steel ?? 0],
    [4, planned?.bauxite ?? 0],
  ];
  for (const [id, amount] of basic) if (amount > 0 || extraScopes.has(`resource:${id}`)) res(id, amount, false);
  return rows;
}

/** 保存済みの増減から、改修対象そのものの★変化（成功時の入力−1・出力＋1）を除いた消費だけを返す */
export function consumedDeltas(deltas: Delta[], transition: Transition, outcome: string): Delta[] {
  if (outcome !== 'success') return deltas;
  const fromStar = transition.kind === 'improve' ? transition.fromStar : 10;
  const toId = transition.kind === 'improve' ? transition.equipmentId : transition.toEquipmentId;
  let inputSkipped = false;
  let outputSkipped = false;
  return deltas.filter((d) => {
    if (d.scope !== 'equipment') return true;
    if (!inputSkipped && d.amount === -1 && d.equipmentId === transition.equipmentId && d.star === fromStar) return !(inputSkipped = true);
    if (!outputSkipped && d.amount === 1 && d.equipmentId === toId && d.star === transition.toStar) return !(outputSkipped = true);
    return true;
  });
}

export function valuesFromDeltas(deltas: Delta[], transition: Transition, outcome: string): { values: Record<string, string>; stars: Record<string, number> } {
  const values: Record<string, string> = {};
  const stars: Record<string, number> = {};
  for (const d of deltas) {
    if (d.amount >= 0) continue;
    if (d.scope === 'equipment') {
      const isTarget = outcome === 'success' && d.amount === -1 && d.equipmentId === transition.equipmentId && d.star === (transition.kind === 'improve' ? transition.fromStar : 10);
      if (isTarget) continue;
      values[`equipment:${d.equipmentId}`] = String((Number(values[`equipment:${d.equipmentId}`] ?? 0) || 0) - d.amount);
      stars[`equipment:${d.equipmentId}`] = d.star;
    } else values[d.scope] = String(-d.amount);
  }
  return { values, stars };
}

/** 確定済みの記録の値。消費0の行は増減が保存されないため 0 で埋める（下書きの未確定値には使わない） */
export function savedValues(deltas: Delta[], transition: Transition, outcome: string, rows: ConsumptionRow[]): { values: Record<string, string>; stars: Record<string, number> } {
  const v = valuesFromDeltas(deltas, transition, outcome);
  for (const r of rows) if (v.values[r.key] === undefined) v.values[r.key] = '0';
  return v;
}

export function parseCount(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  if (!/^\d+$/.test(v.trim())) return NaN;
  return Number(v.trim());
}

/** 入力値から増減を作る。未入力の行は unknown に入れる */
export function deltasFromForm(form: RecordForm, rows: ConsumptionRow[], transition: Transition): { deltas: Delta[]; known: Delta[]; unknownScopes: ScopeKey[]; invalid: string[] } {
  const consumption: ConsumptionInput = { resources: {}, equipment: [], useItems: {} };
  const unknown = new Set<ScopeKey>();
  const invalid: string[] = [];
  for (const r of rows) {
    const n = parseCount(form.values[r.key]);
    if (n === null) {
      unknown.add(r.kind === 'equipment' ? 'equipment' : (r.key as ScopeKey));
      continue;
    }
    if (Number.isNaN(n)) {
      invalid.push(r.label);
      continue;
    }
    if (r.kind === 'resource') consumption.resources[r.id] = n;
    else if (r.kind === 'item') consumption.useItems[r.id] = n;
    else if (n > 0) consumption.equipment.push({ equipmentId: r.id, star: form.stars[r.key] ?? r.star, count: n });
  }
  const outcome = form.outcome === 'success' || form.outcome === 'failure' || form.outcome === 'skip' ? form.outcome : 'failure';
  const deltas = form.outcome === 'voided' ? [] : buildDeltas({ transition, outcome, consumption });
  const known = buildDeltas({ transition, outcome: 'failure', consumption });
  return { deltas, known, unknownScopes: [...unknown], invalid };
}

/**
 * 記録・訂正で表示する★の所持数の変化（更新元・更新先）。訂正は旧増減を戻した正味の変化を示す。
 * 取り込み済みの基準に含まれる記録（P50）は現在数を変えず、当時の数量は記録がないため示さない。
 */
export type CorrectionEffect = { kind: 'change'; from: number; to: number } | { kind: 'none' } | { kind: 'historyOnly' };

export function correctionEffect(input: { newDeltas: Delta[]; oldDeltas: Delta[]; fixedScopes: ScopeKey[] }, fromId: number, fromStar: number, toId: number, toStar: number): CorrectionEffect {
  if (input.fixedScopes.includes('equipment')) return { kind: 'historyOnly' };
  const sum = (deltas: Delta[], id: number, star: number) => deltas.reduce((n, d) => (d.scope === 'equipment' && d.equipmentId === id && d.star === star ? n + d.amount : n), 0);
  const from = sum(input.newDeltas, fromId, fromStar) - sum(input.oldDeltas, fromId, fromStar);
  const to = sum(input.newDeltas, toId, toStar) - sum(input.oldDeltas, toId, toStar);
  return from === 0 && to === 0 ? { kind: 'none' } : { kind: 'change', from, to };
}

import type { InventoryProjection } from '../../domain/inventory/projection';
import type { MasterIndex } from '../../domain/master';
import { transitionOptions } from '../../domain/master';
import type { Goal } from '../../domain/model';
import type { BucketUsage, PlanResult } from '../../domain/planning/types';

// 所持データ画面の表示用の集計。計算は計画エンジンの結果（配分・保護）を使い、画面で独自に計算しない。

export interface EquipmentRow {
  key: string;
  equipmentId: number;
  star: number;
  owned: number;
  goalUse: number;
  protectionRequested: number;
  materialAvailable: number;
  reconciliationRequired: boolean;
  known: boolean;
}

export function equipmentRows(projection: InventoryProjection, plan: PlanResult | null): EquipmentRow[] {
  const usage = new Map<string, BucketUsage>((plan?.buckets ?? []).map((b) => [`${b.equipmentId}:${b.star}`, b]));
  const rows: EquipmentRow[] = [];
  for (const [key, count] of projection.equipment.counts) {
    const [id, star] = key.split(':').map(Number) as [number, number];
    const u = usage.get(key);
    rows.push({
      key,
      equipmentId: id,
      star,
      owned: count,
      goalUse: u?.goalUse ?? 0,
      protectionRequested: u?.protectionRequested ?? 0,
      materialAvailable: u?.materialAvailable ?? Math.max(0, count),
      reconciliationRequired: u?.reconciliationRequired ?? false,
      known: true,
    });
  }
  return rows;
}

export type HelperStatus = 'ok' | 'missing' | 'remodel' | 'unknown';

export interface HelperRow {
  /** 系統と要求する艦の組（同じ系統でも要求する改造段階が違えば別の行） */
  key: string;
  shipId: number;
  displayShipId: number;
  status: HelperStatus;
  ownedLabel: string;
  requiredShipIds: number[];
  targets: number[];
}

/** 目標に関係する担当艦（目標装備の改修に必要な艦娘）の所持・改造段階 */
export function helperRows(m: MasterIndex, projection: InventoryProjection, goals: Goal[], plan: PlanResult | null): HelperRow[] {
  const equipmentIds = new Set<number>();
  for (const g of goals) equipmentIds.add(g.equipmentId);
  for (const s of plan?.steps ?? []) equipmentIds.add(s.transition.equipmentId);
  const byRequirement = new Map<string, HelperRow>();
  for (const eqId of [...equipmentIds].sort((a, b) => a - b)) {
    const required = new Set<number>();
    for (const e of m.recipes.get(eqId) ?? []) for (const h of e.helpers) for (const id of h.shipIds) required.add(id);
    // 同じ改造系統の要求は1行にまとめる（装備ごとに要求する段階が違う場合は、要求ごとに別の行にして状態を判定する）
    const families = new Map<number, number[]>();
    for (const id of required) {
      const fam = m.ships.get(id)?.familyId ?? id;
      families.set(fam, [...(families.get(fam) ?? []), id]);
    }
    for (const [fam, ids] of families) {
      const sorted = ids.sort((a, b) => a - b);
      const ownedRequired = sorted.find((id) => (projection.ships.owned.get(id) ?? 0) > 0);
      const ownedFamily = m.shipFamily(sorted[0]!).filter((id) => (projection.ships.owned.get(id) ?? 0) > 0);
      let status: HelperStatus;
      let display: number;
      let ownedLabel: string;
      if (!projection.ships.known) {
        status = 'unknown';
        display = sorted[0]!;
        ownedLabel = '所持状況不明';
      } else if (ownedRequired !== undefined) {
        status = 'ok';
        display = ownedRequired;
        ownedLabel = `${stageName(m, ownedRequired)}を所持`;
      } else if (ownedFamily.length > 0) {
        status = 'remodel';
        display = ownedFamily[ownedFamily.length - 1]!;
        ownedLabel = `${stageName(m, display)}を所持`;
      } else {
        status = 'missing';
        display = sorted[0]!;
        ownedLabel = '未所持';
      }
      const key = `${fam}:${sorted.join(',')}`;
      const existing = byRequirement.get(key);
      if (existing) {
        if (!existing.targets.includes(eqId)) existing.targets.push(eqId);
      } else {
        byRequirement.set(key, { key, shipId: sorted[0]!, displayShipId: display, status, ownedLabel, requiredShipIds: sorted, targets: [eqId] });
      }
    }
  }
  return [...byRequirement.values()].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.shipId - b.shipId || a.key.localeCompare(b.key));
}

function statusRank(s: HelperStatus): number {
  return s === 'ok' ? 0 : s === 'missing' ? 1 : s === 'remodel' ? 2 : 3;
}

/** 「改二」「改」「（未改造）」など、同じ系統の基本名を除いた改造段階 */
export function stageName(m: MasterIndex, shipId: number): string {
  const s = m.ships.get(shipId);
  if (!s) return `ID ${shipId}`;
  // 改造前の艦（同じ系統のどの艦の改造先にもなっていない艦）を基本名にする
  const family = m.shipFamily(shipId);
  const targets = new Set(family.map((id) => m.ships.get(id)?.afterShipId).filter((x): x is number => x !== null && x !== undefined));
  const root = family.filter((id) => !targets.has(id)).sort((a, b) => a - b)[0] ?? family.sort((a, b) => a - b)[0]!;
  const base = m.ships.get(root)?.name ?? s.name;
  if (s.id === root || s.name === base) return '未改造';
  return s.name.startsWith(base) ? s.name.slice(base.length) : s.name;
}

export function requiredLabel(m: MasterIndex, row: HelperRow): string {
  if (row.status === 'ok') return '✓ 条件を満たす';
  if (row.status === 'unknown') return '? 所持状況不明';
  if (row.status === 'missing') return '! 担当艦なし';
  const need = row.requiredShipIds.map((id) => stageName(m, id)).join('・');
  return `! ${need}が必要`;
}

export function hasRecipe(m: MasterIndex, equipmentId: number): boolean {
  return transitionOptions(m, { kind: 'improve', equipmentId, fromStar: 0, toStar: 1 }).length > 0 || (m.recipes.get(equipmentId)?.length ?? 0) > 0;
}

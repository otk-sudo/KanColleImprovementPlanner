import type { Baseline, Delta, DraftResult, ResultEvent } from '../model';
import type { EquipmentInstance, Granularity, ScopeKey, ShipEntry } from './types';
import { bucketKey } from './types';

// 見込み所持数 = 最新基準値 + 基準境界より後の有効な実績増減（design/06）。
// 履歴のみの scope・基準に包含済みの下書きから確定した実績・無効化した実績は除外する。
// 予定・スキップ・未確定の下書きは在庫を変更しない。

export interface ScopeValue {
  known: true;
  value: number;
  importedAt: string;
  sourceCapturedAt: string | null;
  snapshotId: string;
}

export interface EquipmentProjection {
  known: boolean;
  granularity: Granularity | null;
  /** bucketKey(装備ID,★) → 個数 */
  counts: Map<string, number>;
  instances: EquipmentInstance[] | null;
  importedAt: string | null;
  sourceCapturedAt: string | null;
  snapshotId: string | null;
}

export interface ShipProjection {
  known: boolean;
  ships: ShipEntry[];
  /** 艦娘マスターID → 所持数 */
  owned: Map<number, number>;
  importedAt: string | null;
  sourceCapturedAt: string | null;
}

export interface InventoryProjection {
  equipment: EquipmentProjection;
  ships: ShipProjection;
  resources: Map<number, ScopeValue>;
  items: Map<number, ScopeValue>;
  /** 結果確認待ちの下書きが保留している既知消費（scope → 量。資材/アイテムは正、装備は bucketKey 単位） */
  holds: Map<string, number>;
  /** 下書きの不明消費により充足を断定できない scope */
  pendingUnknownScopes: Set<ScopeKey>;
  /** 既知在庫が負になった scope（不整合） */
  negativeScopes: ScopeKey[];
}

function effectiveFor(scope: ScopeKey, base: Baseline, event: ResultEvent): boolean {
  if (event.status !== 'active') return false;
  if (event.outcome === 'skip') return false;
  if (event.historyOnlyScopes.includes(scope)) return false;
  if (event.originalSequence <= base.includedThroughSequence) return false;
  if (event.fromDraftId && base.includedDraftIds.includes(event.fromDraftId)) return false;
  return true;
}

function deltaScope(d: Delta): ScopeKey {
  return d.scope;
}

export function projectInventory(baselines: Baseline[], events: ResultEvent[], drafts: DraftResult[]): InventoryProjection {
  const byScope = new Map(baselines.map((b) => [b.scope, b]));
  const negativeScopes: ScopeKey[] = [];

  // 装備
  const eqBase = byScope.get('equipment');
  const counts = new Map<string, number>();
  // 取り込み後の実績で増減した★。どの個体が残ったか分からないので、個体の対応を出さない
  const changedBuckets = new Set<string>();
  if (eqBase?.equipment) {
    for (const b of eqBase.equipment.buckets) counts.set(bucketKey(b.equipmentId, b.star), b.count);
    for (const e of events) {
      if (!effectiveFor('equipment', eqBase, e)) continue;
      for (const d of e.deltas) {
        if (d.scope !== 'equipment') continue;
        const key = bucketKey(d.equipmentId, d.star);
        counts.set(key, (counts.get(key) ?? 0) + d.amount);
        if (d.amount !== 0) changedBuckets.add(key);
      }
    }
    for (const [k, v] of [...counts]) {
      if (v === 0) counts.delete(k);
      else if (v < 0 && !negativeScopes.includes('equipment')) negativeScopes.push('equipment');
    }
  }

  // 艦娘（実績では増減しない）
  const shipBase = byScope.get('ships');
  const owned = new Map<number, number>();
  for (const s of shipBase?.ships ?? []) owned.set(s.shipId, (owned.get(s.shipId) ?? 0) + 1);

  // 資材・アイテム
  const resources = new Map<number, ScopeValue>();
  const items = new Map<number, ScopeValue>();
  for (const b of baselines) {
    if (b.scope === 'equipment' || b.scope === 'ships' || b.value === null) continue;
    let value = b.value;
    for (const e of events) {
      if (!effectiveFor(b.scope, b, e)) continue;
      for (const d of e.deltas) if (deltaScope(d) === b.scope) value += d.amount;
    }
    if (value < 0) negativeScopes.push(b.scope);
    const sv: ScopeValue = { known: true, value, importedAt: b.importedAt, sourceCapturedAt: b.sourceCapturedAt, snapshotId: b.snapshotId };
    const id = Number(b.scope.split(':')[1]);
    if (b.scope.startsWith('resource:')) resources.set(id, sv);
    else items.set(id, sv);
  }

  // 結果確認待ちの下書き：基準に包含されていない scope だけ保留する
  const holds = new Map<string, number>();
  const pendingUnknownScopes = new Set<ScopeKey>();
  for (const d of drafts) {
    if (d.status !== 'open') continue;
    for (const c of d.knownConsumptions) {
      const scope = deltaScope(c);
      // 「履歴だけに記録」と答えた種類は現在の所持数に反映しないので確保しない
      if (d.scopeAnswers[scope] === 'historyOnly') continue;
      const base = byScope.get(scope);
      if (base?.includedDraftIds.includes(d.draftId)) continue;
      if (c.amount >= 0) continue;
      const key = c.scope === 'equipment' ? `equipment:${bucketKey(c.equipmentId, c.star)}` : c.scope;
      holds.set(key, (holds.get(key) ?? 0) - c.amount);
    }
    for (const s of d.unknownScopes) {
      if (d.scopeAnswers[s] === 'historyOnly') continue;
      const base = byScope.get(s);
      if (base?.includedDraftIds.includes(d.draftId)) continue;
      pendingUnknownScopes.add(s);
    }
  }

  return {
    equipment: {
      known: !!eqBase?.equipment,
      granularity: eqBase?.equipment?.granularity ?? null,
      counts,
      instances: eqBase?.equipment?.instances ? eqBase.equipment.instances.filter((i) => !changedBuckets.has(bucketKey(i.equipmentId, i.star))) : null,
      importedAt: eqBase?.importedAt ?? null,
      sourceCapturedAt: eqBase?.sourceCapturedAt ?? null,
      snapshotId: eqBase?.snapshotId ?? null,
    },
    ships: {
      known: !!shipBase?.ships,
      ships: shipBase?.ships ?? [],
      owned,
      importedAt: shipBase?.importedAt ?? null,
      sourceCapturedAt: shipBase?.sourceCapturedAt ?? null,
    },
    resources,
    items,
    holds,
    pendingUnknownScopes,
    negativeScopes,
  };
}

/** 装備IDごとの★別所持数 */
export function equipmentStars(p: InventoryProjection, equipmentId: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const [k, v] of p.equipment.counts) {
    const [id, star] = k.split(':').map(Number);
    if (id === equipmentId && v > 0) out.set(star!, v);
  }
  return out;
}

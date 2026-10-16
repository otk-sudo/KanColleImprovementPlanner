// 所持データの更新範囲（scope）と値の型。
// 装備・艦娘は全件、資材・アイテムは ID ごとに範囲を分ける（design/10・13）。

export type ResourceScope = `resource:${number}`;
export type ItemScope = `item:${number}`;
export type ScopeKey = 'equipment' | 'ships' | ResourceScope | ItemScope;

export interface EquipmentBucket {
  equipmentId: number;
  star: number;
  count: number;
}

export interface EquipmentInstance {
  instanceId: number;
  equipmentId: number;
  star: number;
}

export interface ShipEntry {
  instanceId: number;
  shipId: number;
}

export type Granularity = 'aggregate' | 'instance';

export type ScopeUpdate =
  | { scope: 'equipment'; granularity: Granularity; buckets: EquipmentBucket[]; instances: EquipmentInstance[] | null }
  | { scope: 'ships'; ships: ShipEntry[] }
  | { scope: ResourceScope; value: number }
  | { scope: ItemScope; value: number };

export function isResourceScope(s: string): s is ResourceScope {
  return s.startsWith('resource:');
}

export function isItemScope(s: string): s is ItemScope {
  return s.startsWith('item:');
}

export function scopeId(s: ResourceScope | ItemScope): number {
  return Number(s.slice(s.indexOf(':') + 1));
}

export function bucketKey(equipmentId: number, star: number): string {
  return `${equipmentId}:${star}`;
}

export function sortScopes(scopes: ScopeKey[]): ScopeKey[] {
  const rank = (s: ScopeKey) => (s === 'equipment' ? 0 : s === 'ships' ? 1 : isResourceScope(s) ? 2 : 3);
  return [...scopes].sort((a, b) => rank(a) - rank(b) || (rank(a) >= 2 ? scopeId(a as ResourceScope) - scopeId(b as ResourceScope) : 0));
}

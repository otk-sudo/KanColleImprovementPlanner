import { MAX_STAR } from '../ids';
import type { MasterFile, RecipeEntryFile } from './schema';

export type EquipmentMaster = MasterFile['equipment'][number];
export type ShipMaster = MasterFile['ships'][number];
export type UseItemMaster = MasterFile['useItems'][number];
export type ResourceMaster = MasterFile['resources'][number];
export type RecipeEntry = RecipeEntryFile;

/** 改修値の更新は ★n→★n+1、装備更新は ★MAX から更新先へ */
export type Transition =
  | { kind: 'improve'; equipmentId: number; fromStar: number; toStar: number }
  | { kind: 'convert'; equipmentId: number; toEquipmentId: number; toStar: number };

export interface EquipState {
  equipmentId: number;
  star: number;
}

export interface ModeCost {
  normal: number;
  guaranteed: number;
}

/** 1回の試行に必要なもの（通常/確実化の両方を持つ） */
export interface AttemptCost {
  fuel: number;
  ammo: number;
  steel: number;
  bauxite: number;
  devmats: ModeCost;
  screws: ModeCost;
  equipment: { equipmentId: number; count: number }[];
  useItems: { useItemId: number; count: number }[];
}

export interface HelperGroup {
  shipIds: number[];
  days: number[];
}

/** 工程を実施できるレシピの候補（担当艦の所属エントリごとに費用が決まる） */
export interface TransitionOption {
  entryIndex: number;
  helpers: HelperGroup[];
  cost: AttemptCost;
}

export interface Route {
  /** 上流から目標までの装備ID列を > で連結したキー */
  key: string;
  equipmentIds: number[];
}

export interface MasterIndex {
  version: string;
  file: MasterFile;
  equipment: Map<number, EquipmentMaster>;
  ships: Map<number, ShipMaster>;
  useItems: Map<number, UseItemMaster>;
  resources: Map<number, ResourceMaster>;
  recipes: Map<number, RecipeEntry[]>;
  /** 更新先ID → 更新元ID一覧 */
  convertSources: Map<number, number[]>;
  hasRecipe(equipmentId: number): boolean;
  shipFamily(shipId: number): number[];
  equipmentName(id: number): string;
  shipName(id: number): string;
  useItemName(id: number): string;
  resourceName(id: number): string;
}

export const CONVERSION_LEVEL = 255;
export const ROUTE_DEPTH_LIMIT = 8;

export function buildMasterIndex(file: MasterFile): MasterIndex {
  const equipment = new Map(file.equipment.map((e) => [e.id, e]));
  const ships = new Map(file.ships.map((s) => [s.id, s]));
  const useItems = new Map(file.useItems.map((u) => [u.id, u]));
  const resources = new Map(file.resources.map((r) => [r.id, r]));
  const recipes = new Map(file.recipes.map((r) => [r.equipmentId, r.entries]));
  const convertSources = new Map<number, number[]>();
  for (const r of file.recipes) {
    for (const e of r.entries) {
      if (!e.convert) continue;
      const list = convertSources.get(e.convert.toEquipmentId) ?? [];
      if (!list.includes(r.equipmentId)) list.push(r.equipmentId);
      convertSources.set(e.convert.toEquipmentId, list);
    }
  }
  for (const list of convertSources.values()) list.sort((a, b) => a - b);
  const families = new Map<number, number[]>();
  for (const s of file.ships) {
    const list = families.get(s.familyId) ?? [];
    list.push(s.id);
    families.set(s.familyId, list);
  }
  return {
    version: file.masterVersion,
    file,
    equipment,
    ships,
    useItems,
    resources,
    recipes,
    convertSources,
    hasRecipe: (id) => (recipes.get(id)?.length ?? 0) > 0,
    shipFamily: (id) => {
      const s = ships.get(id);
      return s ? [...(families.get(s.familyId) ?? [id])] : [id];
    },
    equipmentName: (id) => equipment.get(id)?.name ?? `未登録の装備（ID ${id}）`,
    shipName: (id) => ships.get(id)?.name ?? `未登録の艦娘（ID ${id}）`,
    useItemName: (id) => useItems.get(id)?.name ?? `未登録のアイテム（ID ${id}）`,
    resourceName: (id) => resources.get(id)?.name ?? `資材（ID ${id}）`,
  };
}

function mergeItems<K extends 'equipmentId' | 'useItemId'>(key: K, lists: { [P in K]: number }[][]): ({ [P in K]: number } & { count: number })[] {
  const totals = new Map<number, number>();
  for (const list of lists) {
    for (const item of list as unknown as ({ [P in K]: number } & { count: number })[]) {
      totals.set(item[key], (totals.get(item[key]) ?? 0) + item.count);
    }
  }
  return [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([id, count]) => ({ [key]: id, count }) as { [P in K]: number } & { count: number });
}

function costFor(entry: RecipeEntry, level: number): AttemptCost | null {
  const stage = level === CONVERSION_LEVEL ? entry.cost.conv : level <= 6 ? entry.cost.p1 : entry.cost.p2;
  if (!stage) return null;
  const extras = entry.cost.extra.filter((x) => x.levels.includes(level));
  return {
    fuel: entry.cost.fuel,
    ammo: entry.cost.ammo,
    steel: entry.cost.steel,
    bauxite: entry.cost.bauxite,
    devmats: { normal: stage.devmats, guaranteed: stage.devmatsGuaranteed },
    screws: { normal: stage.screws, guaranteed: stage.screwsGuaranteed },
    equipment: mergeItems('equipmentId', [stage.equipment, ...extras.map((x) => x.equipment)]),
    useItems: mergeItems('useItemId', [stage.useItems, ...extras.map((x) => x.useItems)]),
  };
}

/**
 * 工程を実施できるレシピ候補。74式ENの実装と同じく、担当艦が属するエントリの費用を使う。
 * 担当艦の記載がないエントリも返す（helpers が空）。呼び出し側で「条件未確認」として扱う。
 */
export function transitionOptions(m: MasterIndex, t: Transition): TransitionOption[] {
  const entries = m.recipes.get(t.equipmentId) ?? [];
  const out: TransitionOption[] = [];
  for (const entry of entries) {
    if (t.kind === 'improve') {
      if (t.toStar !== t.fromStar + 1 || t.toStar > MAX_STAR) continue;
      const cost = costFor(entry, t.toStar);
      if (cost) out.push({ entryIndex: entry.entryIndex, helpers: entry.helpers, cost });
    } else {
      if (!entry.convert || entry.convert.toEquipmentId !== t.toEquipmentId || entry.convert.toStar !== t.toStar) continue;
      const cost = costFor(entry, CONVERSION_LEVEL);
      if (cost) out.push({ entryIndex: entry.entryIndex, helpers: entry.helpers, cost });
    }
  }
  return out;
}

/** 目標装備に至る更新経路（上流→目標）。目標のみの経路を先頭に置く。循環は除外。 */
export function enumerateRoutes(m: MasterIndex, targetId: number): Route[] {
  const results: number[][] = [];
  const walk = (path: number[]) => {
    results.push(path);
    if (path.length >= ROUTE_DEPTH_LIMIT) return;
    const head = path[0]!;
    for (const src of m.convertSources.get(head) ?? []) {
      if (path.includes(src)) continue;
      walk([src, ...path]);
    }
  };
  walk([targetId]);
  return results
    .sort((a, b) => a.length - b.length || a.join(',').localeCompare(b.join(',')))
    .map((ids) => ({ key: ids.join('>'), equipmentIds: ids }));
}

export function parseRouteKey(key: string): number[] {
  return key.split('>').map((s) => Number(s));
}

/** 更新で到達する★（レシピの明示値）。経路上で見つからなければ null。 */
export function conversionStar(m: MasterIndex, fromId: number, toId: number): number | null {
  for (const e of m.recipes.get(fromId) ?? []) {
    if (e.convert?.toEquipmentId === toId) return e.convert.toStar;
  }
  return null;
}

/** 経路上の状態列。更新元は★0〜★10、途中・目標の装備は更新後★から。 */
export function routeStates(m: MasterIndex, equipmentIds: number[], targetStar: number): EquipState[] {
  const states: EquipState[] = [];
  let startStar = 0;
  equipmentIds.forEach((id, i) => {
    const last = i === equipmentIds.length - 1;
    const end = last ? targetStar : MAX_STAR;
    for (let s = startStar; s <= end; s++) states.push({ equipmentId: id, star: s });
    if (!last) {
      const next = equipmentIds[i + 1]!;
      startStar = conversionStar(m, id, next) ?? 0;
    }
  });
  return states;
}

export function transitionBetween(from: EquipState, to: EquipState): Transition {
  if (from.equipmentId === to.equipmentId) return { kind: 'improve', equipmentId: from.equipmentId, fromStar: from.star, toStar: to.star };
  return { kind: 'convert', equipmentId: from.equipmentId, toEquipmentId: to.equipmentId, toStar: to.star };
}

export function transitionKey(t: Transition): string {
  return t.kind === 'improve' ? `${t.equipmentId}:${t.fromStar}>${t.toStar}` : `${t.equipmentId}:10>${t.toEquipmentId}:${t.toStar}`;
}

export function transitionFrom(t: Transition): EquipState {
  return t.kind === 'improve' ? { equipmentId: t.equipmentId, star: t.fromStar } : { equipmentId: t.equipmentId, star: MAX_STAR };
}

export function transitionTo(t: Transition): EquipState {
  return t.kind === 'improve' ? { equipmentId: t.equipmentId, star: t.toStar } : { equipmentId: t.toEquipmentId, star: t.toStar };
}

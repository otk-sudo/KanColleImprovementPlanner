import type { ScopeKey } from '../domain/inventory/types';
import { MAX_STAR } from '../domain/ids';
import type { AttemptCost, MasterIndex, Transition } from '../domain/master';
import type { GuaranteeMode, PlannedCost } from '../domain/model';
import type { CostKey } from '../domain/planning/types';
import { costItems } from '../domain/planning/plan';

// 表示用の整形。名称・★・数量は画像に焼き込まずテキストで併記する（R22）。

export function starText(star: number): string {
  return `★${star}`;
}

export function equipLabel(m: MasterIndex, equipmentId: number, star?: number): string {
  return star === undefined ? m.equipmentName(equipmentId) : `${m.equipmentName(equipmentId)} ${starText(star)}`;
}

export function transitionLabel(m: MasterIndex, t: Transition): string {
  if (t.kind === 'improve') return `${m.equipmentName(t.equipmentId)} ${starText(t.fromStar)} → ${starText(t.toStar)}`;
  return `${m.equipmentName(t.equipmentId)} ${starText(MAX_STAR)} → ${m.equipmentName(t.toEquipmentId)} ${starText(t.toStar)}（更新）`;
}

export function transitionShort(t: Transition): string {
  if (t.kind === 'improve') return `${starText(t.fromStar)} → ${starText(t.toStar)}`;
  return `${starText(MAX_STAR)} → 更新`;
}

export function costKeyLabel(m: MasterIndex, key: CostKey | ScopeKey): string {
  const [kind, id] = key.split(':') as [string, string | undefined];
  if (kind === 'resource') return m.resourceName(Number(id));
  if (kind === 'item') return m.useItemName(Number(id));
  if (kind === 'equipment' && id !== undefined) return m.equipmentName(Number(id));
  if (key === 'equipment') return '装備';
  if (key === 'ships') return '艦娘';
  return key;
}

/** 「改修資材」「開発資材」のような短い名称（括弧の別名を除く） */
export function costKeyPlain(m: MasterIndex, key: CostKey | ScopeKey): string {
  return costKeyLabel(m, key).replace(/（.*）$/, '');
}

export function costKeyShort(m: MasterIndex, key: CostKey): string {
  const [kind, id] = key.split(':') as [string, string];
  if (kind === 'resource') return m.resources.get(Number(id))?.shortName ?? m.resourceName(Number(id));
  if (kind === 'item') return m.useItemName(Number(id));
  return m.equipmentName(Number(id));
}

/** 「ネジ 4・釘 6・素材装備A 2」 */
export function costSummary(m: MasterIndex, cost: AttemptCost | null, mode: GuaranteeMode, opts: { includeBasic?: boolean; separator?: string } = {}): string {
  if (!cost) return '費用は未確認';
  const items = costItems(cost, mode).filter((i) => opts.includeBasic || !['resource:1', 'resource:2', 'resource:3', 'resource:4'].includes(i.key));
  if (items.length === 0) return '追加の消費なし';
  return items.map((i) => `${costKeyShort(m, i.key)} ${i.amount}`).join(opts.separator ?? '・');
}

/** 「ネジ4・釘6・素材装備A 2」（S19 の詰めた表記） */
export function costSummaryTight(m: MasterIndex, cost: AttemptCost | null, mode: GuaranteeMode, separator = '・'): string {
  if (!cost) return '費用は未確認';
  const items = costItems(cost, mode).filter((i) => !['resource:1', 'resource:2', 'resource:3', 'resource:4'].includes(i.key));
  if (items.length === 0) return '追加の消費なし';
  return items.map((i) => (i.key.startsWith('resource:') ? `${costKeyShort(m, i.key)}${i.amount}` : `${costKeyShort(m, i.key)} ${i.amount}`)).join(separator);
}

export function plannedCostFrom(cost: AttemptCost | null, mode: GuaranteeMode): PlannedCost | null {
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

export function numberOrUnknown(n: number | null | undefined): string {
  return n === null || n === undefined ? '不明' : String(n);
}

export function shipStageLabel(name: string, baseName: string): string {
  if (name.startsWith(baseName) && name.length > baseName.length) return name.slice(baseName.length);
  return name;
}

import type { MasterFile, RecipeEntryFile } from '../../src/domain/master/schema';
import { fixtureMaster, stage } from '../../src/test-support/fixtureMaster';

// 画面比較用の架空マスター。画面設計の架空例（主砲A・艦娘A改二 など）と同じ名称・費用にそろえる。
// 実在の装備・艦娘の改修条件を表さない。

export const ID = {
  mainGunA: 1001,
  materialA: 1002,
  secondaryB: 1003,
  aaGunC: 1004,
  radarC: 1005,
  seaplaneB: 1006,
  equipD: 1007,
  gunBase: 1008,
  gunUpgraded: 1009,
  craftSource: 1010,
  shipA: 2001,
  shipAKai: 2002,
  shipAKai2: 2003,
  shipB: 2011,
  shipBKai2: 2012,
  shipC: 2021,
  shipCKai: 2022,
  shipCKai2: 2023,
  itemB: 3001,
} as const;

const ALL = [0, 1, 2, 3, 4, 5, 6];
const zero = { fuel: 0, ammo: 0, steel: 0, bauxite: 0 };

function entry(helpers: RecipeEntryFile['helpers'], p1: RecipeEntryFile['cost']['p1'], p2: RecipeEntryFile['cost']['p2'], convert: RecipeEntryFile['convert'] = null, conv: RecipeEntryFile['cost']['conv'] = null): RecipeEntryFile {
  return { entryIndex: 0, helpers, convert, cost: { ...zero, p1, p2, conv, extra: [] } };
}

export function screenMaster(opts: { mainDays?: number[]; names?: Partial<Record<number, string>> } = {}): MasterFile {
  const m = fixtureMaster({ masterVersion: 'screen-fixture-v1' });
  const rename = (id: number, name: string) => {
    const e = m.equipment.find((x) => x.id === id);
    if (e) e.name = name;
    const s = m.ships.find((x) => x.id === id);
    if (s) s.name = name;
  };
  for (const [id, name] of Object.entries(opts.names ?? {})) rename(Number(id), name!);
  m.recipes = [
    // 主砲A：★6まで ネジ3/4・釘4/6・素材装備A 2、★7以降はネジ・素材なし（S01・S19 の例に合わせる）
    { equipmentId: ID.mainGunA, entries: [entry([{ shipIds: [ID.shipAKai2], days: opts.mainDays ?? [1, 3, 5] }], stage({ devmats: 4, devmatsGuaranteed: 6, screws: 3, screwsGuaranteed: 4, equipment: [{ equipmentId: ID.materialA, count: 2 }] }), stage({ devmats: 2, devmatsGuaranteed: 3 }))] },
    { equipmentId: ID.secondaryB, entries: [entry([{ shipIds: [ID.shipBKai2], days: ALL }], stage({ devmats: 2, devmatsGuaranteed: 3, screws: 1, screwsGuaranteed: 2 }), stage({ devmats: 3, devmatsGuaranteed: 4, screws: 2, screwsGuaranteed: 3 }))] },
    { equipmentId: ID.aaGunC, entries: [entry([], stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 1 }), stage({ devmats: 2, devmatsGuaranteed: 3, screws: 1, screwsGuaranteed: 2 }))] },
    { equipmentId: ID.radarC, entries: [entry([{ shipIds: [ID.shipAKai2], days: ALL }], stage({ devmats: 2, devmatsGuaranteed: 3, screws: 2, screwsGuaranteed: 3 }), stage({ devmats: 3, devmatsGuaranteed: 4, screws: 3, screwsGuaranteed: 4 }))] },
    { equipmentId: ID.seaplaneB, entries: [entry([{ shipIds: [ID.shipAKai2], days: ALL }], stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 2 }), stage({ devmats: 2, devmatsGuaranteed: 3, screws: 2, screwsGuaranteed: 3 }))] },
    { equipmentId: ID.equipD, entries: [entry([{ shipIds: [ID.shipCKai2], days: ALL }], stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 1 }), stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 1 }))] },
    // 更新元砲 ★MAX → 更新後砲（更新に更新用アイテムBが必要）
    { equipmentId: ID.gunBase, entries: [entry([{ shipIds: [ID.shipAKai2], days: ALL }], stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 1 }), stage({ devmats: 2, devmatsGuaranteed: 3, screws: 2, screwsGuaranteed: 3 }), { toEquipmentId: ID.gunUpgraded, toStar: 0 }, stage({ useItems: [{ useItemId: ID.itemB, count: 1 }] }))] },
    { equipmentId: ID.gunUpgraded, entries: [entry([{ shipIds: [ID.shipAKai2], days: ALL }], stage({ devmats: 2, devmatsGuaranteed: 3, screws: 2, screwsGuaranteed: 3 }), stage({ devmats: 3, devmatsGuaranteed: 4, screws: 3, screwsGuaranteed: 4 }))] },
    { equipmentId: ID.craftSource, entries: [entry([{ shipIds: [ID.shipAKai2], days: ALL }], stage({ devmats: 1, devmatsGuaranteed: 1, screws: 1, screwsGuaranteed: 1 }), stage({ devmats: 1, devmatsGuaranteed: 1, screws: 1, screwsGuaranteed: 1 }), { toEquipmentId: ID.materialA, toStar: 0 }, stage({ devmats: 2, devmatsGuaranteed: 3, screws: 2, screwsGuaranteed: 3 }))] },
  ];
  return m;
}

/** S03・S16・S22：実画像の表示例と同じ名称（架空の所持・条件） */
export function imageMaster(): MasterFile {
  const m = screenMaster({
    names: {
      [ID.mainGunA]: '12.7cm連装砲',
      [ID.secondaryB]: '12.7cm連装高角砲',
      [ID.aaGunC]: '12.7cm連装砲B型改二',
      [ID.shipA]: '睦月',
      [ID.shipAKai]: '睦月改',
      [ID.shipAKai2]: '睦月改二',
      [ID.shipB]: '睦月',
      [ID.shipBKai2]: '睦月（別系統）改二',
      [ID.shipC]: '吹雪',
      [ID.shipCKai]: '吹雪改',
      [ID.shipCKai2]: '吹雪改二',
    },
  });
  // S16：副砲B（ここでは 12.7cm連装高角砲）の担当は「睦月」。所持していない
  m.recipes = m.recipes.map((r) => (r.equipmentId === ID.secondaryB ? { ...r, entries: r.entries.map((e) => ({ ...e, helpers: [{ shipIds: [ID.shipB], days: ALL }] })) } : r));
  return m;
}

export function shipsMaster(): MasterFile {
  const m = imageMaster();
  m.equipment = m.equipment.map((e) => (e.id === ID.mainGunA ? { ...e, name: '主砲A' } : e.id === ID.secondaryB ? { ...e, name: '副砲B' } : e));
  return m;
}

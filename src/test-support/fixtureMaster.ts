import type { MasterFile, RecipeEntryFile } from '../domain/master/schema';

// テスト・画面比較用の架空マスター。実在の装備・艦娘・改修条件を表さない。
// 画面設計（S01〜S34）の架空例と同じ名称を使い、同一状態の画面比較に利用する。

type Stage = RecipeEntryFile['cost']['p1'];

export const FX = {
  // 装備
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
  // 艦娘
  shipA: 2001,
  shipAKai: 2002,
  shipAKai2: 2003,
  shipB: 2011,
  shipBKai2: 2012,
  shipC: 2021,
  shipCKai: 2022,
  shipCKai2: 2023,
  // アイテム
  itemB: 3001,
} as const;

export function stage(partial: Partial<Stage> = {}): Stage {
  return { devmats: 0, devmatsGuaranteed: 0, screws: 0, screwsGuaranteed: 0, equipment: [], useItems: [], ...partial };
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function fixtureMaster(overrides: Partial<MasterFile> = {}): MasterFile {
  const base: MasterFile = {
    masterVersion: 'fixture-v1',
    schemaVersion: 1,
    sources: [
      {
        id: 'fixture',
        title: '架空のテスト用マスター',
        repository: 'local',
        commit: 'fixture',
        path: 'src/test-support/fixtureMaster.ts',
        sha256: 'fixture',
        checkedAt: '2026-10-14',
        license: 'テスト専用',
      },
    ],
    resources: [
      { id: 1, name: '燃料', shortName: '燃料' },
      { id: 2, name: '弾薬', shortName: '弾薬' },
      { id: 3, name: '鋼材', shortName: '鋼材' },
      { id: 4, name: 'ボーキサイト', shortName: 'ボーキ' },
      { id: 5, name: '高速建造材（バーナー）', shortName: 'バーナー' },
      { id: 6, name: '高速修復材（バケツ）', shortName: 'バケツ' },
      { id: 7, name: '開発資材（釘）', shortName: '釘' },
      { id: 8, name: '改修資材（ネジ）', shortName: 'ネジ' },
    ],
    equipment: [
      { id: FX.mainGunA, name: '主砲A', typeId: 1, typeName: '小口径主砲', iconId: 1, sortNo: 1 },
      { id: FX.materialA, name: '素材装備A', typeId: 1, typeName: '小口径主砲', iconId: 1, sortNo: 2 },
      { id: FX.secondaryB, name: '副砲B', typeId: 4, typeName: '副砲', iconId: 4, sortNo: 3 },
      { id: FX.aaGunC, name: '対空砲C', typeId: 21, typeName: '対空機銃', iconId: 15, sortNo: 4 },
      { id: FX.radarC, name: '電探C', typeId: 12, typeName: '小型電探', iconId: 11, sortNo: 5 },
      { id: FX.seaplaneB, name: '水上機B', typeId: 10, typeName: '水上偵察機', iconId: 10, sortNo: 6 },
      { id: FX.equipD, name: '装備D', typeId: 1, typeName: '小口径主砲', iconId: 1, sortNo: 7 },
      { id: FX.gunBase, name: '更新元砲', typeId: 1, typeName: '小口径主砲', iconId: 1, sortNo: 8 },
      { id: FX.gunUpgraded, name: '更新後砲', typeId: 1, typeName: '小口径主砲', iconId: 1, sortNo: 9 },
      { id: FX.craftSource, name: '製作元装備', typeId: 1, typeName: '小口径主砲', iconId: 1, sortNo: 10 },
    ],
    ships: [
      { id: FX.shipA, name: '艦娘A', yomi: 'かんむすA', shipTypeId: 2, afterShipId: FX.shipAKai, afterLevel: 20, familyId: FX.shipA, sortNo: 1 },
      { id: FX.shipAKai, name: '艦娘A改', yomi: 'かんむすA', shipTypeId: 2, afterShipId: FX.shipAKai2, afterLevel: 70, familyId: FX.shipA, sortNo: 2 },
      { id: FX.shipAKai2, name: '艦娘A改二', yomi: 'かんむすA', shipTypeId: 2, afterShipId: null, afterLevel: null, familyId: FX.shipA, sortNo: 3 },
      { id: FX.shipB, name: '艦娘B', yomi: 'かんむすB', shipTypeId: 2, afterShipId: FX.shipBKai2, afterLevel: 70, familyId: FX.shipB, sortNo: 4 },
      { id: FX.shipBKai2, name: '艦娘B改二', yomi: 'かんむすB', shipTypeId: 2, afterShipId: null, afterLevel: null, familyId: FX.shipB, sortNo: 5 },
      { id: FX.shipC, name: '艦娘C', yomi: 'かんむすC', shipTypeId: 2, afterShipId: FX.shipCKai, afterLevel: 20, familyId: FX.shipC, sortNo: 6 },
      { id: FX.shipCKai, name: '艦娘C改', yomi: 'かんむすC', shipTypeId: 2, afterShipId: FX.shipCKai2, afterLevel: 70, familyId: FX.shipC, sortNo: 7 },
      { id: FX.shipCKai2, name: '艦娘C改二', yomi: 'かんむすC', shipTypeId: 2, afterShipId: null, afterLevel: null, familyId: FX.shipC, sortNo: 8 },
    ],
    useItems: [{ id: FX.itemB, name: '更新用アイテムB' }],
    recipes: [
      {
        // 主砲A：艦娘A改二が月・水・金。通常 釘4/ネジ3、確実化 釘6/ネジ4、素材装備A 2
        equipmentId: FX.mainGunA,
        entries: [
          {
            entryIndex: 0,
            helpers: [{ shipIds: [FX.shipAKai2], days: [1, 3, 5] }],
            convert: null,
            cost: {
              fuel: 10,
              ammo: 20,
              steel: 30,
              bauxite: 0,
              p1: stage({ devmats: 4, devmatsGuaranteed: 6, screws: 3, screwsGuaranteed: 4, equipment: [{ equipmentId: FX.materialA, count: 2 }] }),
              p2: stage({ devmats: 6, devmatsGuaranteed: 8, screws: 5, screwsGuaranteed: 7, equipment: [{ equipmentId: FX.materialA, count: 2 }] }),
              conv: null,
              extra: [],
            },
          },
        ],
      },
      {
        // 副砲B：艦娘B改二が必要（全曜日）
        equipmentId: FX.secondaryB,
        entries: [
          {
            entryIndex: 0,
            helpers: [{ shipIds: [FX.shipBKai2], days: ALL_DAYS }],
            convert: null,
            cost: { fuel: 10, ammo: 10, steel: 10, bauxite: 0, p1: stage({ devmats: 2, devmatsGuaranteed: 3, screws: 1, screwsGuaranteed: 2 }), p2: stage({ devmats: 3, devmatsGuaranteed: 4, screws: 2, screwsGuaranteed: 3 }), conv: null, extra: [] },
          },
        ],
      },
      {
        // 対空砲C：担当艦・曜日が未収録（出典にない）
        equipmentId: FX.aaGunC,
        entries: [
          {
            entryIndex: 0,
            helpers: [],
            convert: null,
            cost: { fuel: 0, ammo: 10, steel: 10, bauxite: 10, p1: stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 1 }), p2: stage({ devmats: 2, devmatsGuaranteed: 3, screws: 1, screwsGuaranteed: 2 }), conv: null, extra: [] },
          },
        ],
      },
      {
        // 装備D：艦娘C改二が必要
        equipmentId: FX.equipD,
        entries: [
          {
            entryIndex: 0,
            helpers: [{ shipIds: [FX.shipCKai2], days: ALL_DAYS }],
            convert: null,
            cost: { fuel: 0, ammo: 0, steel: 10, bauxite: 0, p1: stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 1 }), p2: stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 1 }), conv: null, extra: [] },
          },
        ],
      },
      {
        // 更新元砲：★MAXから更新後砲★0へ。更新にアイテムBが必要。★9・★10では追加でアイテムB
        equipmentId: FX.gunBase,
        entries: [
          {
            entryIndex: 0,
            helpers: [{ shipIds: [FX.shipAKai2], days: ALL_DAYS }],
            convert: { toEquipmentId: FX.gunUpgraded, toStar: 0 },
            cost: {
              fuel: 10,
              ammo: 10,
              steel: 10,
              bauxite: 0,
              p1: stage({ devmats: 1, devmatsGuaranteed: 2, screws: 1, screwsGuaranteed: 1 }),
              p2: stage({ devmats: 2, devmatsGuaranteed: 3, screws: 2, screwsGuaranteed: 3 }),
              conv: stage({ devmats: 5, devmatsGuaranteed: 8, screws: 3, screwsGuaranteed: 5, useItems: [{ useItemId: FX.itemB, count: 1 }] }),
              extra: [{ levels: [9, 10], equipment: [], useItems: [{ useItemId: FX.itemB, count: 1 }] }],
            },
          },
        ],
      },
      {
        equipmentId: FX.gunUpgraded,
        entries: [
          {
            entryIndex: 0,
            helpers: [{ shipIds: [FX.shipAKai2], days: ALL_DAYS }],
            convert: null,
            cost: { fuel: 10, ammo: 10, steel: 10, bauxite: 0, p1: stage({ devmats: 2, devmatsGuaranteed: 3, screws: 2, screwsGuaranteed: 3 }), p2: stage({ devmats: 3, devmatsGuaranteed: 4, screws: 3, screwsGuaranteed: 4 }), conv: null, extra: [] },
          },
        ],
      },
      {
        // 製作元装備：★MAXで素材装備Aへ更新（素材の製作経路の例）
        equipmentId: FX.craftSource,
        entries: [
          {
            entryIndex: 0,
            helpers: [{ shipIds: [FX.shipAKai2], days: ALL_DAYS }],
            convert: { toEquipmentId: FX.materialA, toStar: 0 },
            cost: { fuel: 5, ammo: 5, steel: 5, bauxite: 0, p1: stage({ devmats: 1, devmatsGuaranteed: 1, screws: 1, screwsGuaranteed: 1 }), p2: stage({ devmats: 1, devmatsGuaranteed: 1, screws: 1, screwsGuaranteed: 1 }), conv: stage({ devmats: 2, devmatsGuaranteed: 3, screws: 2, screwsGuaranteed: 3 }), extra: [] },
          },
        ],
      },
    ],
  };
  return { ...base, ...overrides };
}

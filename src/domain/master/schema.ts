import { z } from 'zod';

// 生成済みマスター（scripts/build-master.mjs の出力）の実行時検証。
// TypeScript の型だけでは外部ファイルの不正を検出できないため、読み込み時に検証する。

const count = z.number().int().nonnegative();
const id = z.number().int().positive();

const stageCostSchema = z.object({
  devmats: count,
  devmatsGuaranteed: count,
  screws: count,
  screwsGuaranteed: count,
  equipment: z.array(z.object({ equipmentId: id, count })),
  useItems: z.array(z.object({ useItemId: id, count })),
});

const extraCostSchema = z.object({
  levels: z.array(z.number().int()),
  equipment: z.array(z.object({ equipmentId: id, count })),
  useItems: z.array(z.object({ useItemId: id, count })),
});

export const recipeEntrySchema = z.object({
  entryIndex: count,
  helpers: z.array(z.object({ shipIds: z.array(id), days: z.array(z.number().int().min(0).max(6)) })),
  convert: z.object({ toEquipmentId: id, toStar: z.number().int().min(0).max(10) }).nullable(),
  cost: z.object({
    fuel: count,
    ammo: count,
    steel: count,
    bauxite: count,
    p1: stageCostSchema,
    p2: stageCostSchema,
    conv: stageCostSchema.nullable(),
    extra: z.array(extraCostSchema),
  }),
});

export const masterSchema = z.object({
  masterVersion: z.string().min(1),
  schemaVersion: z.literal(1),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      repository: z.string(),
      commit: z.string(),
      path: z.string(),
      sha256: z.string(),
      checkedAt: z.string(),
      license: z.string(),
    }),
  ),
  resources: z.array(z.object({ id, name: z.string(), shortName: z.string() })),
  equipment: z.array(
    z.object({
      id,
      name: z.string(),
      typeId: count,
      typeName: z.string(),
      iconId: count,
      sortNo: count.nullable(),
    }),
  ),
  ships: z.array(
    z.object({
      id,
      name: z.string(),
      yomi: z.string(),
      shipTypeId: count,
      afterShipId: id.nullable(),
      afterLevel: count.nullable(),
      familyId: id,
      sortNo: count.nullable(),
    }),
  ),
  useItems: z.array(z.object({ id, name: z.string() })),
  recipes: z.array(z.object({ equipmentId: id, entries: z.array(recipeEntrySchema) })),
});

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  masterVersion: z.string(),
  file: z.string(),
  sha256: z.string(),
  counts: z.record(z.string(), z.number()),
  sources: z.array(z.object({ id: z.string(), commit: z.string(), sha256: z.string(), checkedAt: z.string(), license: z.string() })),
});

export type MasterFile = z.infer<typeof masterSchema>;
export type MasterManifest = z.infer<typeof manifestSchema>;
export type RecipeEntryFile = z.infer<typeof recipeEntrySchema>;

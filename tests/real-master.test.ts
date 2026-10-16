import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMasterIndex, transitionOptions, type AttemptCost, type Transition } from '../src/domain/master';
import { manifestSchema, masterSchema } from '../src/domain/master/schema';
import { goal, planInput } from '../src/test-support/planFixtures';
import { buildPlan } from '../src/domain/planning/plan';

// R07/R08/R10/R11、A04。合成レシピだけでなく、固定した実出典の全エントリ・全段階を照合する。
// 期待値は生成済みマスターやアプリの計算関数から作らず、元の EquipmentUpgrades.json から独立集計する。
// 出典そのものとゲームの一致、配布許諾、全件の手計算確認を証明するテストではない。
interface RawItem { id: number; eq_count: number }
interface RawStage { devmats: number; devmats_sli: number; screws: number; screws_sli: number; equips?: RawItem[]; consumable?: RawItem[] }
interface RawEntry {
  helpers?: { ship_ids: number[]; days: number[] }[];
  convert?: { id_after: number; lvl_after: number };
  costs: { fuel: number; ammo: number; steel: number; baux: number; p1: RawStage; p2: RawStage; conv?: RawStage; extra?: { levels: number[]; equips?: RawItem[]; consumable?: RawItem[] }[] };
}
interface RawRecipe { eq_id: number; improvement?: RawEntry[] }
const bytes = (path: string) => readFileSync(path);
const json = (path: string): unknown => JSON.parse(bytes(path).toString('utf8').replace(/^\uFEFF/, ''));
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex').toUpperCase();
const manifest = manifestSchema.parse(json('public/master/manifest.json'));
const masterBytes = bytes(join('public/master', manifest.file));
const file = masterSchema.parse(JSON.parse(masterBytes.toString('utf8')));
const master = buildMasterIndex(file);
const source = file.sources.find(s => s.id === 'eo_equipment_upgrades');
if (!source) throw new Error('実出典の参照がありません。npm run master:build を実行してください。');
const rawPath = join('.cache/master-sources', `${source.id}-${source.commit}.json`);
const raw = json(rawPath) as RawRecipe[];
const entries = raw.flatMap(r => (r.improvement ?? []).map((entry, index) => ({ equipmentId: r.eq_id, index, entry })));

/** 元データのID別の合計。アプリ側の mergeItems / costFor / stageCost は使わない。 */
function totals(items: RawItem[]): [number, number][] {
  const counts: Record<number, number> = {};
  for (const item of items) counts[item.id] = (counts[item.id] ?? 0) + item.eq_count;
  return Object.entries(counts).map(([id, count]): [number, number] => [Number(id), count]).sort((a, b) => a[0] - b[0]);
}

function expectedCost(entry: RawEntry, level: number): AttemptCost {
  const c = entry.costs;
  const stage = level === 255 ? c.conv : level < 7 ? c.p1 : c.p2;
  if (!stage) throw new Error(`出典に段階費用がありません: ${level}`);
  const additions = (c.extra ?? []).filter(e => e.levels.includes(level));
  return {
    fuel: c.fuel, ammo: c.ammo, steel: c.steel, bauxite: c.baux,
    devmats: { normal: stage.devmats, guaranteed: stage.devmats_sli },
    screws: { normal: stage.screws, guaranteed: stage.screws_sli },
    equipment: totals([...(stage.equips ?? []), ...additions.flatMap(e => e.equips ?? [])]).map(([equipmentId, count]) => ({ equipmentId, count })),
    useItems: totals([...(stage.consumable ?? []), ...additions.flatMap(e => e.consumable ?? [])]).map(([useItemId, count]) => ({ useItemId, count })),
  };
}

describe('固定した実マスターの全エントリ照合', () => {
  it('生成物と全出典のハッシュを確認し、出典の改修対象・全エントリと一対一に対応する', () => {
    expect(digest(masterBytes)).toBe(manifest.sha256.toUpperCase());
    for (const s of file.sources) expect(digest(bytes(join('.cache/master-sources', `${s.id}-${s.commit}.json`)))).toBe(s.sha256.toUpperCase());
    expect(file.masterVersion).toBe(manifest.masterVersion);
    expect(entries.length).toBeGreaterThan(0);
    expect(file.recipes.map(r => [r.equipmentId, r.entries.length]).sort((a, b) => a[0]! - b[0]!))
      .toEqual(raw.filter(r => r.improvement?.length).map(r => [r.eq_id, r.improvement!.length]).sort((a, b) => a[0]! - b[0]!));
  });

  for (const { equipmentId, index, entry } of entries) {
    it(`装備ID ${equipmentId} / エントリ ${index}：★1〜10・更新の通常/確実化費用と担当曜日が出典と一致`, () => {
      const transitions: { level: number; t: Transition }[] = Array.from({ length: 10 }, (_, i) => ({
        level: i + 1,
        t: { kind: 'improve', equipmentId, fromStar: i, toStar: i + 1 },
      }));
      if (entry.convert) transitions.push({ level: 255, t: { kind: 'convert', equipmentId, toEquipmentId: entry.convert.id_after, toStar: entry.convert.lvl_after } });
      for (const { level, t } of transitions) {
        const options = transitionOptions(master, t).filter(o => o.entryIndex === index);
        expect(options, `段階 ${level} のエントリ欠落・重複`).toHaveLength(1);
        expect(options[0]!.cost, `段階 ${level} の費用`).toEqual(expectedCost(entry, level));
        expect(options[0]!.helpers, `段階 ${level} の担当艦・曜日`).toEqual((entry.helpers ?? []).map(h => ({ shipIds: h.ship_ids, days: h.days })));
      }
    });
  }
});

describe('R13/R19：実出典の担当艦別素材を計画に適用', () => {
  for (const [equipmentId, levels] of [[121, [7, 8, 9, 10]], [267, [1, 2, 3, 4, 5, 6]]] as const) {
    for (const level of levels) it(`装備ID ${equipmentId} 到達★${level}：別素材の担当を指定して費用と配置を照合`, () => {
      const rawEntries = raw.find(r => r.eq_id === equipmentId)!.improvement!;
      const chosen = rawEntries[1]!;
      const shipId = chosen.helpers![0]!.ship_ids[0]!;
      const expected = expectedCost(chosen, level);
      const ships = [...new Set(rawEntries.flatMap(e => (e.helpers ?? []).flatMap(h => h.ship_ids)))];
      const equipment: [number, number, number][] = [[equipmentId, level - 1, 1], ...expected.equipment.map(e => [e.equipmentId, 0, e.count] as [number, number, number])];
      const p = buildPlan(planInput({ master, inventory: { equipment, ships, resources: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, 1000])), items: Object.fromEntries(expected.useItems.map(i => [i.useItemId, i.count])) }, goals: [goal({ goalId: 'real', equipmentId, targetStar: level })], preferredHelpers: [{ stepKey: `real|${equipmentId}:${level - 1}>${level}|0`, shipId }] }));
      expect(p.unplaced).toEqual([]);
      expect(p.placements[0]).toMatchObject({ helperShipId: shipId, entryIndex: 1, cost: expected, tentative: false });
      expect(p.placements[0]!.date).not.toBeNull();
      for (const material of expected.equipment) expect(p.totals.find(t => t.key === `equipment:${material.equipmentId}`)?.need).toBe(material.count);
    });
  }
});

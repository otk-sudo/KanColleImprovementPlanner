import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildMasterIndex } from '../src/domain/master';
import { manifestSchema, masterSchema } from '../src/domain/master/schema';
import { buildPlan } from '../src/domain/planning/plan';
import { goal, planInput } from '../src/test-support/planFixtures';

const manifest = manifestSchema.parse(JSON.parse(readFileSync('public/master/manifest.json', 'utf8')));
const master = buildMasterIndex(masterSchema.parse(JSON.parse(readFileSync(`public/master/${manifest.file}`, 'utf8'))));
// docs/real-planning-examples.mdで元の固定出典の値から手で加算・乗算した期待値。
// 期待値の生成にアプリのcostFor/plan/合計関数を使わない。所持数は合成データ。
const cases = [
  { id: 'M0', equipmentId: 1, targetStar: 10, count: 1, routeKey: '1', shipId: 1, guaranteed: false, equipment: [[1, 0, 15]], steps: 10, need: { 'resource:1': 100, 'resource:2': 200, 'resource:3': 400, 'resource:7': 20, 'resource:8': 10, 'equipment:1': 14 } },
  { id: 'M1', equipmentId: 1, targetStar: 10, count: 2, routeKey: '1', shipId: 1, guaranteed: false, equipment: [[1, 6, 2], [1, 0, 16]], steps: 8, need: { 'resource:1': 80, 'resource:2': 160, 'resource:3': 320, 'resource:7': 16, 'resource:8': 8, 'equipment:1': 16 } },
  { id: 'M2', equipmentId: 1, targetStar: 10, count: 2, routeKey: '1', shipId: 1, guaranteed: true, equipment: [[1, 6, 2], [1, 0, 16]], steps: 8, need: { 'resource:1': 80, 'resource:2': 160, 'resource:3': 320, 'resource:7': 24, 'resource:8': 16, 'equipment:1': 16 } },
  { id: 'M3', equipmentId: 122, targetStar: 0, count: 1, routeKey: '121>122', shipId: 330, guaranteed: false, equipment: [[121, 6, 1], [3, 0, 6]], steps: 5, need: { 'resource:3': 400, 'resource:4': 350, 'resource:7': 24, 'resource:8': 17, 'equipment:3': 6 } },
  { id: 'M4', equipmentId: 130, targetStar: 0, count: 1, routeKey: '121>130', shipId: 428, guaranteed: true, equipment: [[121, 6, 1], [10, 0, 6]], steps: 5, need: { 'resource:3': 400, 'resource:4': 350, 'resource:7': 33, 'resource:8': 29, 'equipment:10': 6 } },
] as const;

for (const c of cases) it(`A04 実出典の手計算例${c.id}：工程数・個数・段階・分岐・確実化を照合`, () => {
  const p = buildPlan(planInput({ master, inventory: { equipment: c.equipment.map(([id, star, count]) => [id, star, count]), ships: [c.shipId], resources: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, 1000])) }, goals: [goal({ goalId: c.id, equipmentId: c.equipmentId, targetStar: c.targetStar, count: c.count, routeKey: c.routeKey, guarantee: { mode: c.guaranteed ? 'always' : 'never', fromStar: null }, updateGuarantee: c.guaranteed })] }));
  expect(p.steps).toHaveLength(c.steps);
  expect(p.unplaced).toEqual([]);
  expect(p.placements.every(x => !x.tentative && !x.predecessorTentative)).toBe(true);
  const actual = Object.fromEntries(p.totals.filter(t => t.need > 0).map(t => [t.key, t.need]));
  expect(actual).toEqual(c.need);
});

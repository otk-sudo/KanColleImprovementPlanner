import { describe, expect, it } from 'vitest';
import { FX, fixtureMaster, stage } from '../../test-support/fixtureMaster';
import { buildMasterIndex, enumerateRoutes, routeStates, transitionOptions } from './index';

describe('マスター索引', () => {
  const m = buildMasterIndex(fixtureMaster());

  it('★0→1〜★5→6 は p1、★6→7〜★9→10 は p2 の費用を使う', () => {
    const p1 = transitionOptions(m, { kind: 'improve', equipmentId: FX.mainGunA, fromStar: 5, toStar: 6 });
    const p2 = transitionOptions(m, { kind: 'improve', equipmentId: FX.mainGunA, fromStar: 6, toStar: 7 });
    expect(p1[0]?.cost.screws).toEqual({ normal: 3, guaranteed: 4 });
    expect(p2[0]?.cost.screws).toEqual({ normal: 5, guaranteed: 7 });
  });

  it('段階別の追加費用（extra）は該当する到達★だけに加える', () => {
    const at8 = transitionOptions(m, { kind: 'improve', equipmentId: FX.gunBase, fromStar: 7, toStar: 8 });
    const at9 = transitionOptions(m, { kind: 'improve', equipmentId: FX.gunBase, fromStar: 8, toStar: 9 });
    expect(at8[0]?.cost.useItems).toEqual([]);
    expect(at9[0]?.cost.useItems).toEqual([{ useItemId: FX.itemB, count: 1 }]);
  });

  it('更新工程は更新先が一致するエントリだけを候補にする', () => {
    const conv = transitionOptions(m, { kind: 'convert', equipmentId: FX.gunBase, toEquipmentId: FX.gunUpgraded, toStar: 0 });
    expect(conv).toHaveLength(1);
    expect(conv[0]?.cost.devmats).toEqual({ normal: 5, guaranteed: 8 });
    expect(conv[0]?.cost.useItems).toEqual([{ useItemId: FX.itemB, count: 1 }]);
    const wrong = transitionOptions(m, { kind: 'convert', equipmentId: FX.gunBase, toEquipmentId: FX.mainGunA, toStar: 0 });
    expect(wrong).toEqual([]);
  });

  it('改修データに未収録の装備は候補なし（不可とは断定しない）', () => {
    expect(transitionOptions(m, { kind: 'improve', equipmentId: FX.radarC, fromStar: 0, toStar: 1 })).toEqual([]);
    expect(m.hasRecipe(FX.radarC)).toBe(false);
  });

  it('更新経路を上流から列挙する。既定は対象装備のみ', () => {
    const routes = enumerateRoutes(m, FX.gunUpgraded);
    expect(routes.map((r) => r.key)).toEqual([`${FX.gunUpgraded}`, `${FX.gunBase}>${FX.gunUpgraded}`]);
  });

  it('経路の状態列は更新元★0〜★10、更新先★0〜目標★', () => {
    const states = routeStates(m, [FX.gunBase, FX.gunUpgraded], 2);
    expect(states[0]).toEqual({ equipmentId: FX.gunBase, star: 0 });
    expect(states[10]).toEqual({ equipmentId: FX.gunBase, star: 10 });
    expect(states[11]).toEqual({ equipmentId: FX.gunUpgraded, star: 0 });
    expect(states.at(-1)).toEqual({ equipmentId: FX.gunUpgraded, star: 2 });
    expect(states).toHaveLength(14);
  });

  it('艦娘の改造系統を同じファミリーとして引ける', () => {
    expect(m.shipFamily(FX.shipAKai).sort()).toEqual([FX.shipA, FX.shipAKai, FX.shipAKai2].sort());
  });

  it('ステージ関数の既定値', () => {
    expect(stage().equipment).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildMasterIndex } from '../../domain/master';
import { FX, fixtureMaster } from '../../test-support/fixtureMaster';
import { routeOptions, withEquipment } from './goalModel';
import type { Goal } from '../../domain/model';

describe('目標フォームの更新経路', () => {
  it('未選択と「対象だけを改修」を別の値として選べる（未選択は空、対象だけは対象のみの経路キー）', () => {
    const m = buildMasterIndex(fixtureMaster());
    const opts = routeOptions(m, FX.gunUpgraded);
    expect(opts[0]).toEqual({ value: '', label: '未選択（所持していない場合の作り方を選ぶ）' });
    expect(opts[1]).toEqual({ value: String(FX.gunUpgraded), label: '更新後砲だけを改修（更新元から作らない）' });
    expect(opts.slice(2).map((o) => o.value)).toContain(`${FX.gunBase}>${FX.gunUpgraded}`);
  });

  it('更新元のない装備には経路の選択肢を出さない', () => {
    const m = buildMasterIndex(fixtureMaster());
    expect(routeOptions(m, FX.gunBase)).toEqual([]);
  });
});

describe('目標フォームの装備の変更', () => {
  it('装備を変えたら、前の装備のための更新経路と素材の作り方を初期化する', () => {
    const g = { equipmentId: FX.mainGunA, routeKey: '1008>1009', materialRoutes: { '1002': { kind: 'craft', routeKey: '1010>1002' } } } as unknown as Goal;
    expect(withEquipment(g, FX.secondaryB)).toMatchObject({ equipmentId: FX.secondaryB, routeKey: null, materialRoutes: {} });
  });
});

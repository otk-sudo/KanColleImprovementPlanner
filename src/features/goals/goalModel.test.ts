import { describe, expect, it } from 'vitest';
import { buildMasterIndex } from '../../domain/master';
import { FX, fixtureMaster } from '../../test-support/fixtureMaster';
import { routeOptions } from './goalModel';

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

import { describe, expect, it } from 'vitest';
import { buildMasterIndex } from '../domain/master';
import type { RecipeSnapshot } from '../domain/model';
import { fixtureMaster } from '../test-support/fixtureMaster';
import { recordedTransitionLabel } from './format';

const m = buildMasterIndex(fixtureMaster());
const t = { kind: 'improve' as const, equipmentId: 9999, fromStar: 5, toStar: 6 };

function snapshot(partial: Partial<RecipeSnapshot> = {}): RecipeSnapshot {
  return { masterVersion: 'old', transition: t, fromName: '旧名称の砲', toName: '旧名称の砲', mode: 'normal', entryIndex: 0, plannedCost: null, helperShipId: null, helperShipName: null, ...partial };
}

describe('過去の記録の工程名（P30）', () => {
  it('新しいマスターで削除された装備でも、記録時の名称で表示する', () => {
    expect(recordedTransitionLabel(m, t, snapshot())).toBe('旧名称の砲 ★5 → ★6');
  });

  it('記録時の名称がなければ現在のマスターの名称（未登録表示を含む）を使う', () => {
    expect(recordedTransitionLabel(m, t, snapshot({ fromName: '', toName: '' }))).toBe('未登録の装備（ID 9999） ★5 → ★6');
    expect(recordedTransitionLabel(m, t, null)).toBe('未登録の装備（ID 9999） ★5 → ★6');
  });

  it('更新の記録は更新元・更新先の記録時の名称で表示する', () => {
    const conv = { kind: 'convert' as const, equipmentId: 9999, toEquipmentId: 9998, toStar: 0 };
    expect(recordedTransitionLabel(m, conv, snapshot({ transition: conv, fromName: '旧A', toName: '旧B' }))).toBe('旧A ★10 → 旧B ★0（更新）');
  });
});

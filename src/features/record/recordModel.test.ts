import { describe, expect, it } from 'vitest';
import type { Delta } from '../../domain/model';
import { correctionEffect } from './recordModel';

const eq = (equipmentId: number, star: number, amount: number): Delta => ({ scope: 'equipment', equipmentId, star, amount });

describe('記録・訂正で表示する所持数の変化', () => {
  it('新しい記録は入力した増減をそのまま示す', () => {
    const r = correctionEffect({ newDeltas: [eq(1, 5, -1), eq(1, 6, 1)], oldDeltas: [], fixedScopes: [] }, 1, 5, 1, 6);
    expect(r).toEqual({ kind: 'change', from: -1, to: 1 });
  });

  it('成功を失敗へ訂正すると、旧増減を戻した正味の変化を示す（P47）', () => {
    const r = correctionEffect({ newDeltas: [], oldDeltas: [eq(1, 5, -1), eq(1, 6, 1)], fixedScopes: [] }, 1, 5, 1, 6);
    expect(r).toEqual({ kind: 'change', from: 1, to: -1 });
  });

  it('成功を成功のまま訂正しても★の所持数は変わらない', () => {
    const r = correctionEffect({ newDeltas: [eq(1, 5, -1), eq(1, 6, 1)], oldDeltas: [eq(1, 5, -1), eq(1, 6, 1)], fixedScopes: [] }, 1, 5, 1, 6);
    expect(r).toEqual({ kind: 'none' });
  });

  it('P50：取り込み済みの基準に含まれる記録の訂正は現在数を変えず、当時の数量は検証不能と示す', () => {
    const r = correctionEffect({ newDeltas: [], oldDeltas: [eq(1, 5, -1), eq(1, 6, 1)], fixedScopes: ['equipment'] }, 1, 5, 1, 6);
    expect(r).toEqual({ kind: 'historyOnly' });
  });
});

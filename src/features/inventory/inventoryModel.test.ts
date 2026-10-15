import { describe, expect, it } from 'vitest';
import { buildMasterIndex } from '../../domain/master';
import { FX, fixtureMaster } from '../../test-support/fixtureMaster';
import { stageName } from './inventoryModel';

describe('改造段階名（S16・S05）', () => {
  const m = buildMasterIndex(fixtureMaster());

  it('改造前の艦を基準に、改・改二などの段階名を返す', () => {
    expect(stageName(m, FX.shipA)).toBe('未改造');
    expect(stageName(m, FX.shipAKai)).toBe('改');
    expect(stageName(m, FX.shipAKai2)).toBe('改二');
  });

  it('系統の途中の艦（改）を基準にしない（「二を所持」のような誤表示をしない）', () => {
    expect(stageName(m, FX.shipCKai2)).toBe('改二');
    expect(stageName(m, FX.shipCKai2)).not.toBe('二');
  });

  it('マスターにない艦はIDで示す', () => {
    expect(stageName(m, 99999)).toBe('ID 99999');
  });
});

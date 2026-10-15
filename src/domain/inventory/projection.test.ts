import { describe, expect, it } from 'vitest';
import type { Baseline, DraftResult, ResultEvent } from '../model';
import { projectInventory } from './projection';

function baseline(scope: Baseline['scope'], partial: Partial<Baseline>): Baseline {
  return {
    scope,
    snapshotId: `snap-${scope}`,
    importedAt: '2026-10-14T00:00:00.000Z',
    sourceCapturedAt: null,
    inputHash: 'h',
    sourceKind: 'material',
    includedThroughSequence: 0,
    includedDraftIds: [],
    equipment: null,
    ships: null,
    value: null,
    ...partial,
  };
}

function event(seq: number, deltas: ResultEvent['deltas'], partial: Partial<ResultEvent> = {}): ResultEvent {
  return {
    eventId: `e${seq}`,
    attemptId: `a${seq}`,
    stepKey: 's',
    goalId: null,
    originalSequence: seq,
    revision: 1,
    status: 'active',
    outcome: 'success',
    occurredDateJst: '2026-10-14',
    occurredOrder: seq,
    recordedAt: '2026-10-14T00:00:00.000Z',
    deltas,
    historyOnlyScopes: [],
    fromDraftId: null,
    recipeSnapshot: null,
    inputSourceEventIds: [],
    history: [],
    ...partial,
  };
}

const screw = (amount: number) => ({ scope: 'resource:8' as const, amount });

describe('在庫投影：最新JSONを基準にし、基準以後の実績だけを重ねる', () => {
  it('P13：基準10→実績−4→JSON10→実績−3 は 6→10→7', () => {
    const b1 = baseline('resource:8', { value: 10 });
    const e1 = event(1, [screw(-4)]);
    expect(projectInventory([b1], [e1], []).resources.get(8)?.value).toBe(6);

    const b2 = baseline('resource:8', { value: 10, includedThroughSequence: 1, snapshotId: 'snap2' });
    expect(projectInventory([b2], [e1], []).resources.get(8)?.value).toBe(10);

    const e2 = event(2, [screw(-3)]);
    expect(projectInventory([b2], [e1, e2], []).resources.get(8)?.value).toBe(7);
  });

  it('P14：基準に含まれる旧実績を訂正しても現在数は変わらない', () => {
    const b2 = baseline('resource:8', { value: 10, includedThroughSequence: 1 });
    const corrected = event(1, [screw(-2)], { revision: 2 });
    const e2 = event(2, [screw(-3)]);
    expect(projectInventory([b2], [corrected, e2], []).resources.get(8)?.value).toBe(7);
  });

  it('P45：基準10、seq1消費4・seq2消費3。seq1を消費2へ訂正すると 10−2−3=5（旧消費4を重ねない）', () => {
    const res = baseline('resource:8', { value: 10 });
    const corrected = event(1, [screw(-2)], { revision: 2 });
    const e2 = event(2, [screw(-3)]);
    expect(projectInventory([res], [corrected, e2], []).resources.get(8)?.value).toBe(5);
  });

  it('P46：資材8を再取り込み（境界seq2）後に seq1 を消費2へ訂正しても最新8を維持する', () => {
    const res = baseline('resource:8', { value: 8, includedThroughSequence: 2 });
    const corrected = event(1, [screw(-2)], { revision: 2 });
    const e2 = event(2, [screw(-3)]);
    expect(projectInventory([res], [corrected, e2], []).resources.get(8)?.value).toBe(8);
  });

  it('P47：資材だけ境界seq2・装備は境界seq0。seq1 の成功を失敗へ訂正すると資材は最新値、装備は B−1/A＋1', () => {
    const eq = baseline('equipment', { includedThroughSequence: 0, equipment: { granularity: 'aggregate', buckets: [{ equipmentId: 1, star: 5, count: 1 }], instances: null } });
    const res = baseline('resource:8', { value: 6, includedThroughSequence: 2 });
    const success = event(1, [{ scope: 'equipment', equipmentId: 1, star: 5, amount: -1 }, { scope: 'equipment', equipmentId: 1, star: 6, amount: 1 }, screw(-4)]);
    const before = projectInventory([eq, res], [success], []);
    expect([before.equipment.counts.get('1:5') ?? 0, before.equipment.counts.get('1:6') ?? 0, before.resources.get(8)?.value]).toEqual([0, 1, 6]);
    // 失敗へ訂正：★は変わらず、資材の実消費だけ（資材は基準に含まれるので履歴のみ）
    const failed = event(1, [screw(-4)], { revision: 2, outcome: 'failure', historyOnlyScopes: ['resource:8'] });
    const after = projectInventory([eq, res], [failed], []);
    expect([after.equipment.counts.get('1:5') ?? 0, after.equipment.counts.get('1:6') ?? 0, after.resources.get(8)?.value]).toEqual([1, 0, 6]);
  });

  it('P50：装備の基準以前の成功を訂正しても現在数は変えない（過去の数量を逆算しない）', () => {
    const eq = baseline('equipment', { includedThroughSequence: 1, equipment: { granularity: 'aggregate', buckets: [{ equipmentId: 1, star: 6, count: 1 }], instances: null } });
    const failed = event(1, [], { revision: 2, outcome: 'failure', historyOnlyScopes: ['equipment'] });
    const p = projectInventory([eq], [failed], []);
    expect([p.equipment.counts.get('1:5') ?? 0, p.equipment.counts.get('1:6') ?? 0]).toEqual([0, 1]);
  });

  it('P15：資材だけ新基準でも装備の基準境界は別に判定する', () => {
    const eq = baseline('equipment', {
      includedThroughSequence: 0,
      equipment: { granularity: 'aggregate', buckets: [{ equipmentId: 1, star: 5, count: 2 }], instances: null },
    });
    const res = baseline('resource:8', { value: 10, includedThroughSequence: 1 });
    const e1 = event(1, [
      { scope: 'equipment', equipmentId: 1, star: 5, amount: -1 },
      { scope: 'equipment', equipmentId: 1, star: 6, amount: 1 },
      screw(-4),
    ]);
    const p = projectInventory([eq, res], [e1], []);
    expect(p.equipment.counts.get('1:5')).toBe(1);
    expect(p.equipment.counts.get('1:6')).toBe(1);
    expect(p.resources.get(8)?.value).toBe(10);
  });

  it('履歴のみ指定の scope は現在数に反映しない', () => {
    const res = baseline('resource:8', { value: 10 });
    const e1 = event(1, [screw(-4)], { historyOnlyScopes: ['resource:8'] });
    expect(projectInventory([res], [e1], []).resources.get(8)?.value).toBe(10);
  });

  it('無効化した実績は増減に含めない', () => {
    const res = baseline('resource:8', { value: 10 });
    const e1 = event(1, [screw(-4)], { status: 'voided' });
    expect(projectInventory([res], [e1], []).resources.get(8)?.value).toBe(10);
  });

  it('P58：資材の基準を更新しない取り込みでは既存の消費を保持する', () => {
    const res = baseline('resource:8', { value: 10 });
    const e1 = event(1, [screw(-4)]);
    expect(projectInventory([res], [e1], []).resources.get(8)?.value).toBe(6);
  });

  it('未取得の scope は不明。実績があっても 0 から数えない', () => {
    const e1 = event(1, [screw(-4)]);
    const p = projectInventory([], [e1], []);
    expect(p.resources.get(8)).toBeUndefined();
    expect(p.equipment.known).toBe(false);
    expect(p.ships.known).toBe(false);
  });

  it('P28：基準に包含済みの下書きから確定した実績は再減算しない', () => {
    const draft: DraftResult = {
      draftId: 'd1',
      attemptId: 'a1',
      stepKey: 's',
      occurredDateJst: '2026-10-14',
      occurredOrder: 1,
      reportedOutcome: 'failure',
      knownConsumptions: [],
      unknownScopes: ['resource:8'],
      scopeAnswers: {},
      createdRevision: 1,
      updatedRevision: 1,
      createdAt: '',
      status: 'finalized',
      cancelReason: null,
      recipeSnapshot: null,
    };
    const res = baseline('resource:8', { value: 10, includedThroughSequence: 0, includedDraftIds: ['d1'] });
    const e1 = event(1, [screw(-4)], { fromDraftId: 'd1' });
    expect(projectInventory([res], [e1], [draft]).resources.get(8)?.value).toBe(10);
  });

  it('未確定の下書きは在庫を確定変更せず、既知消費を保留・不明消費の scope を不明扱いにする', () => {
    const draft: DraftResult = {
      draftId: 'd1',
      attemptId: 'a1',
      stepKey: 's',
      occurredDateJst: '2026-10-14',
      occurredOrder: 1,
      reportedOutcome: 'failure',
      knownConsumptions: [screw(-4)],
      unknownScopes: ['resource:7'],
      scopeAnswers: {},
      createdRevision: 1,
      updatedRevision: 1,
      createdAt: '',
      status: 'open',
      cancelReason: null,
      recipeSnapshot: null,
    };
    const p = projectInventory([baseline('resource:8', { value: 10 }), baseline('resource:7', { value: 40 })], [], [draft]);
    expect(p.resources.get(8)?.value).toBe(10);
    expect(p.holds.get('resource:8')).toBe(4);
    expect(p.pendingUnknownScopes.has('resource:7')).toBe(true);
  });

  it('既知在庫が負になる場合は不整合として報告する', () => {
    const res = baseline('resource:8', { value: 2 });
    const p = projectInventory([res], [event(1, [screw(-4)])], []);
    expect(p.resources.get(8)?.value).toBe(-2);
    expect(p.negativeScopes).toContain('resource:8');
  });
});

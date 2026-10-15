import { describe, expect, it } from 'vitest';
import type { Baseline, ResultEvent } from '../model';
import { buildDeltas, dependentsOf, fixedHistoryOnlyScopes, scopesOfDeltas, validateCorrection, wouldGoNegative } from './results';
import { projectInventory } from '../inventory/projection';
import { baselinesFrom } from '../../test-support/planFixtures';

function ev(id: string, seq: number, partial: Partial<ResultEvent> = {}): ResultEvent {
  return {
    eventId: id,
    attemptId: `a-${id}`,
    stepKey: 's',
    goalId: 'g',
    originalSequence: seq,
    revision: 1,
    status: 'active',
    outcome: 'success',
    occurredDateJst: '2026-10-13',
    occurredOrder: seq,
    recordedAt: '',
    deltas: [],
    historyOnlyScopes: [],
    fromDraftId: null,
    recipeSnapshot: null,
    inputSourceEventIds: [],
    history: [],
    ...partial,
  };
}

describe('実績の増減', () => {
  it('成功は入力状態を1減らし出力状態を1増やす。素材と資材は入力した実消費だけ減らす', () => {
    const d = buildDeltas({
      transition: { kind: 'improve', equipmentId: 1, fromStar: 5, toStar: 6 },
      outcome: 'success',
      consumption: { resources: { 8: 4, 7: 6 }, equipment: [{ equipmentId: 2, star: 0, count: 2 }], useItems: {} },
    });
    expect(d).toEqual([
      { scope: 'equipment', equipmentId: 1, star: 5, amount: -1 },
      { scope: 'equipment', equipmentId: 1, star: 6, amount: 1 },
      { scope: 'equipment', equipmentId: 2, star: 0, amount: -2 },
      { scope: 'resource:7', amount: -6 },
      { scope: 'resource:8', amount: -4 },
    ]);
  });

  it('更新の成功は更新元★10を減らし、更新先をレシピの★で増やす', () => {
    const d = buildDeltas({ transition: { kind: 'convert', equipmentId: 10, toEquipmentId: 11, toStar: 0 }, outcome: 'success', consumption: { resources: {}, equipment: [], useItems: { 75: 1 } } });
    expect(d).toEqual([
      { scope: 'equipment', equipmentId: 10, star: 10, amount: -1 },
      { scope: 'equipment', equipmentId: 11, star: 0, amount: 1 },
      { scope: 'item:75', amount: -1 },
    ]);
  });

  it('失敗は★を変えず、入力した実消費だけを減らす（成功時の費用を写さない）', () => {
    const d = buildDeltas({ transition: { kind: 'improve', equipmentId: 1, fromStar: 5, toStar: 6 }, outcome: 'failure', consumption: { resources: { 8: 2 }, equipment: [], useItems: {} } });
    expect(d).toEqual([{ scope: 'resource:8', amount: -2 }]);
  });

  it('スキップは増減なし', () => {
    expect(buildDeltas({ transition: { kind: 'improve', equipmentId: 1, fromStar: 5, toStar: 6 }, outcome: 'skip', consumption: { resources: { 8: 2 }, equipment: [], useItems: {} } })).toEqual([]);
  });

  it('影響する scope を列挙する', () => {
    expect(scopesOfDeltas([{ scope: 'equipment', equipmentId: 1, star: 1, amount: 1 }, { scope: 'resource:8', amount: -1 }, { scope: 'resource:8', amount: -1 }])).toEqual(['equipment', 'resource:8']);
  });

  it('既知在庫を負にする新実績を検出する（不明在庫は検出対象外）', () => {
    const p = projectInventory(baselinesFrom({ equipment: [[1, 5, 1]], resources: { 8: 3 } }), [], []);
    expect(wouldGoNegative(p, [{ scope: 'resource:8', amount: -4 }])).toEqual(['resource:8']);
    expect(wouldGoNegative(p, [{ scope: 'resource:7', amount: -4 }])).toEqual([]);
    expect(wouldGoNegative(p, [{ scope: 'equipment', equipmentId: 1, star: 5, amount: -2 }])).toEqual(['equipment']);
  });

  it('確認待ちの下書きが確保した既知消費を差し引いて判定する（同じ在庫を二重に使わない）', () => {
    const draft = { draftId: 'd1', attemptId: 'a1', stepKey: 's', occurredDateJst: '2026-10-14', occurredOrder: 1, reportedOutcome: 'success' as const, knownConsumptions: [{ scope: 'resource:8' as const, amount: -4 }, { scope: 'equipment' as const, equipmentId: 2, star: 0, amount: -1 }], unknownScopes: [], scopeAnswers: {}, createdRevision: 1, updatedRevision: 1, createdAt: '', status: 'open' as const, cancelReason: null, recipeSnapshot: null };
    const p = projectInventory(baselinesFrom({ equipment: [[2, 0, 1]], resources: { 8: 5 } }), [], [draft]);
    // ネジ5のうち4は下書きが確保済み。別の実績が4消費すると足りない
    expect(wouldGoNegative(p, [{ scope: 'resource:8', amount: -4 }])).toEqual(['resource:8']);
    expect(wouldGoNegative(p, [{ scope: 'resource:8', amount: -1 }])).toEqual([]);
    expect(wouldGoNegative(p, [{ scope: 'equipment', equipmentId: 2, star: 0, amount: -1 }])).toEqual(['equipment']);
    // その下書き自身を確定するときは、自分の確保分を除いた投影で判定する
    const self = projectInventory(baselinesFrom({ equipment: [[2, 0, 1]], resources: { 8: 5 } }), [], []);
    expect(wouldGoNegative(self, [{ scope: 'resource:8', amount: -4 }])).toEqual([]);
  });
});

describe('訂正の基準境界と依存', () => {
  it('基準に包含済みの scope は履歴のみに固定する', () => {
    const b: Baseline[] = baselinesFrom({ resources: { 8: 10, 7: 5 } }).map((x) => (x.scope === 'resource:8' ? { ...x, includedThroughSequence: 2 } : x));
    expect(fixedHistoryOnlyScopes(ev('e', 1, { fromDraftId: null }), ['resource:8', 'resource:7'], b)).toEqual(['resource:8']);
  });

  it('P48：A の出力を B、B の出力を C が使うと、A の影響先は B と C', () => {
    const a = ev('A', 1);
    const b = ev('B', 2, { inputSourceEventIds: ['A'] });
    const c = ev('C', 3, { inputSourceEventIds: ['B'] });
    expect(dependentsOf('A', [a, b, c]).map((e) => e.eventId)).toEqual(['B', 'C']);
  });

  it('P18：A成功を失敗へ訂正するとき、A の出力を使った有効な実績があれば保存しない', () => {
    const a = ev('A', 1);
    const b = ev('B', 2, { inputSourceEventIds: ['A'] });
    const r = validateCorrection({ event: a, newOutcome: 'failure', newOccurredDate: a.occurredDateJst, events: [a, b] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.dependents.map((e) => e.eventId)).toEqual(['B']);
  });

  it('P49：後続より後の日付へ前提の成功を動かす訂正は保存しない', () => {
    const a = ev('A', 1, { occurredDateJst: '2026-10-12' });
    const b = ev('B', 2, { inputSourceEventIds: ['A'], occurredDateJst: '2026-10-13' });
    const r = validateCorrection({ event: a, newOutcome: 'success', newOccurredDate: '2026-10-14', events: [a, b] });
    expect(r.ok).toBe(false);
  });

  it('依存のない訂正は保存できる', () => {
    const a = ev('A', 1);
    expect(validateCorrection({ event: a, newOutcome: 'failure', newOccurredDate: a.occurredDateJst, events: [a] }).ok).toBe(true);
  });
});

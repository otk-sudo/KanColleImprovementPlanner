import { describe, expect, it } from 'vitest';
import { buildMasterIndex } from '../master';
import { fixtureMaster, FX } from '../../test-support/fixtureMaster';
import { baselinesFrom } from '../../test-support/planFixtures';
import { projectInventory } from '../inventory/projection';
import type { Protection, ResultEvent } from '../model';
import { applyImport, buildImportPreview, previewSourceByScope, protectionChangePreview } from './apply';
import { parseImportText } from './parse';

const m = buildMasterIndex(fixtureMaster());
const wrapSlot = (rows: unknown[]) => `svdata=${JSON.stringify({ api_result: 1, api_data: rows })}`;

function parsed(text: string, opts = {}) {
  const r = parseImportText(text, opts);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const screwEvent: ResultEvent = {
  eventId: 'e1',
  attemptId: 'a1',
  stepKey: 's',
  goalId: null,
  originalSequence: 1,
  revision: 1,
  status: 'active',
  outcome: 'failure',
  occurredDateJst: '2026-10-14',
  occurredOrder: 1,
  recordedAt: '',
  deltas: [{ scope: 'resource:8', amount: -4 }],
  historyOnlyScopes: [],
  fromDraftId: null,
  recipeSnapshot: null,
  inputSourceEventIds: [],
  history: [],
};

describe('取り込みのプレビュー', () => {
  it('資材だけの入力は資材を置き換え、装備・艦娘・アイテムは保持と表示する', () => {
    const baselines = baselinesFrom({ equipment: [[FX.mainGunA, 5, 2]], resources: { 8: 10 } });
    const proj = projectInventory(baselines, [screwEvent], []);
    const p = buildImportPreview([parsed('[{"api_id":8,"api_value":15},{"api_id":7,"api_value":55}]')], {}, proj, baselines, [], m);
    expect(p.items.map((i) => [i.scope, i.before, i.after])).toEqual([
      ['resource:7', null, 55],
      ['resource:8', 6, 15],
    ]);
    expect(p.kept).toEqual(['equipment', 'ships', 'items']);
    expect(p.noChange).toBe(false);
  });

  it('同じ scope を含む入力が複数あれば採用する入力の選択を求める', () => {
    const a = parsed('[{"api_id":8,"api_value":15}]');
    const b = parsed('[{"api_id":8,"api_value":20}]');
    const p = buildImportPreview([a, b], {}, projectInventory([], [], []), [], [], m);
    expect(p.conflicts).toEqual([{ scope: 'resource:8', sources: [0, 1] }]);
    const chosen = buildImportPreview([a, b], { 'resource:8': 1 }, projectInventory([], [], []), [], [], m);
    expect(chosen.conflicts).toEqual([]);
    expect(chosen.items[0]?.after).toBe(20);
  });

  it('解析時の注意（アイテムの部分応答など）を、採用した入力の分だけプレビューに残す', () => {
    const items = parsed(`svdata=${JSON.stringify({ api_result: 1, api_data: [{ api_id: 2, api_count: 3 }] })}`, { declaredKind: 'useItem' });
    const p = buildImportPreview([items], {}, projectInventory([], [], []), [], [], m);
    expect(p.parserWarnings.map((w) => w.code)).toEqual(['USEITEM_PARTIAL']);
    // 競合で採用しなかった入力の注意は出さない
    const other = parsed(`svdata=${JSON.stringify({ api_result: 1, api_data: [{ api_id: 2, api_count: 5 }] })}`, { declaredKind: 'useItem' });
    const chosen = buildImportPreview([items, other], { 'item:2': 1 }, projectInventory([], [], []), [], [], m);
    expect(chosen.parserWarnings).toHaveLength(1);
  });

  it('マスターにない装備IDは警告し、名称を推測しない', () => {
    const p = buildImportPreview([parsed('[{"id":99999,"lv":0}]')], {}, projectInventory([], [], []), [], [], m);
    expect(p.unknownIds.equipment).toEqual([99999]);
  });

  it('保護した個体が別の★へ移ったら、同じ★に別の個体が残っていても保護の確認が必要と表示する', () => {
    const prot: Protection = { bucket: `${FX.mainGunA}:0`, equipmentId: FX.mainGunA, star: 0, count: 1, instanceIds: [7], reason: '', reconciliationRequired: false, reconciliationSnapshotId: null, previousOwned: null, updatedAt: '' };
    const moved = parsed(wrapSlot([{ api_id: 7, api_slotitem_id: FX.mainGunA, api_level: 1 }, { api_id: 8, api_slotitem_id: FX.mainGunA, api_level: 0 }]));
    const p = buildImportPreview([moved], {}, projectInventory([], [], []), [], [prot], m);
    expect(p.protectionIssues.map((i) => [i.bucket, i.reason])).toEqual([[`${FX.mainGunA}:0`, 'INSTANCE_MISSING']]);
    // 同じ★のままなら確認不要
    const same = parsed(wrapSlot([{ api_id: 7, api_slotitem_id: FX.mainGunA, api_level: 0 }]));
    expect(buildImportPreview([same], {}, projectInventory([], [], []), [], [prot], m).protectionIssues).toEqual([]);
  });

  it('最新所持が手動保護を下回ると保護の確認が必要と表示する', () => {
    const baselines = baselinesFrom({ equipment: [[FX.mainGunA, 6, 3]] });
    const prot: Protection = { bucket: `${FX.mainGunA}:6`, equipmentId: FX.mainGunA, star: 6, count: 3, instanceIds: null, reason: '', reconciliationRequired: false, reconciliationSnapshotId: null, previousOwned: null, updatedAt: '' };
    const p = buildImportPreview([parsed(`[{"id":${FX.mainGunA},"lv":6},{"id":${FX.mainGunA},"lv":6}]`)], {}, projectInventory(baselines, [], []), baselines, [prot], m);
    expect(p.protectionIssues).toEqual([{ bucket: `${FX.mainGunA}:6`, equipmentId: FX.mainGunA, star: 6, previousOwned: 3, newOwned: 2, requested: 3, reason: 'COUNT_EXCEEDS' }]);
  });
});

describe('取り込みの反映', () => {
  it('P13/P16：反映した scope の基準を置換し、それまでの実績を基準に含める（同じ内容でも新しい基準）', () => {
    const baselines = baselinesFrom({ resources: { 8: 10 } });
    const r = applyImport({
      baselines,
      protections: [],
      updates: parsed('[{"api_id":8,"api_value":10}]').updates,
      sources: [{ kind: 'material', inputHash: 'h1', capturedAt: null }],
      now: '2026-10-14T03:00:00.000Z',
      snapshotId: 'snap-new',
      maxSequence: 1,
      openDraftIds: [],
    });
    const b = r.baselines.find((x) => x.scope === 'resource:8')!;
    expect(b.snapshotId).toBe('snap-new');
    expect(b.includedThroughSequence).toBe(1);
    expect(projectInventory(r.baselines, [screwEvent], []).resources.get(8)?.value).toBe(10);
    expect(r.changedScopes).toEqual(['resource:8']);
  });

  it('複数の入力を反映すると、scope ごとに採用した入力の種類とハッシュを基準に記録する（競合で2つ目を選んだ場合も）', () => {
    const equip = parsed(`[{"id":${FX.mainGunA},"lv":6}]`);
    const a = parsed('[{"api_id":8,"api_value":15}]');
    const b = parsed('[{"api_id":8,"api_value":20}]');
    const preview = buildImportPreview([equip, a, b], { 'resource:8': 2 }, projectInventory([], [], []), [], [], m);
    const sources = [equip, a, b].map((x) => ({ kind: x.kind, inputHash: x.inputHash, capturedAt: null }));
    const r = applyImport({ baselines: [], protections: [], updates: preview.updates, sources, sourceByScope: previewSourceByScope(preview), now: '2026-10-14T03:00:00.000Z', snapshotId: 'snap', maxSequence: 0, openDraftIds: [] });
    const screws = r.baselines.find((x) => x.scope === 'resource:8')!;
    expect(screws.value).toBe(20);
    expect([screws.sourceKind, screws.inputHash]).toEqual([b.kind, b.inputHash]);
    const eq = r.baselines.find((x) => x.scope === 'equipment')!;
    expect([eq.sourceKind, eq.inputHash]).toEqual([equip.kind, equip.inputHash]);
  });

  it('P58：更新対象がない入力は基準も境界も変えない', () => {
    const baselines = baselinesFrom({ resources: { 8: 10 } });
    const r = applyImport({ baselines, protections: [], updates: [], sources: [], now: '', snapshotId: 'x', maxSequence: 1, openDraftIds: [] });
    expect(r.changedScopes).toEqual([]);
    expect(r.baselines).toEqual(baselines);
  });

  it('反映前に存在する実施済み下書きを更新した scope の基準に含める（P28）', () => {
    const r = applyImport({ baselines: [], protections: [], updates: parsed('[{"api_id":8,"api_value":10}]').updates, sources: [], now: '', snapshotId: 's', maxSequence: 0, openDraftIds: ['d1'] });
    expect(r.baselines[0]?.includedDraftIds).toEqual(['d1']);
  });

  it('P40：保護3個に対し最新所持2個なら反映し、保護は確認待ちにする（減数しない）', () => {
    const baselines = baselinesFrom({ equipment: [[FX.mainGunA, 6, 3]] });
    const prot: Protection = { bucket: `${FX.mainGunA}:6`, equipmentId: FX.mainGunA, star: 6, count: 3, instanceIds: null, reason: '', reconciliationRequired: false, reconciliationSnapshotId: null, previousOwned: null, updatedAt: '' };
    const r = applyImport({ baselines, protections: [prot], updates: parsed(`[{"id":${FX.mainGunA},"lv":6},{"id":${FX.mainGunA},"lv":6}]`).updates, sources: [], now: '', snapshotId: 'snapX', maxSequence: 0, openDraftIds: [], previousCounts: new Map([[`${FX.mainGunA}:6`, 3]]) });
    expect(r.protections[0]).toMatchObject({ count: 3, reconciliationRequired: true, reconciliationSnapshotId: 'snapX', previousOwned: 3 });
    expect(r.baselines.find((b) => b.scope === 'equipment')?.equipment?.buckets).toEqual([{ equipmentId: FX.mainGunA, star: 6, count: 2 }]);
  });

  it('個体入力から集計入力へ変わると保護の対応を推測せず確認待ちにする', () => {
    const baselines = baselinesFrom({}).concat([
      {
        scope: 'equipment',
        snapshotId: 'old',
        importedAt: '',
        sourceCapturedAt: null,
        inputHash: '',
        sourceKind: 'slotItem',
        includedThroughSequence: 0,
        includedDraftIds: [],
        equipment: { granularity: 'instance', buckets: [{ equipmentId: 1, star: 0, count: 1 }], instances: [{ instanceId: 7, equipmentId: 1, star: 0 }] },
        ships: null,
        value: null,
      },
    ]);
    const prot: Protection = { bucket: '1:0', equipmentId: 1, star: 0, count: 1, instanceIds: [7], reason: '', reconciliationRequired: false, reconciliationSnapshotId: null, previousOwned: null, updatedAt: '' };
    const r = applyImport({ baselines, protections: [prot], updates: parsed('[{"id":1,"lv":0}]').updates, sources: [], now: '', snapshotId: 'n', maxSequence: 0, openDraftIds: [] });
    expect(r.protections[0]?.reconciliationRequired).toBe(true);
  });
});

describe('保護数の変更プレビュー（design/06・P52・P53）', () => {
  it('P52：所持2・手動3・目標1 → 手動2 で有効保護2、素材0', () => {
    expect(protectionChangePreview({ owned: 2, goalUse: 1, newManual: 2 })).toEqual({ effective: 2, materialAvailable: 0, overlapWithGoal: 1, valid: true });
  });
  it('P53：手動0 でも目標の1は残り、素材1', () => {
    expect(protectionChangePreview({ owned: 2, goalUse: 1, newManual: 0 })).toEqual({ effective: 1, materialAvailable: 1, overlapWithGoal: 0, valid: true });
  });
  it('最新所持を超える保護数は受け付けない', () => {
    expect(protectionChangePreview({ owned: 2, goalUse: 1, newManual: 3 }).valid).toBe(false);
  });
});

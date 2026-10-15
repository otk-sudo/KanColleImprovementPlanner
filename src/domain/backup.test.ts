import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, BACKUP_MAX_BYTES, BACKUP_SCHEMA_VERSION, parseBackup, readBackupFile, type BackupData } from './backup';
import { DEFAULT_SETTINGS } from './model';
import { baselinesFrom } from '../test-support/planFixtures';

function backup(partial: Partial<BackupData> = {}): BackupData {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '0.1.0',
    createdAt: '2026-10-13T12:00:00.000Z',
    datasetEpoch: 'epoch-1',
    masterVersion: 'm1',
    meta: { nextSequence: 1, lastProcessedDateJst: '2026-10-13', revision: 5 },
    baselines: baselinesFrom({ resources: { 8: 10 } }),
    resultEvents: [],
    drafts: [],
    attempts: [],
    goals: [],
    protections: [],
    settings: DEFAULT_SETTINGS,
    preferredHelpers: [],
    daySkips: [],
    ...partial,
  };
}

describe('バックアップの検証', () => {
  it('正常なバックアップを受け付ける', () => {
    const r = parseBackup(JSON.stringify(backup()), 'm1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.masterMissing).toBe(false);
  });

  it('P31：別のマスター版を参照するバックアップは復元可能だが計画は保留と判定する', () => {
    const r = parseBackup(JSON.stringify(backup({ masterVersion: 'old-master' })), 'm1');
    expect(r.ok && r.masterMissing).toBe(true);
  });

  it('壊れたファイル・別形式・新しい版を拒否する', () => {
    expect(parseBackup('{', 'm1')).toMatchObject({ ok: false, code: 'BACKUP_PARSE_ERROR' });
    expect(parseBackup('{"format":"x"}', 'm1')).toMatchObject({ ok: false, code: 'BACKUP_INVALID' });
    expect(parseBackup(JSON.stringify(backup({ schemaVersion: 99 })), 'm1')).toMatchObject({ ok: false, code: 'BACKUP_VERSION_UNSUPPORTED' });
  });

  it('参照の矛盾（存在しない試行を指す実績など）は全体を拒否する', () => {
    const bad = backup({
      meta: { nextSequence: 2, lastProcessedDateJst: null, revision: 1 },
      resultEvents: [
        {
          eventId: 'e1',
          attemptId: 'missing',
          stepKey: 's',
          goalId: null,
          originalSequence: 1,
          revision: 1,
          status: 'active',
          outcome: 'success',
          occurredDateJst: '2026-10-13',
          occurredOrder: 1,
          recordedAt: '',
          deltas: [],
          historyOnlyScopes: [],
          fromDraftId: null,
          recipeSnapshot: null,
          inputSourceEventIds: [],
          history: [],
        },
      ],
    });
    const r = parseBackup(JSON.stringify(bad), 'm1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join()).toContain('試行がありません');
  });

  it('試行と実績の対応が双方向で一致しないバックアップを拒否する', () => {
    const t = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const attempt = (attemptId: string, resultEventId: string | null) => ({ attemptId, stepKey: 's', goalId: 'g', transition: t, scheduledDate: '2026-10-13', dayOrder: 1, outcome: (resultEventId ? 'success' : 'none') as 'success' | 'none', lifecycle: 'active' as const, executionGate: 'ready' as const, predecessorAttemptId: null, createdAt: '', helperShipId: null, mode: 'normal' as const, resultEventId, cancelReason: null });
    const event = { eventId: 'e1', attemptId: 'A', stepKey: 's', goalId: 'g', originalSequence: 1, revision: 1, status: 'active' as const, outcome: 'success' as const, occurredDateJst: '2026-10-13', occurredOrder: 1, recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] };
    const meta = { nextSequence: 2, lastProcessedDateJst: null, revision: 1 };
    // 試行 B が、試行 A の実績 e1 を自分の結果として指している
    const crossed = parseBackup(JSON.stringify(backup({ meta, resultEvents: [event], attempts: [attempt('A', null), attempt('B', 'e1')] })), 'm1');
    expect(crossed.ok).toBe(false);
    // 有効な実績を、その試行が結果として指していない
    const unlinked = parseBackup(JSON.stringify(backup({ meta, resultEvents: [event], attempts: [attempt('A', null)] })), 'm1');
    expect(unlinked.ok).toBe(false);
    // 一致していれば受け付ける
    expect(parseBackup(JSON.stringify(backup({ meta, resultEvents: [event], attempts: [attempt('A', 'e1')] })), 'm1').ok).toBe(true);
  });

  it('開いている確認待ちの下書きは1つの試行に1つだけで、試行は確認待ちの結果になっている', () => {
    const t = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const attempt = (outcome: 'draft' | 'none') => ({ attemptId: 'A', stepKey: 's', goalId: 'g', transition: t, scheduledDate: '2026-10-13', dayOrder: 1, outcome, lifecycle: 'active' as const, executionGate: 'ready' as const, predecessorAttemptId: null, createdAt: '', helperShipId: null, mode: 'normal' as const, resultEventId: null, cancelReason: null });
    const draft = (draftId: string) => ({ draftId, attemptId: 'A', stepKey: 's', occurredDateJst: '2026-10-13', occurredOrder: 1, reportedOutcome: 'failure' as const, knownConsumptions: [], unknownScopes: [], scopeAnswers: {}, createdRevision: 1, updatedRevision: 1, createdAt: '', status: 'open' as const, cancelReason: null, recipeSnapshot: null });
    expect(parseBackup(JSON.stringify(backup({ attempts: [attempt('draft')], drafts: [draft('d1'), draft('d2')] })), 'm1').ok).toBe(false);
    expect(parseBackup(JSON.stringify(backup({ attempts: [attempt('none')], drafts: [draft('d1')] })), 'm1').ok).toBe(false);
    expect(parseBackup(JSON.stringify(backup({ attempts: [attempt('draft')], drafts: [] })), 'm1').ok).toBe(false);
    expect(parseBackup(JSON.stringify(backup({ attempts: [attempt('draft')], drafts: [draft('d1')] })), 'm1').ok).toBe(true);
  });

  it('マスターの参照がないバックアップは、別のマスターと同じく計画を保留する', () => {
    const r = parseBackup(JSON.stringify(backup({ masterVersion: null })), 'm1');
    expect(r.ok && r.masterMissing).toBe(true);
  });

  it('実績の元になった下書きは、同じ試行の確定済みの下書きでなければ拒否する', () => {
    const t = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const attempt = (attemptId: string, resultEventId: string | null) => ({ attemptId, stepKey: 's', goalId: 'g', transition: t, scheduledDate: '2026-10-13', dayOrder: 1, outcome: (resultEventId ? 'failure' : 'none') as 'failure' | 'none', lifecycle: 'active' as const, executionGate: 'ready' as const, predecessorAttemptId: null, createdAt: '', helperShipId: null, mode: 'normal' as const, resultEventId, cancelReason: null });
    const draft = (attemptId: string, status: 'finalized' | 'cancelled') => ({ draftId: 'd1', attemptId, stepKey: 's', occurredDateJst: '2026-10-13', occurredOrder: 1, reportedOutcome: 'failure' as const, knownConsumptions: [], unknownScopes: [], scopeAnswers: {}, createdRevision: 1, updatedRevision: 1, createdAt: '', status, cancelReason: null, recipeSnapshot: null });
    const event = { eventId: 'e1', attemptId: 'A', stepKey: 's', goalId: 'g', originalSequence: 1, revision: 1, status: 'active' as const, outcome: 'failure' as const, occurredDateJst: '2026-10-13', occurredOrder: 1, recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: 'd1', recipeSnapshot: null, inputSourceEventIds: [], history: [] };
    const meta = { nextSequence: 2, lastProcessedDateJst: null, revision: 1 };
    const attempts = [attempt('A', 'e1'), attempt('B', null)];
    expect(parseBackup(JSON.stringify(backup({ meta, attempts, resultEvents: [event], drafts: [draft('B', 'finalized')] })), 'm1').ok).toBe(false);
    expect(parseBackup(JSON.stringify(backup({ meta, attempts, resultEvents: [event], drafts: [draft('A', 'cancelled')] })), 'm1').ok).toBe(false);
    expect(parseBackup(JSON.stringify(backup({ meta, attempts, resultEvents: [event], drafts: [draft('A', 'finalized')] })), 'm1').ok).toBe(true);
  });

  it('有効な実績と、その試行の結果・状態が食い違うバックアップを拒否する', () => {
    const t = { kind: 'improve' as const, equipmentId: 1, fromStar: 0, toStar: 1 };
    const attempt = (outcome: 'success' | 'none', lifecycle: 'active' | 'cancelled' = 'active') => ({ attemptId: 'A', stepKey: 's', goalId: 'g', transition: t, scheduledDate: '2026-10-13', dayOrder: 1, outcome, lifecycle, executionGate: 'ready' as const, predecessorAttemptId: null, createdAt: '', helperShipId: null, mode: 'normal' as const, resultEventId: 'e1', cancelReason: null });
    const event = { eventId: 'e1', attemptId: 'A', stepKey: 's', goalId: 'g', originalSequence: 1, revision: 1, status: 'active' as const, outcome: 'success' as const, occurredDateJst: '2026-10-13', occurredOrder: 1, recordedAt: '', deltas: [], historyOnlyScopes: [], fromDraftId: null, recipeSnapshot: null, inputSourceEventIds: [], history: [] };
    const meta = { nextSequence: 2, lastProcessedDateJst: null, revision: 1 };
    expect(parseBackup(JSON.stringify(backup({ meta, resultEvents: [event], attempts: [attempt('none')] })), 'm1').ok).toBe(false);
    expect(parseBackup(JSON.stringify(backup({ meta, resultEvents: [event], attempts: [attempt('success', 'cancelled')] })), 'm1').ok).toBe(false);
    expect(parseBackup(JSON.stringify(backup({ meta, resultEvents: [event], attempts: [attempt('success')] })), 'm1').ok).toBe(true);
  });

  it('数量が負の基準在庫を拒否する', () => {
    const bad = backup({ baselines: baselinesFrom({ resources: { 8: 10 } }).map((b) => ({ ...b, value: -1 })) });
    expect(parseBackup(JSON.stringify(bad), 'm1').ok).toBe(false);
  });
});

describe('バックアップファイルの読み込み', () => {
  it('上限を超えるファイルは本文を読み込む前に拒否する（巨大なファイルでタブを固めない）', async () => {
    const huge = { size: BACKUP_MAX_BYTES + 1, text: () => Promise.reject(new Error('読み込んではいけない')) };
    expect(await readBackupFile(huge, 'm1')).toMatchObject({ ok: false, code: 'BACKUP_TOO_LARGE' });
    const ok = { size: 10, text: () => Promise.resolve(JSON.stringify(backup())) };
    expect((await readBackupFile(ok, 'm1')).ok).toBe(true);
  });
});

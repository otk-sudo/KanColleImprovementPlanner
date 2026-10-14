import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, parseBackup, type BackupData } from './backup';
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

  it('数量が負の基準在庫を拒否する', () => {
    const bad = backup({ baselines: baselinesFrom({ resources: { 8: 10 } }).map((b) => ({ ...b, value: -1 })) });
    expect(parseBackup(JSON.stringify(bad), 'm1').ok).toBe(false);
  });
});

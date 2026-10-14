import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, type BackupData } from '../domain/backup';
import type { AppData } from '../infrastructure/repository';

// バックアップの書き出し（design/10・14）。受付記録（commandReceipts）は別PCへ移さない。

export function buildBackup(data: AppData, masterVersion: string | null, appVersion: string, createdAt: string): BackupData {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion,
    createdAt,
    datasetEpoch: data.meta.datasetEpoch,
    masterVersion,
    meta: { nextSequence: data.meta.nextSequence, lastProcessedDateJst: data.meta.lastProcessedDateJst, revision: data.meta.revision },
    baselines: data.baselines,
    resultEvents: data.resultEvents,
    drafts: data.drafts,
    attempts: data.attempts,
    goals: data.goals,
    protections: data.protections,
    settings: data.settings,
    preferredHelpers: data.preferredHelpers,
    daySkips: data.daySkips,
  };
}

export function exportBackup(data: AppData, masterVersion: string | null, appVersion: string, createdAt: string): string {
  return JSON.stringify(buildBackup(data, masterVersion, appVersion, createdAt), null, 1);
}

export function backupFileName(createdAtIso: string): string {
  const d = new Date(Date.parse(createdAtIso) + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `kaishu-backup-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.json`;
}

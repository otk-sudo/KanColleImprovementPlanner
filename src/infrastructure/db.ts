import Dexie, { type Table } from 'dexie';
import type { Attempt, Baseline, DaySkip, DraftResult, Goal, PreferredHelper, Protection, ResultEvent, Settings } from '../domain/model';
import type { DateJst } from '../domain/jst';

// IndexedDB（Dexie）。GitHub Pages では同じユーザーの複数サイトが同一 origin になるため、
// プロジェクト固有の DB 名を使う（technology-selection 設計条件1）。

export const DB_NAME = 'kancolle-improvement-planner';
export const DB_SCHEMA_VERSION = 1;
/** この版のアプリが書き込める最小の互換版。DB の minimumWriterVersion がこれより大きければ読取専用 */
export const WRITER_VERSION = 1;

export interface RolloverReport {
  processedAt: string;
  today: DateJst;
  fromDates: { date: DateJst; count: number }[];
  successorAttemptIds: string[];
}

export interface Meta {
  key: 'singleton';
  datasetEpoch: string;
  revision: number;
  schemaVersion: number;
  minimumWriterVersion: number;
  nextSequence: number;
  lastProcessedDateJst: DateJst | null;
  planDirty: boolean;
  /** 計画に使っているマスターの版 */
  activeMasterVersion: string | null;
  /** 復元時に必要マスターがない・マスター更新の確認待ち。解消まで自動配置しない */
  masterReviewRequired: boolean;
  createdAt: string;
  lastClockMs: number;
  lastRollover: RolloverReport | null;
  clockWarning: string | null;
}

export interface CommandReceipt {
  datasetEpoch: string;
  commandId: string;
  commandType: string;
  payloadHash: string;
  savedRevision: number;
  result: unknown;
  savedAt: string;
}

export interface SettingsRow extends Settings {
  key: 'singleton';
}

export class KaishuDb extends Dexie {
  meta!: Table<Meta, string>;
  baselines!: Table<Baseline, string>;
  resultEvents!: Table<ResultEvent, string>;
  drafts!: Table<DraftResult, string>;
  attempts!: Table<Attempt, string>;
  goals!: Table<Goal, string>;
  protections!: Table<Protection, string>;
  settings!: Table<SettingsRow, string>;
  preferredHelpers!: Table<PreferredHelper, string>;
  daySkips!: Table<DaySkip, string>;
  commandReceipts!: Table<CommandReceipt, [string, string]>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(DB_SCHEMA_VERSION).stores({
      meta: 'key',
      baselines: 'scope',
      resultEvents: 'eventId, attemptId, originalSequence',
      drafts: 'draftId, attemptId, status',
      attempts: 'attemptId, stepKey, scheduledDate, goalId',
      goals: 'goalId',
      protections: 'bucket',
      settings: 'key',
      preferredHelpers: 'stepKey',
      daySkips: 'date',
      commandReceipts: '[datasetEpoch+commandId]',
    });
  }

  get businessTables() {
    return [this.meta, this.baselines, this.resultEvents, this.drafts, this.attempts, this.goals, this.protections, this.settings, this.preferredHelpers, this.daySkips, this.commandReceipts];
  }
}

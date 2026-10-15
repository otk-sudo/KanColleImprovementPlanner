import { canonicalJson, quickHash } from '../shared/hash';
import type { Attempt, Baseline, DaySkip, DraftResult, Goal, PreferredHelper, Protection, ResultEvent, Settings } from '../domain/model';
import { DEFAULT_SETTINGS } from '../domain/model';
import { DB_SCHEMA_VERSION, WRITER_VERSION, type CommandReceipt, type KaishuDb, type Meta } from './db';

// 全更新の共通契約（design/10「操作の共通契約」「再送判定の処理順」）。
// 1) writer互換性・datasetEpoch → 2) 受付済み commandId → 3) expectedRevision → 4) 業務検証と保存を1トランザクション。

export interface AppData {
  meta: Meta;
  baselines: Baseline[];
  resultEvents: ResultEvent[];
  drafts: DraftResult[];
  attempts: Attempt[];
  goals: Goal[];
  protections: Protection[];
  settings: Settings;
  preferredHelpers: PreferredHelper[];
  daySkips: DaySkip[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  fieldPath?: string;
  details?: unknown;
}

export interface Writes {
  put?: Partial<{
    baselines: Baseline[];
    resultEvents: ResultEvent[];
    drafts: DraftResult[];
    attempts: Attempt[];
    goals: Goal[];
    protections: Protection[];
    preferredHelpers: PreferredHelper[];
    daySkips: DaySkip[];
  }>;
  remove?: Partial<{ goals: string[]; protections: string[]; preferredHelpers: string[]; daySkips: string[]; baselines: string[] }>;
  settings?: Settings;
  meta?: Partial<Omit<Meta, 'key' | 'revision' | 'datasetEpoch'>>;
  /** 復元：全体を置換し、新しい datasetEpoch を発行する */
  replaceAll?: { data: Omit<AppData, 'meta'>; meta: Omit<Meta, 'key' | 'revision'> };
  /** 業務データを変更しない（revision・境界・planDirty を据え置き、再送識別用の受付記録だけ残す） */
  noChange?: boolean;
}

export type CommandOutcome<R> =
  | { status: 'APPLIED'; revision: number; result: R }
  | { status: 'ALREADY_APPLIED'; revision: number; result: R }
  | { status: 'CONFLICT'; revision: number }
  | { status: 'VALIDATION_ERROR'; errors: ValidationIssue[] }
  | { status: 'COMMAND_ID_REUSED' }
  | { status: 'EPOCH_MISMATCH' }
  | { status: 'WRITER_INCOMPATIBLE' }
  | { status: 'STORAGE_ERROR'; code: 'STORAGE_FULL' | 'STORAGE_ERROR'; retryable: boolean; message: string };

export interface CommandEnvelope<P> {
  commandId: string;
  commandType: string;
  datasetEpoch: string;
  expectedRevision: number;
  payload: P;
}

export type HandlerResult<R> = { ok: true; writes: Writes; result: R } | { ok: false; errors: ValidationIssue[] };
export type Handler<P, R> = (data: AppData, payload: P) => HandlerResult<R>;

export function newId(prefix: string): string {
  const c = globalThis.crypto;
  const id = c && 'randomUUID' in c ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function initialMeta(now: string, nowMs: number): Meta {
  return {
    key: 'singleton',
    datasetEpoch: newId('epoch'),
    revision: 0,
    schemaVersion: DB_SCHEMA_VERSION,
    minimumWriterVersion: WRITER_VERSION,
    nextSequence: 1,
    lastProcessedDateJst: null,
    planDirty: false,
    activeMasterVersion: null,
    masterReviewRequired: false,
    pendingMasterVersion: null,
    createdAt: now,
    lastClockMs: nowMs,
    lastRollover: null,
    clockWarning: null,
  };
}

export async function ensureInitialized(db: KaishuDb, now: string, nowMs: number): Promise<void> {
  await db.transaction('rw', db.meta, db.settings, async () => {
    const meta = await db.meta.get('singleton');
    if (!meta) {
      await db.meta.put(initialMeta(now, nowMs));
      await db.settings.put({ key: 'singleton', ...DEFAULT_SETTINGS });
    }
  });
}

async function readAll(db: KaishuDb): Promise<AppData> {
  const [meta, baselines, resultEvents, drafts, attempts, goals, protections, settings, preferredHelpers, daySkips] = await Promise.all([
    db.meta.get('singleton'),
    db.baselines.toArray(),
    db.resultEvents.toArray(),
    db.drafts.toArray(),
    db.attempts.toArray(),
    db.goals.toArray(),
    db.protections.toArray(),
    db.settings.get('singleton'),
    db.preferredHelpers.toArray(),
    db.daySkips.toArray(),
  ]);
  if (!meta) throw new Error('DB が初期化されていません');
  const { key: _key, ...settingsData } = settings ?? { key: 'singleton', ...DEFAULT_SETTINGS };
  return { meta, baselines, resultEvents, drafts, attempts, goals, protections, settings: settingsData, preferredHelpers, daySkips };
}

export async function loadData(db: KaishuDb): Promise<AppData> {
  return db.transaction('r', db.businessTables, () => readAll(db));
}

function isQuota(e: unknown): boolean {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
}

async function applyWrites(db: KaishuDb, meta: Meta, writes: Writes, now: string): Promise<Meta> {
  if (writes.replaceAll) {
    const { data, meta: newMeta } = writes.replaceAll;
    for (const t of [db.baselines, db.resultEvents, db.drafts, db.attempts, db.goals, db.protections, db.preferredHelpers, db.daySkips, db.commandReceipts]) await t.clear();
    await db.baselines.bulkPut(data.baselines);
    await db.resultEvents.bulkPut(data.resultEvents);
    await db.drafts.bulkPut(data.drafts);
    await db.attempts.bulkPut(data.attempts);
    await db.goals.bulkPut(data.goals);
    await db.protections.bulkPut(data.protections);
    await db.preferredHelpers.bulkPut(data.preferredHelpers);
    await db.daySkips.bulkPut(data.daySkips);
    await db.settings.put({ key: 'singleton', ...data.settings });
    const next: Meta = { ...newMeta, key: 'singleton', revision: meta.revision + 1 };
    await db.meta.put(next);
    return next;
  }
  const p = writes.put ?? {};
  if (p.baselines?.length) await db.baselines.bulkPut(p.baselines);
  if (p.resultEvents?.length) await db.resultEvents.bulkPut(p.resultEvents);
  if (p.drafts?.length) await db.drafts.bulkPut(p.drafts);
  if (p.attempts?.length) await db.attempts.bulkPut(p.attempts);
  if (p.goals?.length) await db.goals.bulkPut(p.goals);
  if (p.protections?.length) await db.protections.bulkPut(p.protections);
  if (p.preferredHelpers?.length) await db.preferredHelpers.bulkPut(p.preferredHelpers);
  if (p.daySkips?.length) await db.daySkips.bulkPut(p.daySkips);
  const r = writes.remove ?? {};
  if (r.goals?.length) await db.goals.bulkDelete(r.goals);
  if (r.protections?.length) await db.protections.bulkDelete(r.protections);
  if (r.preferredHelpers?.length) await db.preferredHelpers.bulkDelete(r.preferredHelpers);
  if (r.daySkips?.length) await db.daySkips.bulkDelete(r.daySkips);
  if (r.baselines?.length) await db.baselines.bulkDelete(r.baselines);
  if (writes.settings) await db.settings.put({ key: 'singleton', ...writes.settings });
  const next: Meta = { ...meta, ...writes.meta, key: 'singleton', datasetEpoch: meta.datasetEpoch, revision: meta.revision + 1 };
  void now;
  await db.meta.put(next);
  return next;
}

/** 業務の更新を1トランザクションで実行する */
export async function executeCommand<P, R>(db: KaishuDb, env: CommandEnvelope<P>, handler: Handler<P, R>, now: string): Promise<CommandOutcome<R>> {
  const payloadHash = quickHash(`${env.commandType}:${canonicalJson(env.payload)}`);
  try {
    return await db.transaction('rw', db.businessTables, async (): Promise<CommandOutcome<R>> => {
      const meta = await db.meta.get('singleton');
      if (!meta) throw new Error('DB が初期化されていません');
      if (meta.minimumWriterVersion > WRITER_VERSION || meta.schemaVersion > DB_SCHEMA_VERSION) return { status: 'WRITER_INCOMPATIBLE' };
      if (env.datasetEpoch !== meta.datasetEpoch) return { status: 'EPOCH_MISMATCH' };
      const receipt = await db.commandReceipts.get([meta.datasetEpoch, env.commandId]);
      if (receipt) {
        if (receipt.commandType === env.commandType && receipt.payloadHash === payloadHash) return { status: 'ALREADY_APPLIED', revision: receipt.savedRevision, result: receipt.result as R };
        return { status: 'COMMAND_ID_REUSED' };
      }
      if (env.expectedRevision !== meta.revision) return { status: 'CONFLICT', revision: meta.revision };
      const data = await readAll(db);
      const outcome = handler(data, env.payload);
      if (!outcome.ok) return { status: 'VALIDATION_ERROR', errors: outcome.errors };
      const next = outcome.writes.noChange ? meta : await applyWrites(db, meta, outcome.writes, now);
      if (!outcome.writes.replaceAll) {
        const r: CommandReceipt = { datasetEpoch: meta.datasetEpoch, commandId: env.commandId, commandType: env.commandType, payloadHash, savedRevision: next.revision, result: outcome.result, savedAt: now };
        await db.commandReceipts.put(r);
      }
      return { status: 'APPLIED', revision: next.revision, result: outcome.result };
    });
  } catch (e) {
    if (isQuota(e)) return { status: 'STORAGE_ERROR', code: 'STORAGE_FULL', retryable: true, message: 'ブラウザの保存容量が不足しています。不要なデータを整理してから再試行してください。' };
    return { status: 'STORAGE_ERROR', code: 'STORAGE_ERROR', retryable: true, message: `保存に失敗しました（${e instanceof Error ? e.name : '不明なエラー'}）。入力内容は保持しています。` };
  }
}

/** 計画の反映など、利用者の確定操作ではない内部更新（revision 一致時だけ保存） */
export async function executeInternal(db: KaishuDb, expectedRevision: number, build: (data: AppData) => Writes | null, now: string): Promise<'APPLIED' | 'NO_CHANGE' | 'CONFLICT' | 'STORAGE_ERROR'> {
  try {
    return await db.transaction('rw', db.businessTables, async () => {
      const meta = await db.meta.get('singleton');
      if (!meta) throw new Error('DB が初期化されていません');
      if (meta.minimumWriterVersion > WRITER_VERSION) return 'CONFLICT';
      if (meta.revision !== expectedRevision) return 'CONFLICT';
      const data = await readAll(db);
      const writes = build(data);
      if (!writes) return 'NO_CHANGE';
      await applyWrites(db, meta, writes, now);
      return 'APPLIED';
    });
  } catch {
    return 'STORAGE_ERROR';
  }
}

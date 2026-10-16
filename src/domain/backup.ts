import { z } from 'zod';
import { isValidDate } from './jst';
import { happenedBefore } from './results/results';
import { MAX_GOAL_COUNT, type Attempt, type Baseline, type DaySkip, type DraftResult, type Goal, type PreferredHelper, type Protection, type ResultEvent, type Settings } from './model';

// バックアップ（design/10・14）。生のAPIレスポンス・認証情報は含めない。
// 復元は全体検証後に一括置換し、未知の新しい版は拒否する。旧版は純粋な移行を順に適用する。

export const BACKUP_FORMAT = 'kaishu-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_MAX_BYTES = 30 * 1024 * 1024;

const date = z.string().refine(isValidDate, '日付の形式が不正です');
const nn = z.number().int().nonnegative();
const scopeKey = z.string().regex(/^(equipment|ships|resource:\d+|item:\d+)$/);

const transition = z.union([
  z.object({ kind: z.literal('improve'), equipmentId: z.number().int().positive(), fromStar: z.number().int().min(0).max(9), toStar: z.number().int().min(1).max(10) }),
  z.object({ kind: z.literal('convert'), equipmentId: z.number().int().positive(), toEquipmentId: z.number().int().positive(), toStar: z.number().int().min(0).max(10) }),
]);

const delta = z.union([
  z.object({ scope: z.literal('equipment'), equipmentId: z.number().int().positive(), star: z.number().int().min(0).max(10), amount: z.number().int() }),
  z.object({ scope: z.string().regex(/^(resource|item):\d+$/), amount: z.number().int() }),
]);

const plannedCost = z.object({
  fuel: nn,
  ammo: nn,
  steel: nn,
  bauxite: nn,
  devmats: nn,
  screws: nn,
  equipment: z.array(z.object({ equipmentId: z.number().int(), count: nn })),
  useItems: z.array(z.object({ useItemId: z.number().int(), count: nn })),
});

const recipeSnapshot = z
  .object({
    masterVersion: z.string(),
    transition,
    fromName: z.string(),
    toName: z.string(),
    mode: z.enum(['normal', 'guaranteed']),
    entryIndex: nn.nullable(),
    plannedCost: plannedCost.nullable(),
    helperShipId: z.number().int().nullable(),
    helperShipName: z.string().nullable(),
  })
  .nullable();

const baseline = z.object({
  scope: scopeKey,
  snapshotId: z.string(),
  importedAt: z.string(),
  sourceCapturedAt: z.string().nullable(),
  inputHash: z.string(),
  sourceKind: z.enum(['simpleEquipment', 'slotItem', 'requireInfo', 'port', 'material', 'useItem']),
  includedThroughSequence: nn,
  includedDraftIds: z.array(z.string()),
  equipment: z
    .object({
      granularity: z.enum(['aggregate', 'instance']),
      buckets: z.array(z.object({ equipmentId: z.number().int().positive(), star: z.number().int().min(0).max(10), count: nn })),
      instances: z.array(z.object({ instanceId: z.number().int().positive(), equipmentId: z.number().int().positive(), star: z.number().int().min(0).max(10) })).nullable(),
    })
    .nullable(),
  ships: z.array(z.object({ instanceId: z.number().int().positive(), shipId: z.number().int().positive() })).nullable(),
  value: nn.nullable(),
});

const revision = z.object({
  revision: z.number().int().positive(),
  outcome: z.enum(['success', 'failure', 'skip']),
  deltas: z.array(delta),
  historyOnlyScopes: z.array(scopeKey),
  occurredDateJst: date,
  savedAt: z.string(),
  reason: z.string().nullable(),
});

const resultEvent = z.object({
  eventId: z.string(),
  attemptId: z.string(),
  stepKey: z.string(),
  goalId: z.string().nullable(),
  originalSequence: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: z.enum(['active', 'voided']),
  outcome: z.enum(['success', 'failure', 'skip']),
  occurredDateJst: date,
  occurredOrder: nn,
  recordedAt: z.string(),
  deltas: z.array(delta),
  historyOnlyScopes: z.array(scopeKey),
  fromDraftId: z.string().nullable(),
  recipeSnapshot,
  inputSourceEventIds: z.array(z.string()),
  history: z.array(revision),
});

const draft = z.object({
  draftId: z.string(),
  attemptId: z.string(),
  stepKey: z.string(),
  occurredDateJst: date,
  occurredOrder: nn,
  reportedOutcome: z.enum(['success', 'failure']),
  knownConsumptions: z.array(delta),
  unknownScopes: z.array(scopeKey),
  scopeAnswers: z.record(z.string(), z.enum(['apply', 'historyOnly'])),
  createdRevision: nn,
  updatedRevision: nn,
  createdAt: z.string(),
  status: z.enum(['open', 'finalized', 'cancelled']),
  cancelReason: z.string().nullable(),
  recipeSnapshot,
});

const attempt = z.object({
  attemptId: z.string(),
  stepKey: z.string(),
  goalId: z.string(),
  transition,
  scheduledDate: date.nullable(),
  dayOrder: nn,
  outcome: z.enum(['none', 'success', 'failure', 'skip', 'draft']),
  lifecycle: z.enum(['active', 'superseded', 'cancelled']),
  executionGate: z.enum(['ready', 'predecessorPending', 'reviewRequired']),
  predecessorAttemptId: z.string().nullable(),
  createdAt: z.string(),
  helperShipId: z.number().int().nullable(),
  mode: z.enum(['normal', 'guaranteed']),
  resultEventId: z.string().nullable(),
  cancelReason: z.string().nullable(),
});

const goal = z.object({
  goalId: z.string(),
  equipmentId: z.number().int().positive(),
  targetStar: z.number().int().min(0).max(10),
  count: z.number().int().positive().max(MAX_GOAL_COUNT),
  matchMode: z.enum(['atLeast', 'exact']),
  priority: z.number().int().positive(),
  createdAt: z.string(),
  routeKey: z.string().regex(/^\d+(>\d+)*$/).nullable(),
  guarantee: z.object({ mode: z.enum(['never', 'always', 'fromTargetStar']), fromStar: z.number().int().min(1).max(10).nullable() }),
  updateGuarantee: z.boolean(),
  materialRoutes: z.record(z.string(), z.union([z.object({ kind: z.literal('external') }), z.object({ kind: z.literal('craft'), routeKey: z.string() })])),
  achievedAt: z.string().nullable(),
});

const protection = z.object({
  bucket: z.string().regex(/^\d+:\d+$/),
  equipmentId: z.number().int().positive(),
  star: z.number().int().min(0).max(10),
  count: nn,
  instanceIds: z.array(z.number().int()).nullable(),
  reason: z.string(),
  reconciliationRequired: z.boolean(),
  reconciliationSnapshotId: z.string().nullable(),
  previousOwned: nn.nullable(),
  updatedAt: z.string(),
});

const settings = z.object({
  weekdayLimits: z.array(z.number().int().min(0).max(99)).length(7),
  holidays: z.array(z.object({ holidayId: z.string(), start: date, end: date })),
  searchDays: z.number().int().min(1).max(3660),
});

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().positive(),
  appVersion: z.string(),
  createdAt: z.string(),
  datasetEpoch: z.string(),
  masterVersion: z.string().nullable(),
  meta: z.object({ nextSequence: z.number().int().positive(), lastProcessedDateJst: date.nullable(), revision: nn }),
  baselines: z.array(baseline),
  resultEvents: z.array(resultEvent),
  drafts: z.array(draft),
  attempts: z.array(attempt),
  goals: z.array(goal),
  protections: z.array(protection),
  settings,
  preferredHelpers: z.array(z.object({ stepKey: z.string(), shipId: z.number().int().positive() })),
  daySkips: z.array(z.object({ date, createdAt: z.string() })),
});

export interface BackupData {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  datasetEpoch: string;
  masterVersion: string | null;
  meta: { nextSequence: number; lastProcessedDateJst: string | null; revision: number };
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

export type BackupCheck =
  | { ok: true; backup: BackupData; masterMissing: boolean }
  | { ok: false; code: 'BACKUP_PARSE_ERROR' | 'BACKUP_VERSION_UNSUPPORTED' | 'BACKUP_INVALID' | 'BACKUP_TOO_LARGE'; message: string; issues: string[] };

/** 旧版からの移行（現在は版1のみ。追加時は純粋関数を順に適用する） */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

const TOO_LARGE: BackupCheck = { ok: false, code: 'BACKUP_TOO_LARGE', message: 'バックアップファイルが大きすぎます。', issues: [] };

/** バックアップファイルを読み込んで検証する。上限を超えるファイルは本文を読み込む前に拒否する */
export async function readBackupFile(file: { size: number; text(): Promise<string> }, currentMasterVersion: string): Promise<BackupCheck> {
  if (file.size > BACKUP_MAX_BYTES) return TOO_LARGE;
  return parseBackup(await file.text(), currentMasterVersion);
}

export function parseBackup(text: string, currentMasterVersion: string): BackupCheck {
  if (text.length > BACKUP_MAX_BYTES) return TOO_LARGE;
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, code: 'BACKUP_PARSE_ERROR', message: 'バックアップファイルを読み取れません。ファイルが壊れていないか確認してください。', issues: [] };
  }
  if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).format !== BACKUP_FORMAT) {
    return { ok: false, code: 'BACKUP_INVALID', message: 'このアプリのバックアップファイルではありません。', issues: [] };
  }
  let obj = raw as Record<string, unknown>;
  const version = obj.schemaVersion;
  if (typeof version !== 'number' || version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, code: 'BACKUP_VERSION_UNSUPPORTED', message: `このバックアップは新しい版（${String(version)}）で作成されています。アプリを更新してから復元してください。`, issues: [] };
  }
  for (let v = version; v < BACKUP_SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) return { ok: false, code: 'BACKUP_VERSION_UNSUPPORTED', message: `版${v}からの移行に対応していません。`, issues: [] };
    obj = { ...migrate(obj), schemaVersion: v + 1 };
  }
  const parsed = backupSchema.safeParse(obj);
  if (!parsed.success) {
    return { ok: false, code: 'BACKUP_INVALID', message: 'バックアップの内容に不正な項目があります。部分的な復元は行いません。', issues: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const b = parsed.data as BackupData;
  const issues = referentialIssues(b);
  if (issues.length > 0) return { ok: false, code: 'BACKUP_INVALID', message: 'バックアップ内の参照に矛盾があります。部分的な復元は行いません。', issues };
  // マスターの参照がない場合も、どのマスターで作った計画か分からないので計算を保留する
  return { ok: true, backup: b, masterMissing: b.masterVersion === null || b.masterVersion !== currentMasterVersion };
}

export function referentialIssues(b: BackupData): string[] {
  const issues: string[] = [];
  const attemptIds = new Set(b.attempts.map((a) => a.attemptId));
  const eventIds = new Set(b.resultEvents.map((e) => e.eventId));
  const unique = (label: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) issues.push(`${label}のIDが重複しています`);
  };
  unique('試行', b.attempts.map((a) => a.attemptId));
  unique('実績', b.resultEvents.map((e) => e.eventId));
  unique('下書き', b.drafts.map((d) => d.draftId));
  unique('目標', b.goals.map((g) => g.goalId));
  unique('基準在庫', b.baselines.map((x) => x.scope));
  unique('保護', b.protections.map((p) => p.bucket));
  const attemptById = new Map(b.attempts.map((a) => [a.attemptId, a]));
  const eventById = new Map(b.resultEvents.map((e) => [e.eventId, e]));
  for (const e of b.resultEvents) {
    if (!attemptIds.has(e.attemptId)) issues.push(`実績 ${e.eventId} の試行がありません`);
    // 有効な実績は、その試行が結果として指している（試行と実績の対応が双方向で一致する）
    else if (e.status === 'active' && attemptById.get(e.attemptId)!.resultEventId !== e.eventId) issues.push(`実績 ${e.eventId} がその試行の結果として登録されていません`);
    // 有効な実績の試行は、取り消されておらず、結果が実績と同じ
    else if (e.status === 'active' && (attemptById.get(e.attemptId)!.outcome !== e.outcome || attemptById.get(e.attemptId)!.lifecycle === 'cancelled')) issues.push(`実績 ${e.eventId} と試行 ${e.attemptId} の結果・状態が一致しません`);
    for (const s of e.inputSourceEventIds) {
      const src = eventById.get(s);
      if (!src) issues.push(`実績 ${e.eventId} の前提実績 ${s} がありません`);
      // 有効な実績の入力元は、それより前に起きた有効な成功だけ（記録で作れない依存を復元しない）。
      // 前後関係は厳密な順序なので、自分自身や循環する依存もここで拒否される
      else if (e.status === 'active' && (src.status !== 'active' || src.outcome !== 'success' || !happenedBefore({ date: src.occurredDateJst, order: src.occurredOrder }, { date: e.occurredDateJst, order: e.occurredOrder }))) issues.push(`実績 ${e.eventId} の前提実績 ${s} が、より前に起きた有効な成功ではありません`);
    }
    if (e.fromDraftId) {
      // 元になった下書きは同じ試行の確定済みの下書き（別の試行の下書きを指すと、取り込み済みの判定を取り違える）
      const d = b.drafts.find((x) => x.draftId === e.fromDraftId);
      if (!d) issues.push(`実績 ${e.eventId} の下書きがありません`);
      else if (d.attemptId !== e.attemptId || d.status !== 'finalized') issues.push(`実績 ${e.eventId} の下書き ${d.draftId} が同じ試行の確定済みの下書きではありません`);
    }
  }
  for (const d of b.drafts) if (!attemptIds.has(d.attemptId)) issues.push(`下書き ${d.draftId} の試行がありません`);
  // 開いている確認待ちの下書きは1つの試行に1つだけで、その試行は確認待ちの結果になっている（逆も同じ）
  const openByAttempt = new Map<string, number>();
  for (const d of b.drafts) if (d.status === 'open') openByAttempt.set(d.attemptId, (openByAttempt.get(d.attemptId) ?? 0) + 1);
  for (const [attemptId, n] of openByAttempt) {
    if (n > 1) issues.push(`試行 ${attemptId} に開いている確認待ちが複数あります`);
    const a = attemptById.get(attemptId);
    if (a && a.outcome !== 'draft') issues.push(`試行 ${attemptId} は確認待ちではないのに、開いている確認待ちがあります`);
  }
  for (const a of b.attempts) if (a.outcome === 'draft' && !openByAttempt.has(a.attemptId)) issues.push(`試行 ${a.attemptId} の確認待ちの記録がありません`);
  for (const a of b.attempts) {
    if (a.predecessorAttemptId && !attemptIds.has(a.predecessorAttemptId)) issues.push(`試行 ${a.attemptId} の前の試行がありません`);
    if (a.resultEventId && !eventIds.has(a.resultEventId)) issues.push(`試行 ${a.attemptId} の実績がありません`);
    else if (a.resultEventId && eventById.get(a.resultEventId)!.attemptId !== a.attemptId) issues.push(`試行 ${a.attemptId} が別の試行の実績を指しています`);
  }
  const maxSeq = Math.max(0, ...b.resultEvents.map((e) => e.originalSequence));
  if (b.meta.nextSequence <= maxSeq) issues.push('記録順の管理値が保存済みの実績より小さい');
  for (const x of b.baselines) {
    if (x.scope === 'equipment' && !x.equipment) issues.push('装備の基準在庫に内容がありません');
    if (x.scope === 'ships' && !x.ships) issues.push('艦娘の基準在庫に内容がありません');
    if (x.scope !== 'equipment' && x.scope !== 'ships' && x.value === null) issues.push(`${x.scope} の基準在庫に値がありません`);
  }
  return issues;
}

export interface BackupSummary {
  goals: number;
  results: number;
  drafts: number;
  scopes: string[];
  createdAt: string;
}

export function summarizeBackup(b: Pick<BackupData, 'goals' | 'resultEvents' | 'drafts' | 'baselines' | 'createdAt'>): BackupSummary {
  return {
    goals: b.goals.length,
    results: b.resultEvents.length,
    drafts: b.drafts.filter((d) => d.status === 'open').length,
    scopes: b.baselines.map((x) => x.scope),
    createdAt: b.createdAt,
  };
}

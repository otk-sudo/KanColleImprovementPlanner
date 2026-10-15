import { applyImport } from '../domain/import/apply';
import type { ImportKind } from '../domain/import/parse';
import { projectInventory } from '../domain/inventory/projection';
import { bucketKey, type ScopeKey, type ScopeUpdate } from '../domain/inventory/types';
import { compareDate, isValidDate, type DateJst } from '../domain/jst';
import { MAX_GOAL_COUNT, MAX_RECORD_AMOUNT, type Attempt, type Delta, type DraftResult, type Goal, type Holiday, type Outcome, type Protection, type RecipeSnapshot, type ResultEvent, type ResultRevision, type Settings } from '../domain/model';
import { fixedHistoryOnlyScopes, happenedBefore, inferInputSources, scopesOfDeltas, validateCorrection, wouldGoNegative } from '../domain/results/results';
import type { BackupData } from '../domain/backup';
import type { Meta } from '../infrastructure/db';
import type { AppData, HandlerResult, ValidationIssue } from '../infrastructure/repository';

// 業務操作のハンドラー（design/10 の操作一覧）。入力（payload）と保存済みデータだけで結果を決める純粋関数。
// ID や日時は呼び出し側で決めて payload に含め、再送時に同じ内容になるようにする。

const fail = (code: string, message: string, details?: unknown): HandlerResult<never> => ({ ok: false, errors: [{ code, message, ...(details !== undefined ? { details } : {}) }] });

function projection(data: AppData, excludeDraftId: string | null = null) {
  // 下書きを確定するときは、その下書き自身の確保分を除く（同じ消費を二重に引かない）
  return projectInventory(data.baselines, data.resultEvents, excludeDraftId ? data.drafts.filter((d) => d.draftId !== excludeDraftId) : data.drafts);
}


// ---------------- 取り込み ----------------
export interface ImportPayload {
  updates: ScopeUpdate[];
  sources: { kind: ImportKind; inputHash: string; capturedAt: string | null }[];
  /** scope ごとに採用した入力（sources の添字） */
  sourceByScope?: Partial<Record<ScopeKey, number>>;
  snapshotId: string;
  now: string;
}
export interface ImportResult {
  resultKind: 'APPLIED' | 'NO_CHANGE';
  changedScopes: ScopeKey[];
}
export function handleImport(data: AppData, p: ImportPayload): HandlerResult<ImportResult> {
  if (p.updates.length === 0) return { ok: true, writes: { noChange: true }, result: { resultKind: 'NO_CHANGE', changedScopes: [] } };
  const openDraftIds = data.drafts.filter((d) => d.status === 'open').map((d) => d.draftId);
  const r = applyImport({
    baselines: data.baselines,
    protections: data.protections,
    updates: p.updates,
    sources: p.sources,
    sourceByScope: p.sourceByScope,
    now: p.now,
    snapshotId: p.snapshotId,
    maxSequence: data.meta.nextSequence - 1,
    openDraftIds,
    previousCounts: projection(data).equipment.counts,
  });
  const changedBaselines = r.baselines.filter((b) => r.changedScopes.includes(b.scope));
  const changedProtections = r.protections.filter((p2, i) => p2 !== data.protections[i]);
  return {
    ok: true,
    writes: { put: { baselines: changedBaselines, protections: changedProtections }, meta: { planDirty: true } },
    result: { resultKind: 'APPLIED', changedScopes: r.changedScopes },
  };
}

// ---------------- 目標 ----------------
export interface SaveGoalPayload {
  goal: Goal;
  /** 新規なら挿入位置（1 が最優先）。既存の編集では goal.priority を使う */
  isNew: boolean;
}
export function handleSaveGoal(data: AppData, p: SaveGoalPayload): HandlerResult<{ goalId: string }> {
  const g = p.goal;
  if (!Number.isInteger(g.targetStar) || g.targetStar < 0 || g.targetStar > 10) return fail('INVALID_TARGET_STAR', '目標改修値は★0〜★MAXで指定してください。');
  if (!Number.isInteger(g.count) || g.count < 1 || g.count > MAX_GOAL_COUNT) return fail('INVALID_COUNT', `完成品として残す個数は1〜${MAX_GOAL_COUNT}の整数で指定してください。`);
  if (g.guarantee.mode === 'fromTargetStar' && (g.guarantee.fromStar === null || g.guarantee.fromStar < 1 || g.guarantee.fromStar > 10)) return fail('INVALID_GUARANTEE', '確実化する段階を選んでください。');
  const others = data.goals.filter((x) => x.goalId !== g.goalId).sort((a, b) => a.priority - b.priority);
  const position = Math.max(1, Math.min(g.priority, others.length + 1));
  const ordered = [...others];
  ordered.splice(position - 1, 0, g);
  const goals = ordered.map((x, i) => ({ ...x, priority: i + 1 }));
  const changed = goals.filter((x) => {
    const before = data.goals.find((y) => y.goalId === x.goalId);
    return !before || JSON.stringify(before) !== JSON.stringify(x);
  });
  if (!p.isNew && !data.goals.some((x) => x.goalId === g.goalId)) return fail('GOAL_NOT_FOUND', '編集対象の目標が見つかりません。別のタブで削除された可能性があります。');
  return { ok: true, writes: { put: { goals: changed }, meta: { planDirty: true } }, result: { goalId: g.goalId } };
}

export function handleDeleteGoal(data: AppData, p: { goalId: string; now: string }): HandlerResult<{ cancelled: number }> {
  if (!data.goals.some((g) => g.goalId === p.goalId)) return fail('GOAL_NOT_FOUND', '削除対象の目標が見つかりません。');
  const rest = data.goals.filter((g) => g.goalId !== p.goalId).sort((a, b) => a.priority - b.priority).map((g, i) => ({ ...g, priority: i + 1 }));
  const cancel = data.attempts
    .filter((a) => a.goalId === p.goalId && a.lifecycle === 'active' && a.outcome === 'none')
    .map((a) => ({ ...a, lifecycle: 'cancelled' as const, cancelReason: '目標を削除しました' }));
  const prefs = data.preferredHelpers.filter((h) => h.stepKey.startsWith(`${p.goalId}|`)).map((h) => h.stepKey);
  return { ok: true, writes: { put: { goals: rest, attempts: cancel }, remove: { goals: [p.goalId], preferredHelpers: prefs }, meta: { planDirty: true } }, result: { cancelled: cancel.length } };
}

export function handleReorderGoals(data: AppData, p: { goalIds: string[] }): HandlerResult<null> {
  const ids = new Set(data.goals.map((g) => g.goalId));
  if (p.goalIds.length !== ids.size || p.goalIds.some((id) => !ids.has(id))) return fail('GOALS_CHANGED', '目標の一覧が変わりました。最新の一覧で並べ替えてください。');
  const goals = p.goalIds.map((id, i) => ({ ...data.goals.find((g) => g.goalId === id)!, priority: i + 1 }));
  return { ok: true, writes: { put: { goals }, meta: { planDirty: true } }, result: null };
}

// ---------------- 保護 ----------------
export interface ProtectionPayload {
  equipmentId: number;
  star: number;
  count: number;
  instanceIds: number[] | null;
  reason: string;
  /** 保護の確認待ち（S33）を解消する */
  resolve: boolean;
  /** 確認画面を開いたときの装備の基準 snapshotId（P54） */
  snapshotId: string | null;
  now: string;
}
export function handleSetProtection(data: AppData, p: ProtectionPayload): HandlerResult<null> {
  const key = bucketKey(p.equipmentId, p.star);
  const proj = projection(data);
  const owned = Math.max(0, proj.equipment.counts.get(key) ?? 0);
  if (!Number.isInteger(p.count) || p.count < 0 || p.count > owned) return fail('INVALID_PROTECTION', `保護数は0〜${owned}個（最新の所持数以内）で指定してください。`);
  if (p.resolve && p.snapshotId !== proj.equipment.snapshotId) {
    return fail('SNAPSHOT_CHANGED', '確認画面を開いた後に所持データが更新されました。最新の所持数で確認し直してください。');
  }
  // 個体単位の所持では、保護する個体を個数ぶん重複なく、その装備・★の個体から選ぶ
  const bucketInstances = proj.equipment.granularity === 'instance' ? (proj.equipment.instances ?? []).filter((i) => i.equipmentId === p.equipmentId && i.star === p.star).map((i) => i.instanceId) : [];
  if (bucketInstances.length > 0 && p.count > 0) {
    const ids = p.instanceIds ?? [];
    if (ids.length !== p.count || new Set(ids).size !== ids.length || ids.some((id) => !bucketInstances.includes(id))) {
      return fail('INVALID_PROTECTION_INSTANCES', '保護する個体を、保護数と同じ数だけ（同じ個体を重ねず）この装備・★の個体から選んでください。');
    }
  }
  const existing = data.protections.find((x) => x.bucket === key);
  if (p.count === 0 && (!existing || p.resolve || !existing.reconciliationRequired)) {
    return { ok: true, writes: existing ? { remove: { protections: [key] }, meta: { planDirty: true } } : { noChange: true }, result: null };
  }
  const protection: Protection = {
    bucket: key,
    equipmentId: p.equipmentId,
    star: p.star,
    count: p.count,
    instanceIds: p.instanceIds,
    reason: p.reason,
    reconciliationRequired: p.resolve ? false : (existing?.reconciliationRequired ?? false),
    reconciliationSnapshotId: p.resolve ? null : (existing?.reconciliationSnapshotId ?? null),
    previousOwned: p.resolve ? null : (existing?.previousOwned ?? null),
    updatedAt: p.now,
  };
  return { ok: true, writes: { put: { protections: [protection] }, meta: { planDirty: true } }, result: null };
}

// ---------------- 設定 ----------------
export function handleSaveSettings(data: AppData, p: { weekdayLimits: number[]; searchDays: number }): HandlerResult<null> {
  if (p.weekdayLimits.length !== 7 || p.weekdayLimits.some((n) => !Number.isInteger(n) || n < 0 || n > 99)) return fail('INVALID_LIMIT', '曜日ごとの上限は0〜99の整数で指定してください（0は休み）。');
  if (!Number.isInteger(p.searchDays) || p.searchDays < 1 || p.searchDays > 3660) return fail('INVALID_SEARCH_DAYS', '探索期間は1〜3660日で指定してください。');
  const settings: Settings = { ...data.settings, weekdayLimits: p.weekdayLimits, searchDays: p.searchDays };
  return { ok: true, writes: { settings, meta: { planDirty: true } }, result: null };
}

export function handleAddHoliday(data: AppData, p: { holiday: Holiday }): HandlerResult<null> {
  const h = p.holiday;
  if (!isValidDate(h.start) || !isValidDate(h.end)) return fail('INVALID_DATE', '開始日と終了日を正しい日付で入力してください。');
  if (compareDate(h.start, h.end) > 0) return fail('INVALID_RANGE', '終了日は開始日以降にしてください。');
  return { ok: true, writes: { settings: { ...data.settings, holidays: [...data.settings.holidays, h] }, meta: { planDirty: true } }, result: null };
}

export function handleRemoveHoliday(data: AppData, p: { holidayId: string }): HandlerResult<null> {
  return { ok: true, writes: { settings: { ...data.settings, holidays: data.settings.holidays.filter((h) => h.holidayId !== p.holidayId) }, meta: { planDirty: true } }, result: null };
}

// ---------------- 実績 ----------------
export interface RecordResultPayload {
  attemptId: string;
  outcome: Outcome;
  occurredDateJst: DateJst;
  today: DateJst;
  deltas: Delta[];
  /** 利用者が「履歴だけに記録」と答えた scope */
  historyOnlyScopes: ScopeKey[];
  /** 過去実績・記録漏れでは全 scope の回答が必要 */
  requireScopeAnswers: boolean;
  answeredScopes: ScopeKey[];
  eventId: string;
  recipeSnapshot: RecipeSnapshot | null;
  inputSourceEventIds: string[];
  fromDraftId: string | null;
  now: string;
}
export interface RecordResultResult {
  eventId: string;
  cancelledSuccessors: string[];
}

/** 記録する実績の日内順（予定どおりの日なら予定の順番、別の日ならその日の記録の最大の日内順の後ろ） */
export function recordOrderFor(data: Pick<AppData, 'resultEvents'>, attempt: Attempt | null, occurredDateJst: DateJst): number {
  if (attempt && attempt.scheduledDate === occurredDateJst) return attempt.dayOrder;
  return data.resultEvents.filter((e) => e.occurredDateJst === occurredDateJst).reduce((max, e) => Math.max(max, e.occurredOrder), 0) + 1;
}

/**
 * 実施日時の順に、★別の装備の所持が途中で負にならないか（後の日付の成功だけが作った★を、それより前の日付で使わない）。
 * 装備の基準に取り込み済みの実績は基準に含まれるので順番の対象外。所持が不明なら判定しない。
 * baseAdjust は訂正で外す旧増減（訂正後の記録には旧実施がない）。訂正では旧実施と新実施の早い方から順に調べる。
 */
function chronologyShortfall(data: AppData, others: ResultEvent[], deltas: Delta[], at: { date: DateJst; order: number }, baseAdjust: Delta[] = [], oldAt: { date: DateJst; order: number } | null = null): string[] {
  const proj = projection(data);
  if (!proj.equipment.known) return [];
  const included = data.baselines.find((b) => b.scope === 'equipment')?.includedThroughSequence ?? 0;
  const sumByBucket = (list: Delta[]) => {
    const m = new Map<string, number>();
    for (const d of list) if (d.scope === 'equipment') m.set(bucketKey(d.equipmentId, d.star), (m.get(bucketKey(d.equipmentId, d.star)) ?? 0) + d.amount);
    return m;
  };
  const own = sumByBucket(deltas);
  const adjust = sumByBucket(baseAdjust);
  // 新しく使う★と、訂正で出力を外す★（その出力を途中で別の記録が使っていないか）を調べる
  const consumed = [...new Set([...own, ...adjust].filter(([, v]) => v < 0).map(([k]) => k))];
  if (consumed.length === 0) return [];
  const from = oldAt && happenedBefore(oldAt, at) ? oldAt : at;
  // 調べ始める時点以降の実績と、新しい実施（own）・旧実施の取り消し（adjust）を時刻順に並べる
  type Step = { date: DateJst; order: number; seq: number; m: Map<string, number> };
  const steps: Step[] = others
    .filter((e) => e.status === 'active' && e.originalSequence > included && !e.historyOnlyScopes.includes('equipment') && !happenedBefore({ date: e.occurredDateJst, order: e.occurredOrder }, from))
    .map((e) => ({ date: e.occurredDateJst, order: e.occurredOrder, seq: e.originalSequence, m: sumByBucket(e.deltas) }));
  // 調べ始める時点以降のほかの実績の増減（新しい実施・旧実施の取り消しを加える前に集計する）
  const laterSum = new Map(consumed.map((k) => [k, steps.reduce((n, x) => n + (x.m.get(k) ?? 0), 0)]));
  steps.push({ date: at.date, order: at.order, seq: -1, m: own });
  steps.sort((a, b) => compareDate(a.date, b.date) || a.order - b.order || a.seq - b.seq);
  const out: string[] = [];
  for (const k of consumed) {
    // 調べ始める時点の所持 = 現在の所持 − その時点以降のほかの実績の増減 − 旧実施の増減（訂正後の記録には旧実施がない）
    let running = (proj.equipment.counts.get(k) ?? 0) - laterSum.get(k)! + (adjust.get(k) ?? 0);
    for (const x of steps) {
      running += x.m.get(k) ?? 0;
      if (running < 0) {
        out.push(k);
        break;
      }
    }
  }
  return out;
}

/** 増減の数量が有限の整数で上限以内か（不正な値を保存してバックアップを復元できなくしない） */
function invalidAmount(deltas: Delta[]): boolean {
  return deltas.some((d) => !Number.isSafeInteger(d.amount) || Math.abs(d.amount) > MAX_RECORD_AMOUNT);
}
const MASTER_REVIEW_MESSAGE = '共通マスターの更新を確認するまで、改修結果は記録できません。設定の「共通マスター」で確認してから記録してください。';
const INVALID_AMOUNT_MESSAGE = `消費数は0〜${MAX_RECORD_AMOUNT.toLocaleString('ja-JP')}の整数で入力してください。`;

function seqOf(a: Attempt): number {
  return Number(a.attemptId.slice(a.attemptId.lastIndexOf('@') + 1)) || 0;
}

function laterAttempts(data: AppData, a: Attempt): Attempt[] {
  return data.attempts.filter((x) => x.stepKey === a.stepKey && seqOf(x) > seqOf(a));
}

export function handleRecordResult(data: AppData, p: RecordResultPayload): HandlerResult<RecordResultResult> {
  const attempt = data.attempts.find((a) => a.attemptId === p.attemptId);
  if (!attempt) return fail('ATTEMPT_NOT_FOUND', '対象の予定が見つかりません。別のタブで変更された可能性があります。');
  if (attempt.outcome !== 'none' && attempt.outcome !== 'draft') return fail('ALREADY_RECORDED', 'この予定には既に結果が記録されています。変更する場合は「実績・繰り越し」から記録を修正してください。');
  if (attempt.lifecycle === 'cancelled') return fail('ATTEMPT_CANCELLED', '取り消された予定には記録できません。');
  if (!isValidDate(p.occurredDateJst) || compareDate(p.occurredDateJst, p.today) > 0) return fail('FUTURE_DATE', '未来の日付には結果を記録できません。ゲームで実施した日を選んでください。');
  if (p.outcome === 'skip' && (attempt.scheduledDate !== p.today || p.occurredDateJst !== p.today)) return fail('SKIP_NOT_TODAY', 'スキップは当日の未実施の予定だけに記録できます。');
  if (p.outcome === 'skip' && p.deltas.length > 0) return fail('SKIP_HAS_CONSUMPTION', 'スキップでは資材・装備を消費しません。');
  if (invalidAmount(p.deltas)) return fail('INVALID_AMOUNT', INVALID_AMOUNT_MESSAGE);
  // マスター更新の確認待ちの間は、承認していないマスターの条件で結果を保存しない
  if (data.meta.masterReviewRequired) return fail('MASTER_REVIEW_REQUIRED', MASTER_REVIEW_MESSAGE);
  // 下書きの確定は日付が変わっても前提待ちを確認する
  if (attempt.executionGate === 'predecessorPending' && p.outcome !== 'skip' && (attempt.scheduledDate === p.today || p.fromDraftId !== null)) return fail('PREDECESSOR_PENDING', '前の工程の結果が確定していないため、この工程の結果は確定できません。');

  const scopes = scopesOfDeltas(p.deltas);
  const fixed = fixedHistoryOnlyScopes({ originalSequence: data.meta.nextSequence, fromDraftId: p.fromDraftId }, scopes, data.baselines);
  if (p.requireScopeAnswers) {
    const missing = scopes.filter((s) => !fixed.includes(s) && !p.answeredScopes.includes(s));
    if (missing.length > 0) return fail('SCOPE_UNANSWERED', '未回答の種類があるため実績を確定できません。', { missing });
  }
  const historyOnly = [...new Set([...fixed, ...p.historyOnlyScopes.filter((s) => scopes.includes(s))])];
  // 確認待ち（対象消失・担当艦や条件の不成立）の予定は、装備を履歴だけに記録する場合（取り込み前の記録漏れ）を除き確定しない
  if (attempt.executionGate === 'reviewRequired' && p.outcome !== 'skip' && !historyOnly.includes('equipment')) {
    return fail('REVIEW_REQUIRED', 'この予定は所持データの更新などで確認待ちです（改修対象・担当艦・保護の条件が変わりました）。取り込み前に実施した場合は「記録漏れ」を選び、装備を履歴だけに記録してください。');
  }

  // 繰越後の過去実績（S29）：成功なら結果のない後継を取消、結果のある後継は自動で取り消さない
  const cancelled: Attempt[] = [];
  if (p.outcome === 'success') {
    for (const s of laterAttempts(data, attempt)) {
      if (s.lifecycle !== 'active') continue;
      if (s.outcome === 'none') cancelled.push({ ...s, lifecycle: 'cancelled', cancelReason: '元の予定の実施を記録したため不要になった後継' });
      else return fail('SUCCESSOR_HAS_RESULT', '後継の予定に既に結果があるため、自動では取り消しません。実施内容を確認してください。', { successorAttemptId: s.attemptId, successorOutcome: s.outcome, successorDate: s.scheduledDate });
    }
  }

  const applied = p.deltas.filter((d) => !historyOnly.includes(d.scope));
  const negative = wouldGoNegative(projection(data, p.fromDraftId), applied);
  if (negative.length > 0) return fail('NEGATIVE_INVENTORY', '記録すると所持数が負になる項目があります。未記録の入手がないか、所持データが最新か確認してください。', { scopes: negative });

  const occurredOrder = recordOrderFor(data, attempt, p.occurredDateJst);
  if (!historyOnly.includes('equipment')) {
    const short = chronologyShortfall(data, data.resultEvents, applied, { date: p.occurredDateJst, order: occurredOrder });
    if (short.length > 0) return fail('BACKWARD_DEPENDENCY', 'この実施日の時点ではまだ持っていない装備を使う記録になります（後の日付の記録で作られた★です）。実施日を確認してください。', { buckets: short });
  }
  // 入力元（前の工程の成功・素材の製作）は、この実施より前に起きたものだけ（日付が逆向きの依存を保存しない）
  for (const id of p.inputSourceEventIds) {
    const src = data.resultEvents.find((e) => e.eventId === id);
    if (!src || src.status !== 'active' || !happenedBefore({ date: src.occurredDateJst, order: src.occurredOrder }, { date: p.occurredDateJst, order: occurredOrder })) {
      return fail('BACKWARD_DEPENDENCY', '前の工程の記録より前の日付には記録できません。実施日を確認してください。', { sourceEventId: id });
    }
  }
  const event: ResultEvent = {
    eventId: p.eventId,
    attemptId: attempt.attemptId,
    stepKey: attempt.stepKey,
    goalId: attempt.goalId,
    originalSequence: data.meta.nextSequence,
    revision: 1,
    status: 'active',
    outcome: p.outcome,
    occurredDateJst: p.occurredDateJst,
    occurredOrder,
    recordedAt: p.now,
    deltas: p.deltas,
    historyOnlyScopes: historyOnly,
    fromDraftId: p.fromDraftId,
    recipeSnapshot: p.recipeSnapshot,
    inputSourceEventIds: p.inputSourceEventIds,
    history: [],
  };
  const updatedAttempt: Attempt = { ...attempt, outcome: p.outcome, resultEventId: event.eventId };
  const drafts: DraftResult[] = [];
  if (p.fromDraftId) {
    const d = data.drafts.find((x) => x.draftId === p.fromDraftId);
    if (!d || d.status !== 'open') return fail('DRAFT_NOT_OPEN', '確認待ちの記録が見つかりません。');
    drafts.push({ ...d, status: 'finalized', updatedRevision: data.meta.revision + 1 });
  }
  return {
    ok: true,
    writes: { put: { resultEvents: [event], attempts: [updatedAttempt, ...cancelled], drafts }, meta: { nextSequence: data.meta.nextSequence + 1, planDirty: true } },
    result: { eventId: event.eventId, cancelledSuccessors: cancelled.map((c) => c.attemptId) },
  };
}

/** 日全体のスキップ（S25）：当日の未実施だけを対象にし、完了済みは変えない */
export function handleSkipDate(data: AppData, p: { date: DateJst; today: DateJst; eventIds: string[]; now: string }): HandlerResult<{ skipped: number }> {
  if (p.date !== p.today) return fail('SKIP_NOT_TODAY', '日全体のスキップは今日だけに記録できます。');
  const targets = data.attempts.filter((a) => a.scheduledDate === p.date && a.lifecycle === 'active' && a.outcome === 'none').sort((a, b) => a.dayOrder - b.dayOrder);
  if (p.eventIds.length < targets.length) return fail('IDS_MISSING', '内部エラー：記録IDが不足しています。');
  let seq = data.meta.nextSequence;
  const events: ResultEvent[] = targets.map((a, i) => ({
    eventId: p.eventIds[i]!,
    attemptId: a.attemptId,
    stepKey: a.stepKey,
    goalId: a.goalId,
    originalSequence: seq++,
    revision: 1,
    status: 'active',
    outcome: 'skip',
    occurredDateJst: p.date,
    occurredOrder: a.dayOrder,
    recordedAt: p.now,
    deltas: [],
    historyOnlyScopes: [],
    fromDraftId: null,
    recipeSnapshot: null,
    inputSourceEventIds: [],
    history: [],
  }));
  const attempts = targets.map((a, i) => ({ ...a, outcome: 'skip' as const, resultEventId: events[i]!.eventId }));
  return {
    ok: true,
    writes: { put: { resultEvents: events, attempts, daySkips: [{ date: p.date, createdAt: p.now }] }, meta: { nextSequence: seq, planDirty: true } },
    result: { skipped: targets.length },
  };
}

// ---------------- 結果確認待ち（下書き） ----------------
export interface SaveDraftPayload {
  draftId: string;
  attemptId: string;
  occurredDateJst: DateJst;
  today: DateJst;
  reportedOutcome: 'success' | 'failure';
  knownConsumptions: Delta[];
  unknownScopes: ScopeKey[];
  scopeAnswers: Partial<Record<ScopeKey, 'apply' | 'historyOnly'>>;
  confirmedPerformed: boolean;
  recipeSnapshot: RecipeSnapshot | null;
  now: string;
}
export function handleSaveDraft(data: AppData, p: SaveDraftPayload): HandlerResult<{ draftId: string }> {
  if (!p.confirmedPerformed) return fail('NOT_CONFIRMED', '「ゲームで実施済み」を確認してから保存してください。');
  if (invalidAmount(p.knownConsumptions)) return fail('INVALID_AMOUNT', INVALID_AMOUNT_MESSAGE);
  if (data.meta.masterReviewRequired) return fail('MASTER_REVIEW_REQUIRED', MASTER_REVIEW_MESSAGE);
  const attempt = data.attempts.find((a) => a.attemptId === p.attemptId);
  if (!attempt) return fail('ATTEMPT_NOT_FOUND', '対象の予定が見つかりません。');
  if (attempt.outcome !== 'none' && attempt.outcome !== 'draft') return fail('ALREADY_RECORDED', 'この予定には既に結果が記録されています。');
  if (compareDate(p.occurredDateJst, p.today) > 0) return fail('FUTURE_DATE', '未来の日付には記録できません。');
  // 前の工程の結果が確定していない予定は、実施済みとして消費を確保しない（記録画面と同じく日付によらず止める）
  if (attempt.executionGate === 'predecessorPending') return fail('PREDECESSOR_PENDING', '前の工程の結果が確定していないため、この工程を実施済みとして保存できません。');
  // 確認待ち（対象消失・条件不成立）の予定は、取り込み前の記録漏れとして装備を履歴だけに記録する場合だけ保存できる（結果の確定と同じ）
  if (attempt.executionGate === 'reviewRequired' && p.scopeAnswers.equipment !== 'historyOnly') {
    return fail('REVIEW_REQUIRED', 'この予定は所持データの更新などで確認待ちです。取り込み前に実施した場合は「記録漏れ」を選び、装備を履歴だけに記録してください。');
  }
  const existing = data.drafts.find((d) => d.attemptId === p.attemptId && d.status === 'open');
  const draft: DraftResult = {
    draftId: existing?.draftId ?? p.draftId,
    attemptId: attempt.attemptId,
    stepKey: attempt.stepKey,
    occurredDateJst: p.occurredDateJst,
    occurredOrder: attempt.dayOrder,
    reportedOutcome: p.reportedOutcome,
    knownConsumptions: p.knownConsumptions,
    unknownScopes: p.unknownScopes,
    scopeAnswers: p.scopeAnswers,
    createdRevision: existing?.createdRevision ?? data.meta.revision + 1,
    updatedRevision: data.meta.revision + 1,
    createdAt: existing?.createdAt ?? p.now,
    status: 'open',
    cancelReason: null,
    recipeSnapshot: p.recipeSnapshot,
  };
  // 繰越後の元の試行を確認待ちにした場合、結果が決まるまで同じ工程の後継を実行させない（元が成功なら後継は不要）
  const gatedSuccessors = laterAttempts(data, attempt).filter((x) => x.lifecycle === 'active' && x.outcome === 'none').map((x) => ({ ...x, executionGate: 'reviewRequired' as const }));
  return { ok: true, writes: { put: { drafts: [draft], attempts: [{ ...attempt, outcome: 'draft' }, ...gatedSuccessors] }, meta: { planDirty: true } }, result: { draftId: draft.draftId } };
}

export function handleCancelDraft(data: AppData, p: { draftId: string; reason: string; now: string }): HandlerResult<null> {
  if (p.reason.trim().length === 0) return fail('REASON_REQUIRED', '訂正理由を入力してください。');
  const d = data.drafts.find((x) => x.draftId === p.draftId);
  if (!d || d.status !== 'open') return fail('DRAFT_NOT_OPEN', '確認待ちの記録が見つかりません。');
  const attempt = data.attempts.find((a) => a.attemptId === d.attemptId);
  const attempts = attempt && attempt.outcome === 'draft' ? [{ ...attempt, outcome: 'none' as const }] : [];
  return { ok: true, writes: { put: { drafts: [{ ...d, status: 'cancelled', cancelReason: p.reason.trim(), updatedRevision: data.meta.revision + 1 }], attempts }, meta: { planDirty: true } }, result: null };
}

// ---------------- 訂正 ----------------
export interface CorrectPayload {
  eventId: string;
  newOutcome: Outcome | 'voided';
  newDeltas: Delta[];
  occurredDateJst: DateJst;
  historyOnlyScopes: ScopeKey[];
  reason: string;
  today: DateJst;
  now: string;
}
export function handleCorrectResult(data: AppData, p: CorrectPayload): HandlerResult<{ revision: number }> {
  const e = data.resultEvents.find((x) => x.eventId === p.eventId);
  if (!e || e.status !== 'active') return fail('EVENT_NOT_FOUND', '訂正対象の記録が見つかりません。');
  if (compareDate(p.occurredDateJst, p.today) > 0) return fail('FUTURE_DATE', '未来の日付には記録できません。');
  if (invalidAmount(p.newDeltas)) return fail('INVALID_AMOUNT', INVALID_AMOUNT_MESSAGE);
  const attempt = data.attempts.find((a) => a.attemptId === e.attemptId);
  const others = data.resultEvents.filter((x) => x.eventId !== e.eventId);
  // 実施日を変えたら、その日の記録の後ろ（予定どおりの日なら予定の順番）に日内順を付け直す
  const occurredOrder =
    p.occurredDateJst === e.occurredDateJst ? e.occurredOrder : recordOrderFor({ resultEvents: others }, attempt ?? null, p.occurredDateJst);
  const check = validateCorrection({ event: e, newOutcome: p.newOutcome, newOccurredDate: p.occurredDateJst, newOccurredOrder: occurredOrder, events: data.resultEvents });
  if (!check.ok) {
    return fail(check.reason, check.reason === 'DEPENDENT_RESULTS' ? 'この記録の結果を使った後続の実績があります。後続の記録から先に修正してください。' : '後続の実績より後の日付には変更できません。', {
      dependents: check.dependents.map((d) => ({ eventId: d.eventId, occurredDateJst: d.occurredDateJst, stepKey: d.stepKey, outcome: d.outcome })),
    });
  }
  const deltas = p.newOutcome === 'voided' ? [] : p.newDeltas;
  // 入力元は訂正後の消費と実施日時から推定し直す（消費しなくなった製作品の実績を拘束せず、新たに使う製作品を対応付ける）。
  // スキップは何も使わない。未実施への訂正は記録が無効になるため元の対応を履歴として残す
  let inputSourceEventIds = e.inputSourceEventIds;
  if (attempt && p.newOutcome !== 'voided') {
    const at = { date: p.occurredDateJst, order: occurredOrder };
    inputSourceEventIds = p.newOutcome === 'skip' ? [] : inferInputSources(others, attempt, deltas, at);
    // 元の入力元のうち今も必要なものが、訂正後の実施より後になる場合は保存しない
    const needed = p.newOutcome === 'skip' ? [] : inferInputSources(others, attempt, deltas, { date: '9999-12-31', order: Number.MAX_SAFE_INTEGER });
    const late = e.inputSourceEventIds
      .filter((id) => needed.includes(id))
      .map((id) => others.find((x) => x.eventId === id))
      .filter((x): x is ResultEvent => !!x && !happenedBefore({ date: x.occurredDateJst, order: x.occurredOrder }, at));
    if (late.length > 0) {
      return fail('ORDER_VIOLATION', '前の工程の記録より前の日付には変更できません。', {
        dependents: late.map((d) => ({ eventId: d.eventId, occurredDateJst: d.occurredDateJst, stepKey: d.stepKey, outcome: d.outcome })),
      });
    }
  }
  const scopes = scopesOfDeltas([...e.deltas, ...deltas]);
  const fixed = fixedHistoryOnlyScopes(e, scopes, data.baselines);
  const historyOnly = [...new Set([...fixed, ...p.historyOnlyScopes.filter((s) => scopes.includes(s)), ...e.historyOnlyScopes])];
  const proj = projection(data);
  // 旧増減を外して新増減を適用した結果が負にならないか（基準に含まれる scope は対象外）
  const reverse: Delta[] = e.deltas.filter((d) => !historyOnly.includes(d.scope)).map((d) => ({ ...d, amount: -d.amount }) as Delta);
  const forward = deltas.filter((d) => !historyOnly.includes(d.scope));
  const negative = wouldGoNegative(proj, [...reverse, ...forward]);
  if (negative.length > 0) return fail('NEGATIVE_INVENTORY', '訂正すると所持数が負になる項目があります。', { scopes: negative });
  if (!historyOnly.includes('equipment')) {
    const short = chronologyShortfall(data, others, forward, { date: p.occurredDateJst, order: occurredOrder }, reverse, { date: e.occurredDateJst, order: e.occurredOrder });
    if (short.length > 0) return fail('BACKWARD_DEPENDENCY', 'この実施日の時点ではまだ持っていない装備を使う訂正になります（後の日付の記録で作られた★です）。実施日を確認してください。', { buckets: short });
  }
  const prev: ResultRevision = { revision: e.revision, outcome: e.outcome, deltas: e.deltas, historyOnlyScopes: e.historyOnlyScopes, occurredDateJst: e.occurredDateJst, savedAt: e.recordedAt, reason: null };
  const corrected: ResultEvent = {
    ...e,
    revision: e.revision + 1,
    status: p.newOutcome === 'voided' ? 'voided' : 'active',
    outcome: p.newOutcome === 'voided' ? e.outcome : p.newOutcome,
    deltas,
    occurredDateJst: p.occurredDateJst,
    occurredOrder,
    inputSourceEventIds,
    historyOnlyScopes: historyOnly,
    recordedAt: p.now,
    history: [...e.history, { ...prev, reason: p.reason || null }],
  };
  const attempts: Attempt[] = [];
  if (attempt) attempts.push({ ...attempt, outcome: p.newOutcome === 'voided' ? 'none' : p.newOutcome, resultEventId: p.newOutcome === 'voided' ? null : e.eventId });
  // 成功へ訂正すると同じ工程の再挑戦・繰越の後継は不要になる。記録のときと同じく、結果のない後継は取り消し、
  // 結果のある後継があれば自動で取り消さず保存しない（同じ工程の成功と後継の結果を二重に持たない）
  if (attempt && p.newOutcome === 'success' && e.outcome !== 'success') {
    for (const s of laterAttempts(data, attempt)) {
      if (s.lifecycle !== 'active') continue;
      if (s.outcome === 'none') attempts.push({ ...s, lifecycle: 'cancelled', cancelReason: '元の記録を成功へ訂正したため不要になった後継' });
      else return fail('SUCCESSOR_HAS_RESULT', '同じ工程の後継の予定に既に結果があるため、成功へ訂正できません。後継の記録を先に確認してください。', { successorAttemptId: s.attemptId, successorOutcome: s.outcome, successorDate: s.scheduledDate });
    }
  }
  // 日単位のスキップの目印は、その日のスキップがほかに残っていない場合だけ外す（残っている間はその日に新しい予定を置かない）
  const otherSkips = others.some((x) => x.status === 'active' && x.outcome === 'skip' && x.occurredDateJst === e.occurredDateJst);
  const daySkips = p.newOutcome !== 'skip' && e.outcome === 'skip' && !otherSkips ? data.daySkips.filter((d) => d.date === e.occurredDateJst).map((d) => d.date) : [];
  return { ok: true, writes: { put: { resultEvents: [corrected], attempts }, remove: { daySkips }, meta: { planDirty: true } }, result: { revision: corrected.revision } };
}

// ---------------- 同日再挑戦・担当艦の希望 ----------------
export function handleSameDayRetry(data: AppData, p: { stepKey: string; attemptId: string; today: DateJst; limit: number; now: string }): HandlerResult<{ attemptId: string }> {
  const list = data.attempts.filter((a) => a.stepKey === p.stepKey).sort((a, b) => seqOf(a) - seqOf(b));
  const latest = list.at(-1);
  if (!latest || latest.outcome !== 'failure' || latest.scheduledDate !== p.today) return fail('NOT_FAILED_TODAY', '同日の再挑戦は、今日失敗した工程にだけ追加できます。');
  // 目標を削除した工程の失敗は履歴として残すだけで、再挑戦は作らない
  if (latest.goalId !== null && !data.goals.some((g) => g.goalId === latest.goalId)) return fail('GOAL_NOT_FOUND', 'この工程の目標は削除されているため、再挑戦を追加できません。');
  const used = data.attempts.filter((a) => a.scheduledDate === p.today && a.lifecycle !== 'cancelled' && a.lifecycle !== 'superseded').length;
  if (used >= p.limit) return fail('DAY_LIMIT', '今日の改修上限に達しているため追加できません。設定で上限を変更できます。');
  const maxOrder = Math.max(0, ...data.attempts.filter((a) => a.scheduledDate === p.today).map((a) => a.dayOrder));
  const retry: Attempt = {
    ...latest,
    attemptId: p.attemptId,
    scheduledDate: p.today,
    dayOrder: maxOrder + 1,
    outcome: 'none',
    lifecycle: 'active',
    executionGate: 'ready',
    predecessorAttemptId: latest.attemptId,
    createdAt: p.now,
    resultEventId: null,
    cancelReason: null,
  };
  return { ok: true, writes: { put: { attempts: [retry] }, meta: { planDirty: true } }, result: { attemptId: retry.attemptId } };
}

export function handleSetPreferredHelper(_data: AppData, p: { stepKey: string; shipId: number | null }): HandlerResult<null> {
  if (p.shipId === null) return { ok: true, writes: { remove: { preferredHelpers: [p.stepKey] }, meta: { planDirty: true } }, result: null };
  return { ok: true, writes: { put: { preferredHelpers: [{ stepKey: p.stepKey, shipId: p.shipId }] }, meta: { planDirty: true } }, result: null };
}

// ---------------- 復元・マスター ----------------
export interface RestorePayload {
  backup: BackupData;
  newEpoch: string;
  masterMissing: boolean;
  confirmedPlanHold: boolean;
  nowMs: number;
  now: string;
}
export function handleRestore(data: AppData, p: RestorePayload): HandlerResult<{ datasetEpoch: string }> {
  if (p.masterMissing && !p.confirmedPlanHold) return fail('PLAN_HOLD_NOT_CONFIRMED', '予定が保留のままになることを確認してください。');
  const b = p.backup;
  const maxSeq = Math.max(0, ...b.resultEvents.map((e) => e.originalSequence));
  const meta: Omit<Meta, 'key' | 'revision'> = {
    datasetEpoch: p.newEpoch,
    schemaVersion: data.meta.schemaVersion,
    minimumWriterVersion: data.meta.minimumWriterVersion,
    nextSequence: Math.max(b.meta.nextSequence, maxSeq + 1),
    lastProcessedDateJst: b.meta.lastProcessedDateJst,
    planDirty: true,
    activeMasterVersion: b.masterVersion,
    masterReviewRequired: p.masterMissing,
    createdAt: data.meta.createdAt,
    lastClockMs: p.nowMs,
    lastRollover: null,
    clockWarning: null,
  };
  return {
    ok: true,
    writes: {
      replaceAll: {
        data: {
          baselines: b.baselines,
          resultEvents: b.resultEvents,
          drafts: b.drafts,
          attempts: b.attempts,
          goals: b.goals,
          protections: b.protections,
          settings: b.settings,
          preferredHelpers: b.preferredHelpers,
          daySkips: b.daySkips,
        },
        meta,
      },
    },
    result: { datasetEpoch: p.newEpoch },
  };
}

/** 端末の時刻が戻ったことの警告を、利用者が確認した */
export function handleAcknowledgeClockWarning(data: AppData): HandlerResult<null> {
  if (data.meta.clockWarning === null) return { ok: true, writes: { noChange: true }, result: null };
  return { ok: true, writes: { meta: { clockWarning: null } }, result: null };
}

export function handleApplyMaster(_data: AppData, p: { masterVersion: string }): HandlerResult<null> {
  return { ok: true, writes: { meta: { activeMasterVersion: p.masterVersion, masterReviewRequired: false, planDirty: true } }, result: null };
}

export type { ValidationIssue };

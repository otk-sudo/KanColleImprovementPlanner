import { computeRollover } from '../domain/rollover';
import { compareDate, todayJst, type DateJst } from '../domain/jst';
import type { MasterIndex } from '../domain/master';
import type { Attempt } from '../domain/model';
import { projectInventory } from '../domain/inventory/projection';
import { buildPlan } from '../domain/planning/plan';
import type { PlanResult } from '../domain/planning/types';
import type { KaishuDb } from '../infrastructure/db';
import { ensureInitialized, executeCommand, executeInternal, loadData, newId, type AppData, type CommandOutcome, type Handler, type Writes } from '../infrastructure/repository';

// 操作の窓口：検証→保存→計画の再計算→再表示（design/01・03・10）。
// 計算は保存トランザクションの外で入力版を固定して行い、結果保存時に revision を再確認する。

export interface Clock {
  nowMs(): number;
}

export const systemClock: Clock = { nowMs: () => Date.now() };

export type RecalcStatus = 'UPDATED' | 'UNCHANGED' | 'MASTER_REVIEW' | 'FAILED' | 'CONFLICT' | 'STALE_MASTER';

export class AppService {
  constructor(
    readonly db: KaishuDb,
    readonly master: MasterIndex,
    readonly clock: Clock = systemClock,
  ) {}

  nowIso(): string {
    return new Date(this.clock.nowMs()).toISOString();
  }

  today(): DateJst {
    return todayJst(this.clock.nowMs());
  }

  async init(): Promise<void> {
    await ensureInitialized(this.db, this.nowIso(), this.clock.nowMs());
    // 同梱のマスターが変わったら、計画がある場合は計算保留にする。保存できないまま新しいマスターで計画を表示しない
    for (let i = 0; i < 4; i++) {
      const data = await loadData(this.db);
      if (data.meta.masterReviewRequired ? data.meta.pendingMasterVersion === this.master.version : data.meta.activeMasterVersion === this.master.version) return;
      const r = await executeInternal(
        this.db,
        data.meta.revision,
        (fresh) => {
          // 既に計算を保留している（マスターの参照がない復元を含む）なら、利用者が確認するまで保留を続け、確認待ちの版だけをこのタブの版にする。
          // 起動時の目録はキャッシュせずに読むので、起動したタブの版がいま配布中の版（確認待ちを始めた後の配布や、配布の差し戻し）。
          // 既に開いている古いタブは起動し直さないので、確認待ちの版と違うまま staleMaster で書き込みと適用を止める
          if (fresh.meta.masterReviewRequired) return fresh.meta.pendingMasterVersion === this.master.version ? null : { meta: { pendingMasterVersion: this.master.version } };
          const hasPlans = fresh.goals.length > 0 || fresh.attempts.length > 0;
          return {
            meta:
              hasPlans && fresh.meta.activeMasterVersion !== null
                ? { masterReviewRequired: true, pendingMasterVersion: this.master.version }
                : { activeMasterVersion: this.master.version, masterReviewRequired: fresh.meta.masterReviewRequired, planDirty: true },
          };
        },
        this.nowIso(),
      );
      if (r === 'APPLIED' || r === 'NO_CHANGE') return;
      if (r === 'STORAGE_ERROR') throw new Error('共通マスターの更新に伴う計算保留を保存できませんでした。保存容量やブラウザの設定を確認してから再読み込みしてください。保存済みのデータは変更していません。');
    }
    throw new Error('共通マスターの更新に伴う計算保留を保存できませんでした（別のタブと同時に更新しています）。再読み込みしてください。');
  }

  load(): Promise<AppData> {
    return loadData(this.db);
  }

  /** 計画で使う今日。端末の時刻が戻っても、処理済みの日付より前にはしない（予定を巻き戻さない） */
  planningToday(data: AppData): DateJst {
    const today = this.today();
    const processed = data.meta.lastProcessedDateJst;
    return processed && compareDate(today, processed) < 0 ? processed : today;
  }

  computePlan(data: AppData): PlanResult {
    return buildPlan({
      master: this.master,
      todayJst: this.planningToday(data),
      inventory: projectInventory(data.baselines, data.resultEvents, data.drafts),
      protections: data.protections,
      goals: data.goals,
      settings: data.settings,
      attempts: data.attempts,
      daySkips: data.daySkips,
      preferredHelpers: data.preferredHelpers,
      drafts: data.drafts,
      resultEvents: data.resultEvents,
    });
  }

  /**
   * このタブが読み込んだマスターが、保存されているデータの適用済み（または確認待ちの）マスターと違うか（別のタブが新しいマスターを読み込んだ後）。
   * 古いマスターで計画を書き換えないよう、書き込みと再計算を止めて再読み込みを求める
   */
  staleMaster(meta: AppData['meta']): boolean {
    // 確認待ちの間は、確認待ちを始めたマスターの版と違うタブ（古いマスターのタブ）を止める
    if (meta.masterReviewRequired) return !!meta.pendingMasterVersion && meta.pendingMasterVersion !== this.master.version;
    return meta.activeMasterVersion !== null && meta.activeMasterVersion !== this.master.version;
  }

  /** 利用者の確定操作を実行し、事実の保存に成功したら計画を再計算する */
  async run<P, R>(commandType: string, handler: Handler<P, R>, payload: P, base: { datasetEpoch: string; expectedRevision: number; commandId?: string }): Promise<CommandOutcome<R> & { recalc?: RecalcStatus; commandId: string }> {
    const commandId = base.commandId ?? newId('cmd');
    if (this.staleMaster((await loadData(this.db)).meta)) return { status: 'WRITER_INCOMPATIBLE', commandId };
    // 日付で決まる操作（スキップ・同日の再挑戦・記録など）は、画面の「今日」が実行時の日本時間の日付と同じときだけ受け付ける
    // （日付をまたいで開いていた画面から、日付の切り替えの処理より前に前日の操作として保存しない）
    const screenToday = (payload as { today?: unknown } | null)?.today;
    if (typeof screenToday === 'string' && screenToday !== this.today()) {
      return { status: 'VALIDATION_ERROR', errors: [{ code: 'DATE_CHANGED', message: '日本時間の日付が変わりました。最新の予定を確認してから、もう一度操作してください（この操作は保存していません）。' }], commandId };
    }
    const outcome = await executeCommand(this.db, { commandId, commandType, datasetEpoch: base.datasetEpoch, expectedRevision: base.expectedRevision, payload }, handler, this.nowIso());
    if (outcome.status === 'APPLIED' || outcome.status === 'ALREADY_APPLIED') {
      const recalc = await this.recalculate();
      return { ...outcome, recalc, commandId };
    }
    return { ...outcome, commandId };
  }

  /** 計画を計算し、当日の新規配置・将来の再配置・不要な予定の取消を保存する */
  async recalculate(): Promise<RecalcStatus> {
    for (let i = 0; i < 4; i++) {
      const data = await loadData(this.db);
      if (this.staleMaster(data.meta)) return 'STALE_MASTER';
      if (data.meta.masterReviewRequired) return 'MASTER_REVIEW';
      let plan: PlanResult;
      try {
        plan = this.computePlan(data);
      } catch {
        return 'FAILED';
      }
      const now = this.nowIso();
      const r = await executeInternal(this.db, data.meta.revision, (fresh) => writesFromPlan(plan, fresh, now), now);
      if (r === 'APPLIED') return 'UPDATED';
      if (r === 'NO_CHANGE') return 'UNCHANGED';
      if (r === 'STORAGE_ERROR') return 'FAILED';
    }
    return 'CONFLICT';
  }

  /**
   * 日本時間の翌日処理。起動・フォーカス復帰・日付変更で呼ぶ。複数タブでも後継は1つだけ。
   * saved=false は処理が必要だったのに保存できなかったこと（呼び出し側で利用者に知らせる）
   */
  async rollover(): Promise<{ moved: number; recalc: RecalcStatus | null; saved: boolean }> {
    const nowMs = this.clock.nowMs();
    const clockToday = todayJst(nowMs);
    const now = this.nowIso();
    let moved = 0;
    let saved = false;
    // 日付が進んだら、繰り越す予定がなくても再計算する（今日になった工程を記録できる予定として保存するため）
    let dateAdvanced = false;
    for (let i = 0; i < 4; i++) {
      const data = await loadData(this.db);
      // 処理済みの日付は戻さない（端末の時刻が日付をまたいで戻っても、翌日処理と予定を巻き戻さない）
      const last = data.meta.lastProcessedDateJst;
      const today = last && compareDate(clockToday, last) < 0 ? last : clockToday;
      const preview = computeRollover(data.attempts, today, now, new Set(data.goals.map((g) => g.goalId)));
      const clockBack = nowMs < data.meta.lastClockMs - 5 * 60 * 1000;
      // 移す予定も日付の変化もなく、時刻の警告も保存済みなら何も書かない（版を進めて開いている画面を競合させない）
      if (preview.successors.length === 0 && data.meta.lastProcessedDateJst === today && (!clockBack || data.meta.clockWarning !== null)) {
        saved = true;
        break;
      }
      const r = await executeInternal(
        this.db,
        data.meta.revision,
        (fresh) => {
          const rr = computeRollover(fresh.attempts, today, now, new Set(fresh.goals.map((g) => g.goalId)));
          moved = rr.successors.length;
          dateAdvanced = fresh.meta.lastProcessedDateJst !== today;
          return {
            put: { attempts: [...rr.superseded, ...rr.successors] },
            meta: {
              lastProcessedDateJst: today,
              // 日付が進んだら再計算が必要（失敗しても次の確認で再試行する）
              planDirty: fresh.meta.planDirty || rr.successors.length > 0 || fresh.meta.lastProcessedDateJst !== today,
              lastRollover: rr.successors.length > 0 ? { processedAt: now, today, fromDates: rr.fromDates, successorAttemptIds: rr.successors.map((s) => s.attemptId) } : fresh.meta.lastRollover,
              lastClockMs: Math.max(fresh.meta.lastClockMs, nowMs),
              clockWarning: clockBack ? '端末の時刻が前回より戻っています。記録と翌日処理は巻き戻しません。' : fresh.meta.clockWarning,
            },
          };
        },
        now,
      );
      if (r === 'APPLIED' || r === 'NO_CHANGE') {
        saved = true;
        break;
      }
      if (r === 'STORAGE_ERROR') return { moved: 0, recalc: 'FAILED', saved: false };
    }
    // 競合が続いて保存できなかった場合も、移したことにしない
    if (!saved) return { moved: 0, recalc: null, saved: false };
    const after = await loadData(this.db);
    const recalc = after.meta.planDirty || moved > 0 || dateAdvanced ? await this.recalculate() : null;
    return { moved, recalc, saved: true };
  }
}

/** 計画の変更を保存内容へ変換する。同じ工程に有効な次回試行を2つ作らない */
export function writesFromPlan(plan: PlanResult, data: AppData, now: string): Writes | null {
  const byId = new Map(data.attempts.map((a) => [a.attemptId, a]));
  const activeByStep = new Map<string, Attempt>();
  for (const a of data.attempts) if (a.lifecycle === 'active' && a.outcome === 'none') activeByStep.set(a.stepKey, a);
  const put: Attempt[] = [];
  for (const c of plan.attemptChanges.create) {
    if (byId.has(c.attemptId) || activeByStep.has(c.stepKey)) continue;
    put.push({ ...c, createdAt: now });
  }
  for (const u of plan.attemptChanges.update) {
    const a = byId.get(u.attemptId);
    if (!a || a.lifecycle !== 'active' || a.outcome !== 'none') continue;
    put.push({ ...a, scheduledDate: u.scheduledDate, dayOrder: u.dayOrder, helperShipId: u.helperShipId, mode: u.mode, executionGate: u.executionGate });
  }
  for (const c of plan.attemptChanges.cancel) {
    const a = byId.get(c.attemptId);
    if (!a || a.lifecycle !== 'active' || a.outcome !== 'none') continue;
    put.push({ ...a, lifecycle: 'cancelled', cancelReason: c.reason });
  }
  if (put.length === 0 && !data.meta.planDirty) return null;
  return { put: { attempts: put }, meta: { planDirty: false } };
}

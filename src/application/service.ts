import { computeRollover } from '../domain/rollover';
import { todayJst, type DateJst } from '../domain/jst';
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

export type RecalcStatus = 'UPDATED' | 'UNCHANGED' | 'MASTER_REVIEW' | 'FAILED' | 'CONFLICT';

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
    const data = await loadData(this.db);
    if (data.meta.activeMasterVersion === this.master.version) return;
    const hasPlans = data.goals.length > 0 || data.attempts.length > 0;
    await executeInternal(
      this.db,
      data.meta.revision,
      () => ({
        meta: hasPlans && data.meta.activeMasterVersion !== null ? { masterReviewRequired: true } : { activeMasterVersion: this.master.version, masterReviewRequired: data.meta.masterReviewRequired, planDirty: true },
      }),
      this.nowIso(),
    );
  }

  load(): Promise<AppData> {
    return loadData(this.db);
  }

  computePlan(data: AppData): PlanResult {
    return buildPlan({
      master: this.master,
      todayJst: this.today(),
      inventory: projectInventory(data.baselines, data.resultEvents, data.drafts),
      protections: data.protections,
      goals: data.goals,
      settings: data.settings,
      attempts: data.attempts,
      daySkips: data.daySkips,
      preferredHelpers: data.preferredHelpers,
      drafts: data.drafts,
    });
  }

  /** 利用者の確定操作を実行し、事実の保存に成功したら計画を再計算する */
  async run<P, R>(commandType: string, handler: Handler<P, R>, payload: P, base: { datasetEpoch: string; expectedRevision: number; commandId?: string }): Promise<CommandOutcome<R> & { recalc?: RecalcStatus; commandId: string }> {
    const commandId = base.commandId ?? newId('cmd');
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

  /** 日本時間の翌日処理。起動・フォーカス復帰・日付変更で呼ぶ。複数タブでも後継は1つだけ */
  async rollover(): Promise<{ moved: number; recalc: RecalcStatus | null }> {
    const nowMs = this.clock.nowMs();
    const today = todayJst(nowMs);
    const now = this.nowIso();
    let moved = 0;
    for (let i = 0; i < 4; i++) {
      const data = await loadData(this.db);
      const preview = computeRollover(data.attempts, today, now);
      const clockBack = nowMs < data.meta.lastClockMs - 5 * 60 * 1000;
      if (preview.successors.length === 0 && data.meta.lastProcessedDateJst === today && !clockBack) break;
      const r = await executeInternal(
        this.db,
        data.meta.revision,
        (fresh) => {
          const rr = computeRollover(fresh.attempts, today, now);
          moved = rr.successors.length;
          return {
            put: { attempts: [...rr.superseded, ...rr.successors] },
            meta: {
              lastProcessedDateJst: today,
              planDirty: fresh.meta.planDirty || rr.successors.length > 0,
              lastRollover: rr.successors.length > 0 ? { processedAt: now, today, fromDates: rr.fromDates, successorAttemptIds: rr.successors.map((s) => s.attemptId) } : fresh.meta.lastRollover,
              lastClockMs: Math.max(fresh.meta.lastClockMs, nowMs),
              clockWarning: clockBack ? '端末の時刻が前回より戻っています。記録と翌日処理は巻き戻しません。' : fresh.meta.clockWarning,
            },
          };
        },
        now,
      );
      if (r === 'APPLIED' || r === 'NO_CHANGE') break;
      if (r === 'STORAGE_ERROR') return { moved: 0, recalc: 'FAILED' };
    }
    const after = await loadData(this.db);
    const recalc = after.meta.planDirty || moved > 0 ? await this.recalculate() : null;
    return { moved, recalc };
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

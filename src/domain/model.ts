import type { DateJst } from './jst';
import type { ImportKind } from './import/parse';
import type { EquipmentBucket, EquipmentInstance, Granularity, ScopeKey, ShipEntry } from './inventory/types';
import type { Transition } from './master';

// 保存する業務レコード（DB製品に依存しない形）。design/02・06・10・12・14 に対応。

/** 対象範囲ごとの現在の基準在庫（最新として確定した JSON の内容） */
export interface Baseline {
  scope: ScopeKey;
  snapshotId: string;
  importedAt: string;
  /** データ内に取得日時がない入力では null。取込日時で代用しない */
  sourceCapturedAt: string | null;
  inputHash: string;
  sourceKind: ImportKind;
  /** この基準に含まれる（再適用しない）実績の originalSequence 上限 */
  includedThroughSequence: number;
  /** この基準に含まれる実施済み下書き */
  includedDraftIds: string[];
  equipment: { granularity: Granularity; buckets: EquipmentBucket[]; instances: EquipmentInstance[] | null } | null;
  ships: ShipEntry[] | null;
  value: number | null;
}

/** 実績による増減。amount は増加が正、消費が負 */
export type Delta =
  | { scope: 'equipment'; equipmentId: number; star: number; amount: number }
  | { scope: `resource:${number}` | `item:${number}`; amount: number };

export type Outcome = 'success' | 'failure' | 'skip';
export type AttemptOutcome = 'none' | Outcome | 'draft';
export type Lifecycle = 'active' | 'superseded' | 'cancelled';
export type ExecutionGate = 'ready' | 'predecessorPending' | 'reviewRequired';
export type GuaranteeMode = 'normal' | 'guaranteed';

/** 実績確定時のレシピの写し（新マスターで過去を再計算しない） */
export interface RecipeSnapshot {
  masterVersion: string;
  transition: Transition;
  fromName: string;
  toName: string;
  mode: GuaranteeMode;
  entryIndex: number | null;
  plannedCost: PlannedCost | null;
  helperShipId: number | null;
  helperShipName: string | null;
}

export interface PlannedCost {
  fuel: number;
  ammo: number;
  steel: number;
  bauxite: number;
  devmats: number;
  screws: number;
  equipment: { equipmentId: number; count: number }[];
  useItems: { useItemId: number; count: number }[];
}

export interface ResultRevision {
  revision: number;
  outcome: Outcome;
  deltas: Delta[];
  historyOnlyScopes: ScopeKey[];
  occurredDateJst: DateJst;
  savedAt: string;
  reason: string | null;
}

/** 成功・失敗・スキップの記録。訂正は revision を追加し、originalSequence を変えない */
export interface ResultEvent {
  eventId: string;
  attemptId: string;
  stepKey: string;
  goalId: string | null;
  originalSequence: number;
  revision: number;
  /** voided は「実施していなかった」等で無効化された記録（履歴は残す） */
  status: 'active' | 'voided';
  outcome: Outcome;
  occurredDateJst: DateJst;
  occurredOrder: number;
  recordedAt: string;
  deltas: Delta[];
  historyOnlyScopes: ScopeKey[];
  fromDraftId: string | null;
  recipeSnapshot: RecipeSnapshot | null;
  /** この実績の改修対象・素材がどの実績の出力か（訂正時の依存検査に使う） */
  inputSourceEventIds: string[];
  history: ResultRevision[];
}

/** 実施したが消費などを確定できない記録（design/12） */
export interface DraftResult {
  draftId: string;
  attemptId: string;
  stepKey: string;
  occurredDateJst: DateJst;
  occurredOrder: number;
  reportedOutcome: 'success' | 'failure';
  knownConsumptions: Delta[];
  unknownScopes: ScopeKey[];
  /** 過去実績の scope 回答（S34）。未回答は含まない */
  scopeAnswers: Partial<Record<ScopeKey, 'apply' | 'historyOnly'>>;
  createdRevision: number;
  updatedRevision: number;
  createdAt: string;
  status: 'open' | 'finalized' | 'cancelled';
  cancelReason: string | null;
  recipeSnapshot: RecipeSnapshot | null;
}

export interface Attempt {
  attemptId: string;
  stepKey: string;
  goalId: string;
  transition: Transition;
  /** 未配置は null */
  scheduledDate: DateJst | null;
  dayOrder: number;
  outcome: AttemptOutcome;
  lifecycle: Lifecycle;
  executionGate: ExecutionGate;
  predecessorAttemptId: string | null;
  createdAt: string;
  /** 配置時の担当艦・費用・不足（表示用の写し。計画の再計算で更新） */
  helperShipId: number | null;
  mode: GuaranteeMode;
  resultEventId: string | null;
  cancelReason: string | null;
}

export interface GuaranteePolicy {
  mode: 'never' | 'always' | 'fromTargetStar';
  fromStar: number | null;
}

export type MaterialRouteChoice = { kind: 'external' } | { kind: 'craft'; routeKey: string };

export interface Goal {
  goalId: string;
  equipmentId: number;
  targetStar: number;
  count: number;
  matchMode: 'atLeast' | 'exact';
  priority: number;
  createdAt: string;
  /** 更新経路（上流>…>目標）。null は対象装備のみ */
  routeKey: string | null;
  guarantee: GuaranteePolicy;
  updateGuarantee: boolean;
  materialRoutes: Record<string, MaterialRouteChoice>;
  achievedAt: string | null;
}

/** 手動保護（装備ID・★ごと。個体入力では個体IDも保持） */
export interface Protection {
  bucket: string;
  equipmentId: number;
  star: number;
  count: number;
  instanceIds: number[] | null;
  reason: string;
  /** 取込で所持数を超えた・粒度が変わった等で確認待ち */
  reconciliationRequired: boolean;
  /** 不一致を検出した基準の snapshotId */
  reconciliationSnapshotId: string | null;
  previousOwned: number | null;
  updatedAt: string;
}

export interface Holiday {
  holidayId: string;
  start: DateJst;
  end: DateJst;
}

export interface Settings {
  /** 0=日〜6=土。0 は休み */
  weekdayLimits: number[];
  holidays: Holiday[];
  searchDays: number;
}

export interface PreferredHelper {
  stepKey: string;
  shipId: number;
}

export interface DaySkip {
  date: DateJst;
  createdAt: string;
}

/** 目標の個数の上限（バックアップの形式と同じ。これを超えると書き出したバックアップを復元できない） */
export const MAX_GOAL_COUNT = 9999;

/** 1回の記録で入力できる消費数の上限（桁が多すぎて無限大になる値などを保存しない） */
export const MAX_RECORD_AMOUNT = 999_999;

export const DEFAULT_SETTINGS: Settings = {
  weekdayLimits: [2, 2, 2, 2, 2, 2, 2],
  holidays: [],
  searchDays: 366,
};

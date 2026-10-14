import type { InventoryProjection } from '../inventory/projection';
import type { DateJst } from '../jst';
import type { AttemptCost, MasterIndex, Transition } from '../master';
import type { Attempt, DaySkip, DraftResult, ExecutionGate, Goal, GuaranteeMode, PreferredHelper, Protection, Settings } from '../model';

export interface PlanInput {
  master: MasterIndex;
  todayJst: DateJst;
  inventory: InventoryProjection;
  protections: Protection[];
  goals: Goal[];
  settings: Settings;
  attempts: Attempt[];
  daySkips: DaySkip[];
  preferredHelpers: PreferredHelper[];
  drafts: DraftResult[];
}

/** 未配置理由（design/09）。資材不足は警告であり、この一覧に含めない。 */
export type UnplacedReason =
  | 'HELPER_UNKNOWN'
  | 'HELPER_MISSING'
  | 'REMODEL_MISMATCH'
  | 'RECIPE_UNKNOWN'
  | 'ROUTE_REQUIRED'
  | 'TARGET_MISSING'
  | 'CYCLE'
  | 'PREDECESSOR_BLOCKED'
  | 'NO_AVAILABLE_DAY'
  | 'SEARCH_LIMIT'
  | 'COMPUTATION_LIMIT'
  | 'EQUIPMENT_UNKNOWN'
  | 'PREFERRED_HELPER_UNAVAILABLE'
  | 'PROTECTION_REVIEW'
  | 'RESULT_PENDING'
  | 'SKIPPED_TODAY';

export const UNPLACED_REASON_LABELS: Record<UnplacedReason, string> = {
  HELPER_UNKNOWN: '艦娘の所持情報が未取得',
  HELPER_MISSING: '担当艦を所持していない',
  REMODEL_MISMATCH: '担当艦の改造段階が条件と異なる',
  RECIPE_UNKNOWN: '改修条件を確認中',
  ROUTE_REQUIRED: '更新経路の選択が必要',
  TARGET_MISSING: '改修対象を所持していない',
  CYCLE: '素材の製作経路が循環している',
  PREDECESSOR_BLOCKED: '前の工程を配置できない',
  NO_AVAILABLE_DAY: '担当艦の曜日と実施できる日が重ならない',
  SEARCH_LIMIT: '探索期間内に空きがない',
  COMPUTATION_LIMIT: '計算の上限に達した',
  EQUIPMENT_UNKNOWN: '所持装備が未取得',
  PREFERRED_HELPER_UNAVAILABLE: '希望した担当艦が条件に合わない',
  PROTECTION_REVIEW: '保護設定の確認待ち',
  RESULT_PENDING: '前の工程の結果確認待ち',
  SKIPPED_TODAY: '今日はスキップ済み（翌日に再配置）',
};

export type CostKey = `resource:${number}` | `item:${number}` | `equipment:${number}`;

export interface HelperCandidate {
  shipId: number;
  entryIndex: number;
  days: number[];
}

export interface PlanStep {
  stepKey: string;
  goalId: string;
  /** 'target' は目標の改修対象、'craft' は素材の製作 */
  role: 'target' | 'craft';
  craftFor: number | null;
  transition: Transition;
  transitionKey: string;
  ordinal: number;
  predecessorKeys: string[];
  /** 同じ鎖の何番目の工程か（0 始まり） */
  chainIndex: number;
  chainId: string;
  mode: GuaranteeMode;
  /** 担当艦が所属するエントリごとの費用。全候補で同じなら costVaries=false */
  defaultCost: AttemptCost | null;
  costVaries: boolean;
  helperCandidates: HelperCandidate[];
  /** 担当艦を選べない場合の理由（配置前に判明するもの） */
  blockers: UnplacedReason[];
  /** 改造段階不一致などの補足（必要な艦名など） */
  helperNote: HelperNote | null;
  earliestDate: DateJst;
}

export interface HelperNote {
  requiredShipIds: number[];
  ownedFamilyShipIds: number[];
  preferredShipId: number | null;
}

export interface ConsumedItem {
  key: CostKey;
  amount: number;
  /** 装備素材の★内訳（低い★から） */
  stars?: { star: number; count: number }[];
}

export interface Shortage {
  key: CostKey;
  /** その時点までの累積不足（不明は null） */
  deficit: number | null;
}

export interface Placement {
  stepKey: string;
  goalId: string;
  attemptId: string;
  /** 永続化済みの試行か（新規は false） */
  persisted: boolean;
  /** 翌日以降に再配置される見込み（当日スキップ後など。永続化しない） */
  provisional: boolean;
  date: DateJst | null;
  dayOrder: number;
  helperShipId: number | null;
  entryIndex: number | null;
  mode: GuaranteeMode;
  cost: AttemptCost | null;
  consumption: ConsumedItem[];
  shortages: Shortage[];
  tentative: boolean;
  predecessorTentative: boolean;
  executionGate: ExecutionGate;
  reasons: UnplacedReason[];
  /** 当日に固定された予定か */
  fixed: boolean;
}

export interface MaterialTotal {
  key: CostKey;
  need: number;
  /** 使用可能所持（保護・他計画の割当を除外、この計画用は含む）。不明は null */
  available: number | null;
  planned: number;
  shortage: number | null;
  /** 下書きの保留量 */
  held: number;
}

export interface BucketUsage {
  equipmentId: number;
  star: number;
  owned: number;
  goalUse: number;
  completedUse: number;
  targetUse: number;
  manualProtection: number;
  protectionRequested: number;
  effectiveProtection: number;
  materialAvailable: number;
  reconciliationRequired: boolean;
}

export type GoalStatusKind = 'achieved' | 'scheduled' | 'tentative' | 'undetermined' | 'unknown';

export interface GoalPlan {
  goalId: string;
  completed: number;
  count: number;
  /** ★別の完成品配分 */
  completedBuckets: { star: number; equipmentId: number; count: number }[];
  targetUnits: { equipmentId: number; star: number }[];
  missingUnits: number;
  stepKeys: string[];
  remainingSteps: number;
  status: GoalStatusKind;
  completionDate: DateJst | null;
  reasons: UnplacedReason[];
  /** 優先順位で割当後の不足（素材・資材） */
  shortages: { key: CostKey; amount: number | null }[];
  need: { key: CostKey; amount: number }[];
}

export interface DaySummary {
  date: DateJst;
  limit: number;
  holiday: boolean;
  daySkipped: boolean;
  placements: Placement[];
  /** 当日の枠を使う既存の試行（成功・失敗・下書き・スキップ） */
  occupied: number;
}

export interface AttemptChanges {
  create: Attempt[];
  update: { attemptId: string; scheduledDate: DateJst | null; dayOrder: number; helperShipId: number | null; mode: GuaranteeMode; executionGate: ExecutionGate }[];
  cancel: { attemptId: string; reason: string }[];
}

export interface PlanResult {
  todayJst: DateJst;
  steps: PlanStep[];
  placements: Placement[];
  goals: GoalPlan[];
  totals: MaterialTotal[];
  buckets: BucketUsage[];
  unplaced: Placement[];
  attemptChanges: AttemptChanges;
  warnings: string[];
  computationLimited: boolean;
}

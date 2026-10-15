import { enumerateRoutes, type MasterIndex } from '../../domain/master';
import type { Goal } from '../../domain/model';
import type { GoalPlan, PlanResult, UnplacedReason } from '../../domain/planning/types';
import { formatShortDate } from '../../domain/jst';

export function goalTitle(m: MasterIndex, g: Goal): string {
  return `${m.equipmentName(g.equipmentId)} ★${g.targetStar}${g.matchMode === 'atLeast' ? '以上' : ''} × ${g.count}`;
}

export function goalTarget(g: Goal): string {
  return `★${g.targetStar}${g.matchMode === 'atLeast' ? '以上を' : 'を'} ${g.count}個`;
}

const REASON_SHORT: Partial<Record<UnplacedReason, string>> = {
  HELPER_MISSING: '担当艦未所持',
  REMODEL_MISMATCH: '担当艦の改造段階不足',
  HELPER_UNKNOWN: '艦娘データ未取得',
  RECIPE_UNKNOWN: '条件未確認',
  TARGET_MISSING: '改修対象を未所持',
  ROUTE_REQUIRED: '更新経路の選択が必要',
  CYCLE: '素材の製作経路が循環',
  PREDECESSOR_BLOCKED: '前の工程を配置できない',
  NO_AVAILABLE_DAY: '実施できる曜日がない',
  SEARCH_LIMIT: '探索期間内に空きなし',
  COMPUTATION_LIMIT: '計算上限',
  EQUIPMENT_UNKNOWN: '所持装備が未取得',
  PREFERRED_HELPER_UNAVAILABLE: '希望の担当艦が使えない',
  PROTECTION_REVIEW: '保護設定の確認待ち',
  RESULT_PENDING: '結果確認待ち',
  SKIPPED_TODAY: 'スキップ済み',
};

export function reasonShort(r: UnplacedReason): string {
  return REASON_SHORT[r] ?? r;
}

export function goalStatus(gp: GoalPlan | undefined): { text: string; tone: 'ok' | 'warn' | 'sub'; date: string | null } {
  if (!gp) return { text: '計算待ち', tone: 'sub', date: null };
  switch (gp.status) {
    case 'achieved':
      return { text: '✓ 所持で達成', tone: 'ok', date: null };
    case 'scheduled':
      return { text: '✓ 予定どおり', tone: 'ok', date: gp.completionDate ? `完了見込み ${formatShortDate(gp.completionDate)}` : null };
    case 'tentative':
      return { text: '! 資材不足・仮配置', tone: 'warn', date: gp.completionDate ? `完了見込み ${formatShortDate(gp.completionDate)}（素材入手が前提）` : null };
    case 'unknown':
      return { text: '所持データ未取得', tone: 'warn', date: null };
    case 'undetermined': {
      const r = gp.reasons.find((x) => x !== 'PREDECESSOR_BLOCKED') ?? gp.reasons[0];
      return { text: r ? reasonShort(r) : '未定', tone: 'warn', date: '完了予定日は未定' };
    }
  }
}

export function isGoalDone(gp: GoalPlan | undefined): boolean {
  return gp?.status === 'achieved';
}

export function goalPlanOf(plan: PlanResult | null, goalId: string): GoalPlan | undefined {
  return plan?.goals.find((g) => g.goalId === goalId);
}

/**
 * 目標フォームの更新経路の選択肢。未選択（空）と「対象だけを改修」（対象のみの経路キー）を区別する。
 * 未選択のまま対象が足りなければ計画は経路の選択を求め、対象だけを選べば対象不足として扱う。
 */
export function routeOptions(m: MasterIndex, equipmentId: number): { value: string; label: string }[] {
  const routes = enumerateRoutes(m, equipmentId);
  if (routes.length <= 1) return [];
  return [
    { value: '', label: '未選択（所持していない場合の作り方を選ぶ）' },
    { value: routes[0]!.key, label: `${m.equipmentName(equipmentId)}だけを改修（更新元から作らない）` },
    ...routes.slice(1).map((r) => ({ value: r.key, label: r.equipmentIds.map((id) => m.equipmentName(id)).join(' → ') })),
  ];
}

/** 目標の装備を変える。前の装備のための更新経路・素材の作り方は引き継がない（意図しない製作工程を作らない） */
export function withEquipment(g: Goal, equipmentId: number): Goal {
  return { ...g, equipmentId, routeKey: null, materialRoutes: {} };
}

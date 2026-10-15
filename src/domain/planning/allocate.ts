import { bucketKey } from '../inventory/types';
import type { InventoryProjection } from '../inventory/projection';
import { MAX_STAR } from '../ids';
import { conversionStar, parseRouteKey, type MasterIndex } from '../master';
import type { Goal, Protection } from '../model';

// 完成品 → 改修対象 → 素材 の順に配分する（design/09）。

export interface Pool {
  /** bucketKey → 残り（未割当）個数 */
  remaining: Map<string, number>;
  owned: Map<string, number>;
  completedUse: Map<string, number>;
  targetUse: Map<string, number>;
  craftUse: Map<string, number>;
  reconciliation: Set<string>;
  manual: Map<string, number>;
  manualRequested: Map<string, number>;
}

export interface ChainStart {
  equipmentId: number;
  star: number;
}

export interface GoalAllocation {
  goal: Goal;
  routeIds: number[];
  routeValid: boolean;
  completedBuckets: { equipmentId: number; star: number; count: number }[];
  targets: ChainStart[];
  missing: number;
  protectionBlocked: boolean;
}

const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

/** 確認待ちの下書き（成功と報告）の改修対象。その目標の改修対象として先に割り当てる */
export interface ReservedTarget {
  goalId: string;
  equipmentId: number;
  star: number;
}

/**
 * 計画に使う装備の在庫。確認待ちの下書きが確保した装備（消費候補）は除く。
 * ただし成功と報告した下書きの改修対象（reserved）は、その目標へ割り当てるため在庫に残す。
 */
export function createPool(inv: InventoryProjection, protections: Protection[], reserved: ReservedTarget[] = []): Pool {
  const keep = new Map<string, number>();
  for (const r of reserved) add(keep, bucketKey(r.equipmentId, r.star), 1);
  const owned = new Map<string, number>();
  for (const [k, v] of inv.equipment.counts) {
    const held = Math.max(0, (inv.holds.get(`equipment:${k}`) ?? 0) - (keep.get(k) ?? 0));
    if (v - held > 0) owned.set(k, v - held);
  }
  const manual = new Map<string, number>();
  const manualRequested = new Map<string, number>();
  const reconciliation = new Set<string>();
  for (const p of protections) {
    manualRequested.set(p.bucket, p.count);
    manual.set(p.bucket, Math.min(p.count, owned.get(p.bucket) ?? 0));
    if (p.reconciliationRequired) reconciliation.add(p.bucket);
  }
  return { remaining: new Map(owned), owned, completedUse: new Map(), targetUse: new Map(), craftUse: new Map(), reconciliation, manual, manualRequested };
}

export function goalOrder(a: Goal, b: Goal): number {
  return a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.goalId.localeCompare(b.goalId);
}

function take(pool: Pool, key: string, n: number, use: Map<string, number>): number {
  const avail = pool.remaining.get(key) ?? 0;
  const t = Math.min(avail, n);
  if (t > 0) {
    pool.remaining.set(key, avail - t);
    add(use, key, t);
  }
  return t;
}

/** 経路として成立するか（各更新がマスターにあるか） */
export function validRoute(m: MasterIndex, ids: number[]): boolean {
  for (let i = 0; i < ids.length - 1; i++) if (conversionStar(m, ids[i]!, ids[i + 1]!) === null) return false;
  return ids.length > 0;
}

/** 状態 (装備, ★) から経路の終点 (目標, targetStar) までの工程数 */
export function stepsToEnd(m: MasterIndex, routeIds: number[], index: number, star: number, targetStar: number): number {
  const last = routeIds.length - 1;
  if (index === last) return targetStar - star;
  let n = MAX_STAR - star + 1;
  for (let i = index + 1; i <= last; i++) {
    const entry = conversionStar(m, routeIds[i - 1]!, routeIds[i]!) ?? 0;
    n += i === last ? targetStar - entry : MAX_STAR - entry + 1;
  }
  return n;
}

export function allocateGoals(m: MasterIndex, pool: Pool, goals: Goal[], reserved: ReservedTarget[] = []): GoalAllocation[] {
  const allocs = new Map<string, GoalAllocation>();
  for (const g of goals) {
    const routeIds = g.routeKey ? parseRouteKey(g.routeKey) : [g.equipmentId];
    const routeValid = routeIds[routeIds.length - 1] === g.equipmentId && validRoute(m, routeIds);
    allocs.set(g.goalId, { goal: g, routeIds, routeValid, completedBuckets: [], targets: [], missing: 0, protectionBlocked: false });
  }

  // 0. 成功と報告した確認待ちの改修対象：完成品・他の目標・素材より先に、その目標の改修対象として確保する
  for (const r of reserved) {
    const t = take(pool, bucketKey(r.equipmentId, r.star), 1, pool.targetUse);
    const alloc = allocs.get(r.goalId);
    if (t > 0 && alloc && alloc.routeValid) alloc.targets.push({ equipmentId: r.equipmentId, star: r.star });
  }

  // 1. 完成品：完全一致を先に、次に★以上を目標★の高い順。条件を満たす最小の★から配る
  const completedOrder = [...goals].sort(
    (a, b) =>
      (a.matchMode === 'exact' ? 0 : 1) - (b.matchMode === 'exact' ? 0 : 1) ||
      b.targetStar - a.targetStar ||
      goalOrder(a, b),
  );
  for (const g of completedOrder) {
    const alloc = allocs.get(g.goalId)!;
    let need = g.count;
    const stars = g.matchMode === 'exact' ? [g.targetStar] : Array.from({ length: MAX_STAR - g.targetStar + 1 }, (_, i) => g.targetStar + i);
    for (const s of stars) {
      if (need <= 0) break;
      const t = take(pool, bucketKey(g.equipmentId, s), need, pool.completedUse);
      if (t > 0) alloc.completedBuckets.push({ equipmentId: g.equipmentId, star: s, count: t });
      need -= t;
    }
  }

  // 2. 改修対象：優先順位順に、完成に近い（残工程が少ない）候補から
  for (const g of [...goals].sort(goalOrder)) {
    const alloc = allocs.get(g.goalId)!;
    const completed = alloc.completedBuckets.reduce((n, b) => n + b.count, 0);
    let need = g.count - completed - alloc.targets.length;
    if (need <= 0 || !alloc.routeValid) {
      alloc.missing = Math.max(0, need);
      continue;
    }
    const candidates: { equipmentId: number; star: number; steps: number; key: string }[] = [];
    const lastIndex = alloc.routeIds.length - 1;
    // 完全一致の目標で、更新後の★が目標★を上回る経路は上流から作れない
    const entryStar = lastIndex > 0 ? (conversionStar(m, alloc.routeIds[lastIndex - 1]!, g.equipmentId) ?? 0) : 0;
    const upstreamUsable = !(g.matchMode === 'exact' && lastIndex > 0 && entryStar > g.targetStar);
    alloc.routeIds.forEach((id, index) => {
      const last = index === lastIndex;
      if (!last && !upstreamUsable) return;
      const maxStar = last ? g.targetStar - 1 : MAX_STAR;
      for (let s = 0; s <= maxStar; s++) {
        const key = bucketKey(id, s);
        if ((pool.remaining.get(key) ?? 0) <= 0) continue;
        if (pool.reconciliation.has(key)) {
          alloc.protectionBlocked = true;
          continue;
        }
        candidates.push({ equipmentId: id, star: s, steps: stepsToEnd(m, alloc.routeIds, index, s, g.targetStar), key });
      }
    });
    candidates.sort((a, b) => a.steps - b.steps || a.equipmentId - b.equipmentId || b.star - a.star);
    for (const c of candidates) {
      if (need <= 0) break;
      const t = take(pool, c.key, need, pool.targetUse);
      for (let i = 0; i < t; i++) alloc.targets.push({ equipmentId: c.equipmentId, star: c.star });
      need -= t;
    }
    alloc.missing = need;
  }
  return goals.map((g) => allocs.get(g.goalId)!);
}

/** 素材として使える個数（保護・目標用を除く。保護と目標用は重なる分を二重に数えない） */
export function materialAvailableAfterGoals(pool: Pool, key: string): number {
  if (pool.reconciliation.has(key)) return 0;
  const owned = pool.owned.get(key) ?? 0;
  const goalUse = (pool.completedUse.get(key) ?? 0) + (pool.targetUse.get(key) ?? 0) + (pool.craftUse.get(key) ?? 0);
  const manual = pool.manual.get(key) ?? 0;
  return Math.max(0, owned - Math.max(goalUse, manual));
}

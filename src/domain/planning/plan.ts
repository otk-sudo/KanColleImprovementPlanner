import { bucketKey } from '../inventory/types';
import { addDays, compareDate, weekdayOf, type DateJst } from '../jst';
import { MAX_STAR } from '../ids';
import {
  conversionStar,
  enumerateRoutes,
  parseRouteKey,
  transitionFrom,
  transitionKey,
  transitionOptions,
  type AttemptCost,
  type MasterIndex,
  type Transition,
  type TransitionOption,
} from '../master';
import type { Attempt, ExecutionGate, Goal, GuaranteeMode } from '../model';
import { allocateGoals, createPool, goalOrder, materialAvailableAfterGoals, stepsToEnd, validRoute, type ChainStart, type GoalAllocation, type Pool, type ReservedTarget } from './allocate';
import { helperInfo, type HelperInfo } from './helpers';
import { schedule, type FixedSlot, type SchedStep } from './schedule';
import type {
  AttemptChanges,
  BucketUsage,
  ConsumedItem,
  CostKey,
  GoalPlan,
  MaterialTotal,
  Placement,
  PlanInput,
  PlanResult,
  PlanStep,
  Shortage,
  UnplacedReason,
} from './types';

// 必要数・在庫割当・日程計算（design/09・12・17）。保存や現在時刻の取得を行わない純粋な処理。
// 同じ入力なら同じ工程・割当・配置・理由を返す（P21）。

export const COMPUTATION_LIMITS = { maxDepth: 100, maxSteps: 10_000 } as const;

interface TransitionInfo {
  options: TransitionOption[];
  helper: HelperInfo;
  defaultCost: AttemptCost | null;
  defaultEntry: number | null;
  costVaries: boolean;
  /** 素材装備・アイテムがエントリ（担当艦）によって異なる */
  materialVaries: boolean;
}

interface Chain {
  chainId: string;
  goal: Goal;
  role: 'target' | 'craft';
  craftFor: number | null;
  transitions: Transition[];
  order: number;
  blocked: UnplacedReason | null;
  /** transition index → この工程が使う製作品の鎖ID */
  craftDeps: Map<number, string[]>;
  /** transition index → 製作品で賄う素材の個数（装備ID → 個数） */
  craftedInputs: Map<number, Map<number, number>>;
}

export function modeFor(goal: Goal, t: Transition): GuaranteeMode {
  if (t.kind === 'convert') return goal.updateGuarantee ? 'guaranteed' : 'normal';
  switch (goal.guarantee.mode) {
    case 'always':
      return 'guaranteed';
    case 'never':
      return 'normal';
    case 'fromTargetStar':
      return goal.guarantee.fromStar !== null && t.toStar >= goal.guarantee.fromStar ? 'guaranteed' : 'normal';
  }
}

/** 通常/確実化を選んだ後の消費（ゼロは含めない） */
export function costItems(cost: AttemptCost, mode: GuaranteeMode): { key: CostKey; amount: number }[] {
  const out: { key: CostKey; amount: number }[] = [];
  const push = (key: CostKey, amount: number) => {
    if (amount > 0) out.push({ key, amount });
  };
  // 表示順：改修資材（ネジ）→ 開発資材（釘）→ 素材装備 → アイテム → 燃料・弾薬・鋼材・ボーキ
  push('resource:8', mode === 'guaranteed' ? cost.screws.guaranteed : cost.screws.normal);
  push('resource:7', mode === 'guaranteed' ? cost.devmats.guaranteed : cost.devmats.normal);
  for (const e of cost.equipment) push(`equipment:${e.equipmentId}`, e.count);
  for (const u of cost.useItems) push(`item:${u.useItemId}`, u.count);
  push('resource:1', cost.fuel);
  push('resource:2', cost.ammo);
  push('resource:3', cost.steel);
  push('resource:4', cost.bauxite);
  return out;
}

function sameCost(a: AttemptCost, b: AttemptCost): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 素材装備・アイテムの消費が同じか（資材の差は日程の仮想在庫が配置したエントリの費用で扱う） */
function sameMaterials(a: AttemptCost | null, b: AttemptCost | null): boolean {
  const norm = (c: AttemptCost | null) =>
    JSON.stringify({
      e: [...(c?.equipment ?? [])].sort((x, y) => x.equipmentId - y.equipmentId),
      u: [...(c?.useItems ?? [])].sort((x, y) => x.useItemId - y.useItemId),
    });
  return norm(a) === norm(b);
}

function chainTransitions(m: MasterIndex, routeIds: number[], start: ChainStart, end: { equipmentId: number; star: number }): Transition[] {
  const out: Transition[] = [];
  let index = routeIds.indexOf(start.equipmentId);
  let star = start.star;
  if (index < 0) return out;
  for (;;) {
    const id = routeIds[index]!;
    const isEnd = id === end.equipmentId && index === routeIds.length - 1;
    const stopStar = isEnd ? end.star : MAX_STAR;
    while (star < stopStar) {
      out.push({ kind: 'improve', equipmentId: id, fromStar: star, toStar: star + 1 });
      star++;
    }
    if (isEnd) break;
    const next = routeIds[index + 1]!;
    const toStar = conversionStar(m, id, next) ?? 0;
    out.push({ kind: 'convert', equipmentId: id, toEquipmentId: next, toStar });
    star = toStar;
    index++;
    if (next === end.equipmentId && index === routeIds.length - 1 && star >= end.star) break;
  }
  return out;
}

const keyStar = (k: string) => Number(k.split(':')[1]);
const keyId = (k: string) => Number(k.split(':')[0]);

/** 試行の番号（attemptId の @ 以降）。文字列ではなく数値で比べる */
export function attemptSeq(a: Pick<Attempt, 'attemptId'>): number {
  const n = Number(a.attemptId.slice(a.attemptId.lastIndexOf('@') + 1));
  return Number.isFinite(n) ? n : 0;
}

export function buildPlan(input: PlanInput): PlanResult {
  const { master: m, todayJst: today, inventory: inv } = input;
  const tomorrow = addDays(today, 1);
  const goals = [...input.goals].sort(goalOrder);
  const goalRank = new Map(goals.map((g, i) => [g.goalId, i]));
  const preferred = new Map(input.preferredHelpers.map((p) => [p.stepKey, p.shipId]));
  const warnings: string[] = [];

  const emptyChanges: AttemptChanges = { create: [], update: [], cancel: [] };
  if (!inv.equipment.known) {
    return {
      todayJst: today,
      steps: [],
      placements: [],
      goals: goals.map((g) => ({
        goalId: g.goalId,
        completed: 0,
        count: g.count,
        completedBuckets: [],
        targetUnits: [],
        missingUnits: g.count,
        stepKeys: [],
        remainingSteps: 0,
        status: 'unknown',
        completionDate: null,
        reasons: ['EQUIPMENT_UNKNOWN'],
        shortages: [],
        need: [],
      })),
      totals: [],
      buckets: [],
      unplaced: [],
      attemptChanges: emptyChanges,
      warnings,
      computationLimited: false,
    };
  }

  // ---- 1. 完成品・改修対象の配分 ----
  // 成功と報告した確認待ちの下書きが確保した改修対象（基準に取り込み済みの下書きは確保がないので除く）
  const reserved: ReservedTarget[] = [];
  const reservedCount = new Map<string, number>();
  for (const d of input.drafts) {
    if (d.status !== 'open' || d.reportedOutcome !== 'success') continue;
    const a = input.attempts.find((x) => x.attemptId === d.attemptId);
    if (!a) continue;
    const from = transitionFrom(a.transition);
    const k = bucketKey(from.equipmentId, from.star);
    const declared = d.knownConsumptions.some((c) => c.scope === 'equipment' && c.equipmentId === from.equipmentId && c.star === from.star && c.amount < 0);
    if (!declared || (inv.holds.get(`equipment:${k}`) ?? 0) <= (reservedCount.get(k) ?? 0)) continue;
    reservedCount.set(k, (reservedCount.get(k) ?? 0) + 1);
    reserved.push({ goalId: a.goalId, equipmentId: from.equipmentId, star: from.star });
  }
  const pool: Pool = createPool(inv, input.protections, reserved);
  const allocs: GoalAllocation[] = allocateGoals(m, pool, goals, reserved);
  const allocById = new Map(allocs.map((a) => [a.goal.goalId, a]));

  // 素材として使える残り（bucket 単位）
  const material = new Map<string, number>();
  for (const k of pool.owned.keys()) material.set(k, materialAvailableAfterGoals(pool, k));

  // ---- 2. 工程の情報（レシピ候補・担当艦・費用） ----
  const infoCache = new Map<string, TransitionInfo>();
  const info = (t: Transition): TransitionInfo => {
    const k = transitionKey(t);
    let v = infoCache.get(k);
    if (!v) {
      const options = transitionOptions(m, t);
      const helper = helperInfo(m, options, inv.ships, null);
      const first = helper.candidates[0];
      const defaultOpt = first ? options.find((o) => o.entryIndex === first.entryIndex) : options[0];
      v = {
        options,
        helper,
        defaultCost: defaultOpt?.cost ?? null,
        defaultEntry: defaultOpt?.entryIndex ?? null,
        costVaries: options.some((o) => defaultOpt && !sameCost(o.cost, defaultOpt.cost)),
        materialVaries: options.some((o) => defaultOpt && !sameMaterials(o.cost, defaultOpt.cost)),
      };
      infoCache.set(k, v);
    }
    return v;
  };

  // ---- 3. 鎖（改修対象ごとの工程列）と素材の製作 ----
  const chains: Chain[] = [];
  let totalSteps = 0;
  let computationLimited = false;

  const takeMaterial = (equipmentId: number, count: number): number => {
    let taken = 0;
    const keys = [...material.keys()].filter((k) => keyId(k) === equipmentId).sort((a, b) => keyStar(a) - keyStar(b));
    for (const k of keys) {
      if (taken >= count) break;
      const avail = material.get(k) ?? 0;
      const t = Math.min(avail, count - taken);
      if (t > 0) {
        material.set(k, avail - t);
        taken += t;
      }
    }
    return taken;
  };

  // 鎖の番号（目標・役割・製作対象ごと）。毎回全鎖を走査しない
  const chainCounts = new Map<string, number>();
  const newChain = (goal: Goal, role: 'target' | 'craft', craftFor: number | null, transitions: Transition[]): Chain => {
    const countKey = `${goal.goalId}|${role}|${craftFor}`;
    const n = chainCounts.get(countKey) ?? 0;
    chainCounts.set(countKey, n + 1);
    const c: Chain = {
      chainId: `${goal.goalId}#${role === 'target' ? 't' : `c${craftFor}-`}${n}`,
      goal,
      role,
      craftFor,
      transitions,
      order: chains.length,
      blocked: null,
      craftDeps: new Map(),
      craftedInputs: new Map(),
    };
    chains.push(c);
    totalSteps += transitions.length;
    if (totalSteps > COMPUTATION_LIMITS.maxSteps) computationLimited = true;
    return c;
  };

  const expandCraft = (goal: Goal, y: number, count: number, stack: number[], depth: number): Chain[] => {
    const choice = goal.materialRoutes[String(y)];
    if (!choice || choice.kind !== 'craft') return [];
    const route = parseRouteKey(choice.routeKey);
    if (route.length < 2 || route[route.length - 1] !== y || !validRoute(m, route)) {
      warnings.push(`素材（${m.equipmentName(y)}）の製作経路が現在のマスターで成立しません。`);
      return [];
    }
    const endStar = conversionStar(m, route[route.length - 2]!, y) ?? 0;
    const candidates: { key: string; steps: number }[] = [];
    route.slice(0, -1).forEach((id, index) => {
      for (let s = 0; s <= MAX_STAR; s++) {
        const key = bucketKey(id, s);
        if ((material.get(key) ?? 0) > 0) candidates.push({ key, steps: stepsToEnd(m, route, index, s, endStar) });
      }
    });
    candidates.sort((a, b) => a.steps - b.steps || keyId(a.key) - keyId(b.key) || keyStar(b.key) - keyStar(a.key));
    const made: Chain[] = [];
    for (const c of candidates) {
      while (made.length < count && (material.get(c.key) ?? 0) > 0) {
        // 上限に達したら、それ以上の製作の鎖は作らない（残りは計算上限として示す）
        if (computationLimited) {
          limitedCraftGoals.add(goal.goalId);
          break;
        }
        material.set(c.key, (material.get(c.key) ?? 0) - 1);
        pool.craftUse.set(c.key, (pool.craftUse.get(c.key) ?? 0) + 1);
        const start = { equipmentId: keyId(c.key), star: keyStar(c.key) };
        const chain = newChain(goal, 'craft', y, chainTransitions(m, route, start, { equipmentId: y, star: endStar }));
        if (depth > COMPUTATION_LIMITS.maxDepth || computationLimited) {
          chain.blocked = 'COMPUTATION_LIMIT';
          computationLimited = true;
        }
        made.push(chain);
      }
      if (made.length >= count || computationLimited) break;
    }
    if (made.length > 0 && !computationLimited) processConsumers(goal, made, stack, depth);
    return made;
  };

  /** 鎖の工程が使う素材を、空き在庫 → 製作（選択時）の順に割り当てる */
  const processConsumers = (goal: Goal, consumers: Chain[], stack: number[], depth: number) => {
    const needs = new Map<number, { chain: Chain; index: number; count: number }[]>();
    for (const chain of consumers) {
      chain.transitions.forEach((t, index) => {
        const cost = info(t).defaultCost;
        for (const e of cost?.equipment ?? []) {
          const list = needs.get(e.equipmentId) ?? [];
          list.push({ chain, index, count: e.count });
          needs.set(e.equipmentId, list);
        }
      });
    }
    for (const y of [...needs.keys()].sort((a, b) => a - b)) {
      const list = needs.get(y)!;
      const total = list.reduce((n, x) => n + x.count, 0);
      const free = takeMaterial(y, total);
      const short = total - free;
      if (short <= 0) continue;
      const choice = goal.materialRoutes[String(y)];
      if (!choice || choice.kind !== 'craft') continue;
      if (stack.includes(y)) {
        for (const c of consumers) if (c.role === 'craft' && !c.blocked) c.blocked = 'CYCLE';
        continue;
      }
      const crafted = expandCraft(goal, y, short, [...stack, y], depth + 1);
      // 空き在庫を先の工程へ、製作品を後の工程へ割り当てる
      let freeLeft = free;
      let craftIndex = 0;
      for (const n of list) {
        let need = n.count;
        const useFree = Math.min(freeLeft, need);
        freeLeft -= useFree;
        need -= useFree;
        while (need > 0 && craftIndex < crafted.length) {
          const dep = crafted[craftIndex++]!;
          const deps = n.chain.craftDeps.get(n.index) ?? [];
          deps.push(dep.chainId);
          n.chain.craftDeps.set(n.index, deps);
          const inputs = n.chain.craftedInputs.get(n.index) ?? new Map<number, number>();
          inputs.set(y, (inputs.get(y) ?? 0) + 1);
          n.chain.craftedInputs.set(n.index, inputs);
          need--;
        }
      }
    }
  };

  // 上限に達したら、それ以上の改修対象の工程は展開せず、目標ごとの残り件数を計算上限として未配置にする
  const limitedTargets = new Map<string, number>();
  const limitedCraftGoals = new Set<string>();
  for (const g of goals) {
    const alloc = allocById.get(g.goalId)!;
    const targetChains: Chain[] = [];
    for (const start of alloc.targets) {
      if (computationLimited) {
        limitedTargets.set(g.goalId, (limitedTargets.get(g.goalId) ?? 0) + 1);
        continue;
      }
      targetChains.push(newChain(g, 'target', null, chainTransitions(m, alloc.routeIds, start, { equipmentId: g.equipmentId, star: g.targetStar })));
    }
    processConsumers(g, targetChains, [], 0);
  }

  // ---- 4. 工程キー（目標・経路・段階・順番から安定的に導く） ----
  const attemptsByKey = new Map<string, Attempt[]>();
  for (const a of input.attempts) {
    const list = attemptsByKey.get(a.stepKey) ?? [];
    list.push(a);
    attemptsByKey.set(a.stepKey, list);
  }
  for (const list of attemptsByKey.values()) list.sort((a, b) => attemptSeq(a) - attemptSeq(b));
  const latestOf = (key: string): Attempt | undefined => attemptsByKey.get(key)?.at(-1);
  const isClaim = (a: Attempt): boolean => (a.lifecycle === 'active' && (a.outcome === 'none' || a.outcome === 'draft' || a.outcome === 'skip')) || a.outcome === 'failure';

  const groups = new Map<string, { chain: Chain; index: number }[]>();
  const groupIdOf = (chain: Chain, t: Transition) => `${chain.goal.goalId}${chain.role === 'craft' ? `|craft:${chain.craftFor}` : ''}|${transitionKey(t)}`;
  for (const chain of chains) {
    chain.transitions.forEach((t, index) => {
      const gid = groupIdOf(chain, t);
      const list = groups.get(gid) ?? [];
      list.push({ chain, index });
      groups.set(gid, list);
    });
  }
  const stepKeyOf = new Map<string, string>(); // `${chainId}:${index}` → stepKey
  const ordinalOf = new Map<string, number>();
  for (const [gid, members] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const prefix = `${gid}|`;
    const used = new Set<number>();
    const claims: { ordinal: number; date: DateJst | null; order: number }[] = [];
    for (const [key, list] of attemptsByKey) {
      if (!key.startsWith(prefix)) continue;
      const ordinal = Number(key.slice(prefix.length));
      if (!Number.isInteger(ordinal)) continue;
      used.add(ordinal);
      const latest = list.at(-1)!;
      if (isClaim(latest)) claims.push({ ordinal, date: latest.scheduledDate, order: latest.dayOrder });
    }
    claims.sort((a, b) => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : compareDate(a.date, b.date)) || a.order - b.order || a.ordinal - b.ordinal);
    const ordinals = claims.slice(0, members.length).map((c) => c.ordinal);
    for (let o = 0; ordinals.length < members.length; o++) if (!used.has(o) && !ordinals.includes(o)) ordinals.push(o);
    members.sort((a, b) => a.index - b.index || a.chain.order - b.chain.order);
    members.forEach((mem, i) => {
      const key = `${prefix}${ordinals[i]}`;
      stepKeyOf.set(`${mem.chain.chainId}:${mem.index}`, key);
      ordinalOf.set(key, ordinals[i]!);
    });
  }

  const chainById = new Map(chains.map((c) => [c.chainId, c]));
  const steps: PlanStep[] = [];
  const craftedInputsByKey = new Map<string, Map<number, number>>();
  for (const chain of chains) {
    chain.transitions.forEach((t, index) => {
      const stepKey = stepKeyOf.get(`${chain.chainId}:${index}`)!;
      const preds: string[] = [];
      if (index > 0) preds.push(stepKeyOf.get(`${chain.chainId}:${index - 1}`)!);
      for (const depId of chain.craftDeps.get(index) ?? []) {
        const dep = chainById.get(depId)!;
        if (dep.transitions.length > 0) preds.push(stepKeyOf.get(`${dep.chainId}:${dep.transitions.length - 1}`)!);
      }
      if (chain.craftedInputs.has(index)) craftedInputsByKey.set(stepKey, chain.craftedInputs.get(index)!);
      const ti = info(t);
      const pref = preferred.get(stepKey) ?? null;
      let helper = pref === null ? ti.helper : helperInfo(m, ti.options, inv.ships, pref);
      // 素材がエントリで異なる改修は、素材計画（既定エントリの費用で展開）と同じ素材のエントリの担当艦だけで配置する
      if (ti.materialVaries && helper.candidates.length > 0) {
        const costOf = (entryIndex: number) => ti.options.find((o) => o.entryIndex === entryIndex)?.cost ?? null;
        const same = helper.candidates.filter((c) => sameMaterials(costOf(c.entryIndex), ti.defaultCost));
        helper = same.length > 0 ? { ...helper, candidates: same } : { ...helper, candidates: [], blockers: ['PREFERRED_HELPER_UNAVAILABLE'] };
      }
      const blockers: UnplacedReason[] = [...helper.blockers];
      if (chain.blocked) blockers.unshift(chain.blocked);
      const latest = latestOf(stepKey);
      let earliestDate = today;
      // 確認待ちの結果がある工程は、繰越後の後継があっても結果が決まるまで実行しない（元の試行が成功なら後継は不要になる）
      if ((attemptsByKey.get(stepKey) ?? []).some((a) => a.outcome === 'draft' && a.lifecycle !== 'cancelled')) blockers.unshift('RESULT_PENDING');
      if (latest && (latest.outcome === 'failure' || latest.outcome === 'skip') && latest.scheduledDate === today) earliestDate = tomorrow;
      steps.push({
        stepKey,
        goalId: chain.goal.goalId,
        role: chain.role,
        craftFor: chain.craftFor,
        transition: t,
        transitionKey: transitionKey(t),
        ordinal: ordinalOf.get(stepKey)!,
        predecessorKeys: preds.sort(),
        chainIndex: index,
        chainId: chain.chainId,
        mode: modeFor(chain.goal, t),
        defaultCost: ti.defaultCost,
        costVaries: ti.costVaries,
        helperCandidates: helper.candidates,
        blockers: [...new Set(blockers)],
        helperNote: helper.note,
        earliestDate,
      });
    });
  }
  steps.sort((a, b) => (goalRank.get(a.goalId) ?? 0) - (goalRank.get(b.goalId) ?? 0) || a.stepKey.localeCompare(b.stepKey));
  const stepByKey = new Map(steps.map((s) => [s.stepKey, s]));

  // 前提の深さ（同目標内の前提順）
  const depthMemo = new Map<string, number>();
  const depthOf = (key: string, seen = new Set<string>()): number => {
    if (depthMemo.has(key)) return depthMemo.get(key)!;
    if (seen.has(key)) return 0;
    seen.add(key);
    const s = stepByKey.get(key);
    const d = s && s.predecessorKeys.length > 0 ? 1 + Math.max(...s.predecessorKeys.map((p) => depthOf(p, seen))) : 0;
    depthMemo.set(key, d);
    return d;
  };

  // ---- 5. 当日の固定と日程配置 ----
  const todays = input.attempts.filter((a) => a.scheduledDate === today && a.lifecycle !== 'cancelled' && a.lifecycle !== 'superseded');
  const fixed: FixedSlot[] = [];
  const orphanToday: Attempt[] = [];
  const occupied = new Map<DateJst, { count: number; maxOrder: number }>();
  const occupy = (d: DateJst, order: number) => {
    const o = occupied.get(d) ?? { count: 0, maxOrder: 0 };
    o.count++;
    o.maxOrder = Math.max(o.maxOrder, order);
    occupied.set(d, o);
  };
  // 当日の枠：成功・失敗・下書き・スキップ・未実施予定はすべて1枠を使う（design/09）
  for (const a of todays) {
    if (a.outcome === 'none' && a.lifecycle === 'active') {
      if (stepByKey.has(a.stepKey) && latestOf(a.stepKey)?.attemptId === a.attemptId) {
        fixed.push({ stepKey: a.stepKey, date: today, dayOrder: a.dayOrder, helperShipId: a.helperShipId });
      } else {
        orphanToday.push(a);
      }
    }
    if (a.outcome !== 'none' || a.lifecycle === 'active') occupy(today, a.dayOrder);
  }

  const schedSteps: SchedStep[] = steps.map((s) => ({
    stepKey: s.stepKey,
    goalRank: goalRank.get(s.goalId) ?? 0,
    depth: depthOf(s.stepKey),
    predecessorKeys: s.predecessorKeys,
    candidates: s.helperCandidates,
    blockers: s.blockers,
    earliestDate: s.earliestDate,
  }));
  const sched = schedule({
    today,
    steps: schedSteps,
    fixed,
    occupied,
    daySkips: new Set(input.daySkips.map((d) => d.date)),
    settings: input.settings,
  });

  // ---- 6. 配置と仮想在庫 ----
  const placements: Placement[] = [];
  const costForEntry = (t: Transition, entryIndex: number | null): AttemptCost | null => {
    const ti = info(t);
    if (entryIndex === null) return ti.defaultCost;
    return ti.options.find((o) => o.entryIndex === entryIndex)?.cost ?? ti.defaultCost;
  };
  for (const s of steps) {
    const slot = sched.placed.get(s.stepKey);
    const latest = latestOf(s.stepKey);
    const activeNext = latest && latest.lifecycle === 'active' && latest.outcome === 'none' ? latest : null;
    const provisional = !!latest && latest.outcome === 'skip' && latest.lifecycle === 'active';
    const nextSeq = (attemptsByKey.get(s.stepKey)?.length ?? 0) + 1;
    const entryIndex = slot?.helper?.entryIndex ?? (s.helperCandidates[0]?.entryIndex ?? info(s.transition).defaultEntry);
    const cost = costForEntry(s.transition, entryIndex);
    placements.push({
      stepKey: s.stepKey,
      goalId: s.goalId,
      attemptId: activeNext ? activeNext.attemptId : latest?.outcome === 'draft' ? latest.attemptId : `${s.stepKey}@${nextSeq}`,
      persisted: !!activeNext || latest?.outcome === 'draft',
      provisional: provisional && !!slot,
      date: slot?.date ?? null,
      dayOrder: slot?.dayOrder ?? 0,
      helperShipId: slot?.helper?.shipId ?? (slot?.fixed ? (activeNext?.helperShipId ?? null) : null),
      entryIndex,
      mode: s.mode,
      cost,
      consumption: [],
      shortages: [],
      tentative: false,
      predecessorTentative: false,
      executionGate: 'ready',
      reasons: slot ? [] : (sched.unplaced.get(s.stepKey) ?? []),
      fixed: slot?.fixed ?? false,
    });
  }
  // 当日に残す確認待ちの予定（対象消失・条件不成立）
  for (const a of orphanToday) {
    const options = transitionOptions(m, a.transition);
    const cost = options[0]?.cost ?? null;
    placements.push({
      stepKey: a.stepKey,
      goalId: a.goalId,
      attemptId: a.attemptId,
      persisted: true,
      provisional: false,
      date: today,
      dayOrder: a.dayOrder,
      helperShipId: a.helperShipId,
      entryIndex: options[0]?.entryIndex ?? null,
      mode: a.mode,
      cost,
      consumption: [],
      shortages: [],
      tentative: false,
      predecessorTentative: false,
      executionGate: 'reviewRequired',
      reasons: [],
      fixed: true,
    });
  }

  // 実行可否（当日の前提待ち・担当艦の不一致）
  const todayWeekday = weekdayOf(today);
  const placementByKey = new Map(placements.filter((p) => !orphanToday.some((o) => o.attemptId === p.attemptId)).map((p) => [p.stepKey, p]));
  for (const p of placements) {
    if (p.executionGate === 'reviewRequired' || p.date !== today) continue;
    const s = stepByKey.get(p.stepKey);
    if (!s) continue;
    // 固定した担当艦が、今も候補にあり今日の曜日に担当できるか（優先担当艦の変更・マスター更新で曜日が変わる場合）
    if (p.fixed && p.helperShipId !== null && !s.helperCandidates.some((c) => c.shipId === p.helperShipId && c.days.includes(todayWeekday))) {
      p.executionGate = 'reviewRequired';
      continue;
    }
    if (p.fixed && s.blockers.length > 0) {
      p.executionGate = 'reviewRequired';
      continue;
    }
    const pending = s.predecessorKeys.some((k) => {
      const pp = placementByKey.get(k);
      if (!pp || pp.date === null) return true;
      if (compareDate(pp.date, today) > 0) return true;
      if (pp.date === today && pp.dayOrder > p.dayOrder) return true;
      const latest = latestOf(k);
      return !!latest && latest.scheduledDate === today && (latest.outcome === 'skip' || latest.outcome === 'failure' || latest.outcome === 'draft');
    });
    if (pending) p.executionGate = 'predecessorPending';
  }

  // 仮想在庫：日付・日内順に実在庫から費用を減算する（実在庫は変更しない）
  const balances = new Map<CostKey, number | null>();
  const starPools = new Map<number, Map<number, number>>();
  const initialMaterial = new Map<string, number>();
  for (const k of pool.owned.keys()) initialMaterial.set(k, materialAvailableAfterGoals(pool, k));
  for (const [k, v] of initialMaterial) {
    if (v <= 0) continue;
    const id = keyId(k);
    const sp = starPools.get(id) ?? new Map<number, number>();
    sp.set(keyStar(k), v);
    starPools.set(id, sp);
  }
  const unknownScope = (scope: string) => inv.pendingUnknownScopes.has(scope as never);
  const initialBalance = (key: CostKey): number | null => {
    const [kind, idStr] = key.split(':') as [string, string];
    const id = Number(idStr);
    if (kind === 'resource') {
      if (unknownScope(key)) return null;
      const v = inv.resources.get(id);
      return v ? v.value - (inv.holds.get(key) ?? 0) : null;
    }
    if (kind === 'item') {
      if (unknownScope(key)) return null;
      const v = inv.items.get(id);
      return v ? v.value - (inv.holds.get(key) ?? 0) : null;
    }
    if (unknownScope('equipment')) return null;
    let total = 0;
    for (const [, c] of starPools.get(id) ?? []) total += c;
    return total;
  };
  const timeline = placements
    .filter((p) => p.date !== null && p.cost)
    .sort((a, b) => compareDate(a.date!, b.date!) || a.dayOrder - b.dayOrder || a.stepKey.localeCompare(b.stepKey));
  const tentativeByKey = new Map<string, boolean>();
  for (const p of timeline) {
    const crafted = craftedInputsByKey.get(p.stepKey);
    const items = costItems(p.cost!, p.mode);
    const shortages: Shortage[] = [];
    const consumption: ConsumedItem[] = [];
    for (const item of items) {
      let amount = item.amount;
      // 仮想在庫の初期値は、この工程で★別の在庫プールを減らす前に確定する（同じ消費を二重に引かない）
      if (!balances.has(item.key)) balances.set(item.key, initialBalance(item.key));
      if (item.key.startsWith('equipment:')) {
        const id = Number(item.key.split(':')[1]);
        amount -= Math.min(amount, crafted?.get(id) ?? 0);
        const stars: { star: number; count: number }[] = [];
        const sp = starPools.get(id);
        let left = amount;
        if (sp) {
          for (const star of [...sp.keys()].sort((a, b) => a - b)) {
            if (left <= 0) break;
            const avail = sp.get(star)!;
            const t = Math.min(avail, left);
            if (t > 0) {
              sp.set(star, avail - t);
              stars.push({ star, count: t });
              left -= t;
            }
          }
        }
        consumption.push({ key: item.key, amount: item.amount, stars });
      } else {
        consumption.push({ key: item.key, amount: item.amount });
      }
      const bal = balances.get(item.key)!;
      if (bal === null) {
        shortages.push({ key: item.key, deficit: null });
      } else {
        const next = bal - amount;
        balances.set(item.key, next);
        shortages.push({ key: item.key, deficit: Math.max(0, -next) });
      }
    }
    p.consumption = consumption;
    p.shortages = shortages;
    p.tentative = shortages.some((s) => s.deficit === null || s.deficit > 0);
    const s = stepByKey.get(p.stepKey);
    p.predecessorTentative = !!s && s.predecessorKeys.some((k) => tentativeByKey.get(k));
    tentativeByKey.set(p.stepKey, p.tentative || p.predecessorTentative);
  }

  // ---- 7. 未配置（改修対象の不足を含む） ----
  const unplaced: Placement[] = placements.filter((p) => p.date === null);
  for (const g of goals) {
    const alloc = allocById.get(g.goalId)!;
    if (alloc.missing <= 0) continue;
    let reason: UnplacedReason = 'TARGET_MISSING';
    if (!alloc.routeValid) reason = 'ROUTE_REQUIRED';
    else if (alloc.protectionBlocked) reason = 'PROTECTION_REVIEW';
    else if (!g.routeKey && enumerateRoutes(m, g.equipmentId).length > 1) reason = 'ROUTE_REQUIRED';
    for (let i = 0; i < alloc.missing; i++) {
      unplaced.push({
        stepKey: `${g.goalId}|missing|${i}`,
        goalId: g.goalId,
        attemptId: '',
        persisted: false,
        provisional: false,
        date: null,
        dayOrder: 0,
        helperShipId: null,
        entryIndex: null,
        mode: 'normal',
        cost: null,
        consumption: [],
        shortages: [],
        tentative: false,
        predecessorTentative: false,
        executionGate: 'ready',
        reasons: [reason],
        fixed: false,
      });
    }
  }

  for (const g of goals) {
    // 素材の製作だけが打ち切られた目標も、計算上限として1件示す
    const n = limitedTargets.get(g.goalId) ?? (limitedCraftGoals.has(g.goalId) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      unplaced.push({
        stepKey: `${g.goalId}|limit|${i}`,
        goalId: g.goalId,
        attemptId: '',
        persisted: false,
        provisional: false,
        date: null,
        dayOrder: 0,
        helperShipId: null,
        entryIndex: null,
        mode: 'normal',
        cost: null,
        consumption: [],
        shortages: [],
        tentative: false,
        predecessorTentative: false,
        executionGate: 'ready',
        reasons: ['COMPUTATION_LIMIT'],
        fixed: false,
      });
    }
  }

  // ---- 8. 集計 ----
  const needByKey = new Map<CostKey, number>();
  const needByGoal = new Map<string, Map<CostKey, number>>();
  for (const p of placements) {
    if (!p.cost || !stepByKey.has(p.stepKey)) continue;
    for (const item of costItems(p.cost, p.mode)) {
      needByKey.set(item.key, (needByKey.get(item.key) ?? 0) + item.amount);
      const gm = needByGoal.get(p.goalId) ?? new Map<CostKey, number>();
      gm.set(item.key, (gm.get(item.key) ?? 0) + item.amount);
      needByGoal.set(p.goalId, gm);
    }
  }
  const plannedByEquipment = new Map<number, number>();
  for (const c of chains) if (c.role === 'craft' && !c.blocked && c.craftFor !== null) plannedByEquipment.set(c.craftFor, (plannedByEquipment.get(c.craftFor) ?? 0) + 1);
  const availableOf = (key: CostKey): number | null => {
    const [kind, idStr] = key.split(':') as [string, string];
    const id = Number(idStr);
    if (kind === 'resource' || kind === 'item') return initialBalance(key);
    if (unknownScope('equipment')) return null;
    let total = 0;
    for (const [k, v] of initialMaterial) if (keyId(k) === id) total += v;
    return total;
  };
  const keyRank = (k: CostKey) => {
    const [kind, id] = k.split(':') as [string, string];
    const order = kind === 'resource' ? ({ '8': 0, '7': 1, '1': 3, '2': 4, '3': 5, '4': 6 } as Record<string, number>)[id] ?? 7 : kind === 'equipment' ? 2 : 8;
    return order * 100000 + Number(id);
  };
  const totals: MaterialTotal[] = [...needByKey.entries()]
    .sort((a, b) => keyRank(a[0]) - keyRank(b[0]))
    .map(([key, need]) => {
      const available = availableOf(key);
      const planned = key.startsWith('equipment:') ? (plannedByEquipment.get(Number(key.split(':')[1])) ?? 0) : 0;
      return { key, need, available, planned, shortage: available === null ? null : Math.max(0, need - available - planned), held: inv.holds.get(key) ?? 0 };
    });

  // 目標別：優先順位順に使用可能所持を割り当てた後の不足
  const remainingAvail = new Map<CostKey, number | null>(totals.map((t) => [t.key, t.available === null ? null : t.available + t.planned]));
  const goalPlans: GoalPlan[] = goals.map((g) => {
    const alloc = allocById.get(g.goalId)!;
    const completed = alloc.completedBuckets.reduce((n, b) => n + b.count, 0);
    const gSteps = steps.filter((s) => s.goalId === g.goalId);
    const gPlacements = placements.filter((p) => p.goalId === g.goalId && stepByKey.has(p.stepKey));
    const gUnplaced = unplaced.filter((p) => p.goalId === g.goalId);
    const reasons = [...new Set(gUnplaced.flatMap((p) => p.reasons))];
    // 装備の消費が不明な確認待ちの実施がある間は、所持の完成品・改修対象が残っているか断定できない
    const equipmentPending = unknownScope('equipment');
    if (equipmentPending && !reasons.includes('RESULT_PENDING')) reasons.unshift('RESULT_PENDING');
    const need = [...(needByGoal.get(g.goalId) ?? new Map<CostKey, number>()).entries()].sort((a, b) => keyRank(a[0]) - keyRank(b[0]));
    const shortages = need.map(([key, amount]) => {
      const avail = remainingAvail.get(key);
      if (avail === null || avail === undefined) return { key, amount: null };
      const used = Math.min(avail, amount);
      remainingAvail.set(key, avail - used);
      return { key, amount: amount - used };
    });
    let status: GoalPlan['status'];
    let completionDate: DateJst | null = null;
    if (equipmentPending) status = 'undetermined';
    else if (completed >= g.count) status = 'achieved';
    else if (gUnplaced.length > 0 || gPlacements.some((p) => p.date === null)) status = 'undetermined';
    else {
      completionDate = gPlacements.reduce<DateJst | null>((max, p) => (p.date && (!max || compareDate(p.date, max) > 0) ? p.date : max), null);
      status = gPlacements.some((p) => p.tentative || p.predecessorTentative) ? 'tentative' : 'scheduled';
    }
    return {
      goalId: g.goalId,
      completed: Math.min(completed, g.count),
      count: g.count,
      completedBuckets: alloc.completedBuckets,
      targetUnits: alloc.targets,
      missingUnits: alloc.missing,
      stepKeys: gSteps.map((s) => s.stepKey),
      remainingSteps: gSteps.length,
      status,
      completionDate,
      reasons,
      shortages: shortages.filter((s) => s.amount === null || s.amount > 0),
      need: need.map(([key, amount]) => ({ key, amount })),
    };
  });

  // 所持のある★と、保護を指定した★（取り込みで所持が0になっても確認できるように残す）
  const buckets: BucketUsage[] = [...new Set([...pool.owned.keys(), ...pool.manualRequested.keys()])]
    .sort((a, b) => keyId(a) - keyId(b) || keyStar(b) - keyStar(a))
    .map((k) => {
      const owned = pool.owned.get(k) ?? 0;
      const completedUse = pool.completedUse.get(k) ?? 0;
      const targetUse = (pool.targetUse.get(k) ?? 0) + (pool.craftUse.get(k) ?? 0);
      const goalUse = completedUse + targetUse;
      const manual = pool.manual.get(k) ?? 0;
      return {
        equipmentId: keyId(k),
        star: keyStar(k),
        owned,
        goalUse,
        completedUse,
        targetUse,
        manualProtection: manual,
        protectionRequested: pool.manualRequested.get(k) ?? 0,
        effectiveProtection: Math.max(goalUse, manual),
        materialAvailable: initialMaterial.get(k) ?? 0,
        reconciliationRequired: pool.reconciliation.has(k),
      };
    });

  // ---- 9. 永続化する試行の変更（当日の新規配置・将来の再配置・不要になった予定の取消） ----
  const changes: AttemptChanges = { create: [], update: [], cancel: [] };
  const stepKeys = new Set(steps.map((s) => s.stepKey));
  for (const p of placements) {
    const s = stepByKey.get(p.stepKey);
    if (!s) continue;
    const latest = latestOf(p.stepKey);
    const activeNext = latest && latest.lifecycle === 'active' && latest.outcome === 'none' ? latest : null;
    if (activeNext) {
      const movable = activeNext.scheduledDate === null || compareDate(activeNext.scheduledDate, today) > 0;
      const date = movable ? p.date : activeNext.scheduledDate;
      const dayOrder = movable ? p.dayOrder : activeNext.dayOrder;
      const gate: ExecutionGate = p.executionGate;
      if (date !== activeNext.scheduledDate || dayOrder !== activeNext.dayOrder || p.helperShipId !== activeNext.helperShipId || p.mode !== activeNext.mode || gate !== activeNext.executionGate) {
        changes.update.push({ attemptId: activeNext.attemptId, scheduledDate: date, dayOrder, helperShipId: p.helperShipId, mode: p.mode, executionGate: gate });
      }
    } else if (p.date === today && !p.provisional && !p.persisted) {
      changes.create.push({
        attemptId: p.attemptId,
        stepKey: p.stepKey,
        goalId: p.goalId,
        transition: s.transition,
        scheduledDate: today,
        dayOrder: p.dayOrder,
        outcome: 'none',
        lifecycle: 'active',
        executionGate: p.executionGate,
        predecessorAttemptId: latest?.attemptId ?? null,
        createdAt: '',
        helperShipId: p.helperShipId,
        mode: p.mode,
        resultEventId: null,
        cancelReason: null,
      });
    }
  }
  for (const a of input.attempts) {
    if (a.lifecycle !== 'active' || a.outcome !== 'none') continue;
    if (stepKeys.has(a.stepKey) && latestOf(a.stepKey)?.attemptId === a.attemptId) continue;
    if (a.scheduledDate === today) {
      if (a.executionGate !== 'reviewRequired') changes.update.push({ attemptId: a.attemptId, scheduledDate: today, dayOrder: a.dayOrder, helperShipId: a.helperShipId, mode: a.mode, executionGate: 'reviewRequired' });
    } else if (a.scheduledDate === null || compareDate(a.scheduledDate, today) > 0) {
      changes.cancel.push({ attemptId: a.attemptId, reason: '目標・所持データの変更により不要になった予定' });
    }
  }

  if (computationLimited) warnings.push('計算の上限に達したため、一部の改修・素材製作の工程を展開していません。');

  return {
    todayJst: today,
    steps,
    placements: placements.sort((a, b) => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : compareDate(a.date, b.date)) || a.dayOrder - b.dayOrder || a.stepKey.localeCompare(b.stepKey)),
    goals: goalPlans,
    totals,
    buckets,
    unplaced,
    attemptChanges: changes,
    warnings,
    computationLimited,
  };
}

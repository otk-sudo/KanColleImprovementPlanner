import { projectInventory } from '../domain/inventory/projection';
import type { ScopeKey } from '../domain/inventory/types';
import { buildMasterIndex, type MasterIndex } from '../domain/master';
import type { MasterFile } from '../domain/master/schema';
import type { Attempt, Baseline, DaySkip, DraftResult, Goal, PreferredHelper, Protection, ResultEvent, Settings } from '../domain/model';
import { DEFAULT_SETTINGS } from '../domain/model';
import type { PlanInput } from '../domain/planning/types';
import { fixtureMaster } from './fixtureMaster';

export interface InventorySpec {
  equipment?: [equipmentId: number, star: number, count: number][];
  ships?: number[] | null;
  resources?: Record<number, number>;
  items?: Record<number, number>;
}

export function baselinesFrom(spec: InventorySpec, at = '2026-10-14T00:00:00.000Z'): Baseline[] {
  const out: Baseline[] = [];
  const base = (scope: ScopeKey): Baseline => ({
    scope,
    snapshotId: `snap-${scope}`,
    importedAt: at,
    sourceCapturedAt: null,
    inputHash: 'h',
    sourceKind: 'material',
    includedThroughSequence: 0,
    includedDraftIds: [],
    equipment: null,
    ships: null,
    value: null,
  });
  if (spec.equipment) {
    out.push({ ...base('equipment'), sourceKind: 'simpleEquipment', equipment: { granularity: 'aggregate', buckets: spec.equipment.map(([equipmentId, star, count]) => ({ equipmentId, star, count })), instances: null } });
  }
  if (spec.ships) out.push({ ...base('ships'), sourceKind: 'port', ships: spec.ships.map((shipId, i) => ({ instanceId: i + 1, shipId })) });
  for (const [id, value] of Object.entries(spec.resources ?? {})) out.push({ ...base(`resource:${Number(id)}`), value });
  for (const [id, value] of Object.entries(spec.items ?? {})) out.push({ ...base(`item:${Number(id)}`), sourceKind: 'useItem', value });
  return out;
}

let goalSeq = 0;
export function goal(partial: Partial<Goal> & Pick<Goal, 'equipmentId' | 'targetStar'>): Goal {
  goalSeq++;
  return {
    goalId: partial.goalId ?? `g${goalSeq}`,
    count: 1,
    matchMode: 'atLeast',
    priority: 1,
    createdAt: `2026-10-01T00:00:${String(goalSeq % 60).padStart(2, '0')}.000Z`,
    routeKey: null,
    guarantee: { mode: 'never', fromStar: null },
    updateGuarantee: false,
    materialRoutes: {},
    achievedAt: null,
    ...partial,
  };
}

export interface PlanSpec {
  master?: MasterFile | MasterIndex;
  today?: string;
  inventory: InventorySpec;
  goals: Goal[];
  settings?: Partial<Settings>;
  attempts?: Attempt[];
  events?: ResultEvent[];
  drafts?: DraftResult[];
  protections?: Protection[];
  daySkips?: DaySkip[];
  preferredHelpers?: PreferredHelper[];
}

export function planInput(spec: PlanSpec): PlanInput {
  const master = spec.master && 'file' in spec.master ? spec.master : buildMasterIndex((spec.master as MasterFile | undefined) ?? fixtureMaster());
  const events = spec.events ?? [];
  const drafts = spec.drafts ?? [];
  return {
    master,
    todayJst: spec.today ?? '2026-10-14',
    inventory: projectInventory(baselinesFrom(spec.inventory), events, drafts),
    protections: spec.protections ?? [],
    goals: spec.goals,
    settings: { ...DEFAULT_SETTINGS, ...spec.settings },
    attempts: spec.attempts ?? [],
    daySkips: spec.daySkips ?? [],
    preferredHelpers: spec.preferredHelpers ?? [],
    drafts,
    resultEvents: events,
  };
}

export function attempt(partial: Partial<Attempt> & Pick<Attempt, 'attemptId' | 'stepKey' | 'goalId' | 'transition'>): Attempt {
  return {
    scheduledDate: null,
    dayOrder: 1,
    outcome: 'none',
    lifecycle: 'active',
    executionGate: 'ready',
    predecessorAttemptId: null,
    createdAt: '2026-10-13T00:00:00.000Z',
    helperShipId: null,
    mode: 'normal',
    resultEventId: null,
    cancelReason: null,
    ...partial,
  };
}

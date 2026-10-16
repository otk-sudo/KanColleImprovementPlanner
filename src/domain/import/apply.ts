import type { InventoryProjection } from '../inventory/projection';
import { bucketKey, isItemScope, isResourceScope, scopeId, sortScopes, type ScopeKey, type ScopeUpdate } from '../inventory/types';
import type { MasterIndex } from '../master';
import type { Baseline, Protection } from '../model';
import type { ImportKind, ImportWarning, ParsedImport } from './parse';

// 取り込み内容を「対象範囲の最新在庫」として反映する（design/06・13）。
// 反映時点までの実績は新しい基準に含め、再減算しない。対象外の scope は基準・境界とも維持する。

export interface PreviewItem {
  scope: ScopeKey;
  label: string;
  /** 現在の見込み（不明は null）。装備・艦娘は総数 */
  before: number | null;
  after: number;
  /** 装備は種類数も示す */
  kindsAfter: number | null;
  sourceIndex: number;
}

export interface ProtectionIssue {
  bucket: string;
  equipmentId: number;
  star: number;
  previousOwned: number;
  newOwned: number;
  requested: number;
  /** INSTANCE_MISSING：保護した個体が消えた、または別の装備・★へ移った */
  reason: 'COUNT_EXCEEDS' | 'GRANULARITY_CHANGED' | 'INSTANCE_MISSING';
}

export interface ImportPreview {
  items: PreviewItem[];
  updates: ScopeUpdate[];
  /** 今回変更しないカテゴリ */
  kept: ('equipment' | 'ships' | 'resources' | 'items')[];
  conflicts: { scope: ScopeKey; sources: number[] }[];
  protectionIssues: ProtectionIssue[];
  unknownIds: { equipment: number[]; ships: number[]; items: number[] };
  noChange: boolean;
  noChangeReasons: string[];
  /** 採用した入力の解析時の注意（アイテムの部分応答など）。装備・艦娘の0件は items から別に示す */
  parserWarnings: ImportWarning[];
}

export function scopeLabel(m: MasterIndex, scope: ScopeKey): string {
  if (scope === 'equipment') return '装備';
  if (scope === 'ships') return '艦娘';
  if (isResourceScope(scope)) return m.resourceName(scopeId(scope));
  return m.useItemName(scopeId(scope as `item:${number}`));
}

function currentValue(p: InventoryProjection, scope: ScopeKey): number | null {
  if (scope === 'equipment') return p.equipment.known ? [...p.equipment.counts.values()].reduce((a, b) => a + Math.max(0, b), 0) : null;
  if (scope === 'ships') return p.ships.known ? p.ships.ships.length : null;
  const id = scopeId(scope as `resource:${number}`);
  const v = isResourceScope(scope) ? p.resources.get(id) : p.items.get(id);
  return v ? v.value : null;
}

function updateValue(u: ScopeUpdate): { after: number; kinds: number | null } {
  if (u.scope === 'equipment') return { after: u.buckets.reduce((n, b) => n + b.count, 0), kinds: new Set(u.buckets.map((b) => b.equipmentId)).size };
  if (u.scope === 'ships') return { after: u.ships.length, kinds: null };
  return { after: u.value, kinds: null };
}

function equipmentProtectionIssues(newUpdate: Extract<ScopeUpdate, { scope: 'equipment' }>, previousCounts: Map<string, number>, baseline: Baseline | undefined, protections: Protection[]): ProtectionIssue[] {
  const owned = new Map(newUpdate.buckets.map((b) => [bucketKey(b.equipmentId, b.star), b.count]));
  // 個体ID → 新しい所持での装備・★（保護した個体が同じ装備・★に残っているかを確かめる）
  const instanceBucket = new Map((newUpdate.instances ?? []).map((i) => [i.instanceId, bucketKey(i.equipmentId, i.star)]));
  const granularityChanged = !!baseline?.equipment && baseline.equipment.granularity !== newUpdate.granularity;
  const issues: ProtectionIssue[] = [];
  for (const p of protections) {
    if (p.count <= 0) continue;
    const newOwned = owned.get(p.bucket) ?? 0;
    const base = { bucket: p.bucket, equipmentId: p.equipmentId, star: p.star, previousOwned: previousCounts.get(p.bucket) ?? 0, newOwned, requested: p.count };
    if (p.count > newOwned) issues.push({ ...base, reason: 'COUNT_EXCEEDS' });
    else if (granularityChanged) issues.push({ ...base, reason: 'GRANULARITY_CHANGED' });
    else if (p.instanceIds && p.instanceIds.some((id) => instanceBucket.get(id) !== p.bucket)) issues.push({ ...base, reason: 'INSTANCE_MISSING' });
  }
  return issues;
}

/**
 * 複数入力の差分プレビュー。同じ scope を含む入力が複数あれば selection で採用する入力を指定する。
 * ファイル名や更新日時で自動的に優先しない。
 */
export function buildImportPreview(
  inputs: ParsedImport[],
  selection: Partial<Record<ScopeKey, number>>,
  projection: InventoryProjection,
  baselines: Baseline[],
  protections: Protection[],
  m: MasterIndex,
): ImportPreview {
  const byScope = new Map<ScopeKey, number[]>();
  inputs.forEach((p, i) => {
    for (const u of p.updates) byScope.set(u.scope, [...(byScope.get(u.scope) ?? []), i]);
  });
  const conflicts: ImportPreview['conflicts'] = [];
  const updates: ScopeUpdate[] = [];
  const items: PreviewItem[] = [];
  for (const scope of sortScopes([...byScope.keys()])) {
    const sources = byScope.get(scope)!;
    let chosen = sources[0]!;
    if (sources.length > 1) {
      const sel = selection[scope];
      if (sel === undefined || !sources.includes(sel)) {
        conflicts.push({ scope, sources });
        continue;
      }
      chosen = sel;
    }
    const u = inputs[chosen]!.updates.find((x) => x.scope === scope)!;
    updates.push(u);
    const { after, kinds } = updateValue(u);
    items.push({ scope, label: scopeLabel(m, scope), before: currentValue(projection, scope), after, kindsAfter: kinds, sourceIndex: chosen });
  }
  const touched = new Set(updates.map((u) => u.scope));
  const kept: ImportPreview['kept'] = [];
  if (!touched.has('equipment')) kept.push('equipment');
  if (!touched.has('ships')) kept.push('ships');
  if (![...touched].some(isResourceScope)) kept.push('resources');
  if (![...touched].some(isItemScope)) kept.push('items');

  const eq = updates.find((u): u is Extract<ScopeUpdate, { scope: 'equipment' }> => u.scope === 'equipment');
  const protectionIssues = eq ? equipmentProtectionIssues(eq, projection.equipment.counts, baselines.find((b) => b.scope === 'equipment'), protections) : [];
  const unknownIds = {
    equipment: eq ? [...new Set(eq.buckets.map((b) => b.equipmentId).filter((id) => !m.equipment.has(id)))].sort((a, b) => a - b) : [],
    ships: [...new Set(updates.flatMap((u) => (u.scope === 'ships' ? u.ships.map((s) => s.shipId) : [])).filter((id) => !m.ships.has(id)))].sort((a, b) => a - b),
    items: updates.filter((u) => isItemScope(u.scope)).map((u) => scopeId(u.scope as `item:${number}`)).filter((id) => !m.useItems.has(id)),
  };
  const noChangeReasons = inputs.map((p) => p.noUpdateReason).filter((r): r is string => !!r);
  const usedInputs = new Set(items.map((i) => i.sourceIndex));
  const parserWarnings: ImportWarning[] = [];
  for (const i of [...usedInputs].sort((a, b) => a - b)) {
    for (const w of inputs[i]!.warnings) {
      if (w.code === 'EMPTY_EQUIPMENT' || w.code === 'EMPTY_SHIPS') continue;
      if (!parserWarnings.some((x) => x.code === w.code && x.message === w.message)) parserWarnings.push(w);
    }
  }
  return { items, updates, kept, conflicts, protectionIssues, unknownIds, noChange: updates.length === 0, noChangeReasons, parserWarnings };
}

/** プレビューで scope ごとに採用した入力（sources の添字） */
export function previewSourceByScope(preview: ImportPreview): Partial<Record<ScopeKey, number>> {
  return Object.fromEntries(preview.items.map((i) => [i.scope, i.sourceIndex]));
}

export interface ApplyImportInput {
  baselines: Baseline[];
  protections: Protection[];
  updates: ScopeUpdate[];
  sources: { kind: ImportKind; inputHash: string; capturedAt: string | null }[];
  /** scope ごとに採用した入力（sources の添字）。省略時は先頭の入力 */
  sourceByScope?: Partial<Record<ScopeKey, number>>;
  now: string;
  snapshotId: string;
  /** 反映時点で保存済みの実績の最大 originalSequence */
  maxSequence: number;
  /** 反映時点で開いている実施済み下書き */
  openDraftIds: string[];
  /** 反映前の装備の見込み所持（保護不一致の表示用） */
  previousCounts?: Map<string, number>;
}

export interface ApplyImportResult {
  baselines: Baseline[];
  protections: Protection[];
  changedScopes: ScopeKey[];
}

export function applyImport(input: ApplyImportInput): ApplyImportResult {
  if (input.updates.length === 0) return { baselines: input.baselines, protections: input.protections, changedScopes: [] };
  const byScope = new Map(input.baselines.map((b) => [b.scope, b]));
  const fallback = { kind: 'material' as ImportKind, inputHash: '', capturedAt: null };
  let protections = input.protections;
  for (const u of input.updates) {
    // 基準の出所は、その scope に採用した入力（複数入力・競合の選択でも取り違えない）
    const source = input.sources[input.sourceByScope?.[u.scope] ?? 0] ?? input.sources[0] ?? fallback;
    const base: Baseline = {
      scope: u.scope,
      snapshotId: input.snapshotId,
      importedAt: input.now,
      sourceCapturedAt: source.capturedAt,
      inputHash: source.inputHash,
      sourceKind: source.kind,
      includedThroughSequence: input.maxSequence,
      includedDraftIds: [...input.openDraftIds],
      equipment: null,
      ships: null,
      value: null,
    };
    if (u.scope === 'equipment') {
      const issues = equipmentProtectionIssues(u, input.previousCounts ?? new Map(), byScope.get('equipment'), protections);
      const flagged = new Map(issues.map((i) => [i.bucket, i]));
      protections = protections.map((p) => {
        const issue = flagged.get(p.bucket);
        if (!issue) return p;
        return { ...p, reconciliationRequired: true, reconciliationSnapshotId: input.snapshotId, previousOwned: issue.previousOwned, updatedAt: input.now };
      });
      byScope.set('equipment', { ...base, sourceKind: source.kind, equipment: { granularity: u.granularity, buckets: u.buckets, instances: u.instances } });
    } else if (u.scope === 'ships') {
      byScope.set('ships', { ...base, ships: u.ships });
    } else {
      byScope.set(u.scope, { ...base, value: u.value });
    }
  }
  return {
    baselines: [...byScope.values()],
    protections,
    changedScopes: sortScopes(input.updates.map((u) => u.scope)),
  };
}

export function protectionChangePreview(input: { owned: number; goalUse: number; newManual: number }): { effective: number; materialAvailable: number; overlapWithGoal: number; valid: boolean } {
  const valid = Number.isInteger(input.newManual) && input.newManual >= 0 && input.newManual <= input.owned;
  const effective = Math.max(input.goalUse, Math.min(input.newManual, input.owned));
  return { effective, materialAvailable: Math.max(0, input.owned - effective), overlapWithGoal: Math.min(input.newManual, input.goalUse), valid };
}

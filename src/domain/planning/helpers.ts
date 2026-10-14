import type { ShipProjection } from '../inventory/projection';
import type { MasterIndex, TransitionOption } from '../master';
import type { HelperCandidate, HelperNote, UnplacedReason } from './types';

// 担当艦の照合（design/09 規則5）。レシピに明示された艦娘ID（改造段階）と曜日の組だけで判定し、
// 「改二なら改の条件も満たす」などの推測はしない。

export interface HelperInfo {
  candidates: HelperCandidate[];
  blockers: UnplacedReason[];
  note: HelperNote | null;
}

export function helperInfo(m: MasterIndex, options: TransitionOption[], ships: ShipProjection, preferredShipId: number | null): HelperInfo {
  if (options.length === 0) return { candidates: [], blockers: ['RECIPE_UNKNOWN'], note: null };
  const groups = options.flatMap((o) => o.helpers.map((h) => ({ ...h, entryIndex: o.entryIndex })));
  const requiredShipIds = [...new Set(groups.flatMap((g) => g.shipIds))].sort((a, b) => a - b);
  if (groups.length === 0) return { candidates: [], blockers: ['RECIPE_UNKNOWN'], note: null };
  if (!ships.known) return { candidates: [], blockers: ['HELPER_UNKNOWN'], note: { requiredShipIds, ownedFamilyShipIds: [], preferredShipId } };

  const merged = new Map<string, HelperCandidate>();
  for (const g of groups) {
    for (const id of g.shipIds) {
      if ((ships.owned.get(id) ?? 0) <= 0) continue;
      const key = `${id}:${g.entryIndex}`;
      const existing = merged.get(key);
      if (existing) existing.days = [...new Set([...existing.days, ...g.days])].sort((a, b) => a - b);
      else merged.set(key, { shipId: id, entryIndex: g.entryIndex, days: [...new Set(g.days)].sort((a, b) => a - b) });
    }
  }
  let candidates = [...merged.values()].sort((a, b) => a.shipId - b.shipId || a.entryIndex - b.entryIndex);
  const ownedFamilyShipIds = [...new Set(requiredShipIds.flatMap((id) => m.shipFamily(id)))].filter((id) => (ships.owned.get(id) ?? 0) > 0).sort((a, b) => a - b);
  const note: HelperNote = { requiredShipIds, ownedFamilyShipIds, preferredShipId };

  if (preferredShipId !== null) {
    const preferred = candidates.filter((c) => c.shipId === preferredShipId);
    if (preferred.length === 0) return { candidates: [], blockers: ['PREFERRED_HELPER_UNAVAILABLE'], note };
    candidates = preferred;
  }
  if (candidates.length === 0) {
    return { candidates: [], blockers: [ownedFamilyShipIds.length > 0 ? 'REMODEL_MISMATCH' : 'HELPER_MISSING'], note };
  }
  return { candidates, blockers: [], note };
}

export function candidateForDay(candidates: HelperCandidate[], weekday: number): HelperCandidate | null {
  return candidates.find((c) => c.days.includes(weekday)) ?? null;
}

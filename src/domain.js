// Domain vocabulary and small pure helpers shared across the pipeline.
//
// An Incident carries two orthogonal fields (ADR-0004):
//   Tier   — how much we trust it exists. Sticky: it never downgrades.
//   Status — where it is in its lifecycle.
// Severity is a separate free-moving numeric; `stale` is display-derived and
// never stored.

export const Tier = Object.freeze({
  PROVISIONAL: 'Provisional',
  CONFIRMED: 'Confirmed',
});

// Tier is a total order so we can enforce "never downgrades".
const TIER_RANK = { [Tier.PROVISIONAL]: 0, [Tier.CONFIRMED]: 1 };

/** The higher (stickier) of two tiers. Confirmed wins; unknown inputs lose. */
export function maxTier(a, b) {
  const ra = TIER_RANK[a] ?? -1;
  const rb = TIER_RANK[b] ?? -1;
  return ra >= rb ? a : b;
}

export const Status = Object.freeze({
  ACTIVE: 'Active',
  RETRACTED: 'Retracted',
  SUPERSEDED: 'Superseded', // reserved for merges (slice 2)
});

export const Hazard = Object.freeze({
  EARTHQUAKE: 'earthquake',
});

/**
 * Parse a USGS `ids` field into a set of source-native identifiers.
 * The field is comma-delimited with leading/trailing commas, e.g.
 * ",us6000tauu,aka2026njosad," → ["us6000tauu", "aka2026njosad"].
 * We key correlation on membership in this set, never on the mutable
 * preferred `id` (feeds/usgs.md open question 1).
 */
export function parseIds(idsField) {
  if (!idsField) return [];
  return idsField.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Do two id collections share any member? */
export function idsOverlap(a, b) {
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

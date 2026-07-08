// Correlator — deterministic, sticky-incremental assignment of Observations to
// Incidents (ADR-0003).
//
// Slice 1 is single-source (USGS only), so the only matching rule is `ids`
// membership: two records belong to the same Incident iff their source-id sets
// overlap. This collapses same-quake sightings — including a revision that
// arrives under the same ids, and the two-feed case where the summary and FDSN
// reconciliation feeds both carry one event.
//
// "Sticky" means an Observation, once assigned, keeps its Incident: we match
// against both pre-existing Incidents and any minted earlier in this same
// batch, so assignment is stable and order-robust. Cross-source matching,
// merges, and splits arrive in slice 2.

import { idsOverlap } from './domain.js';

/**
 * Assign observations to incident ids.
 *
 * @param {object[]} observations - normalized, in ingest order
 * @param {{incidentId:string, sourceIds:string[]}[]} existingIndex - from the store
 * @param {() => string} mintId - returns the next stable incident id
 * @returns {{assigned: {observation:object, incidentId:string}[], touchedIds: string[]}}
 */
export function correlate(observations, existingIndex, mintId) {
  // Working index: incident id → accumulated set of member source ids.
  const index = existingIndex.map((e) => ({
    incidentId: e.incidentId,
    ids: new Set(e.sourceIds),
  }));

  const assigned = [];
  const touched = new Set();

  for (const observation of observations) {
    const obsIds = observation.sourceIds;
    let match = index.find((entry) => idsOverlap([...entry.ids], obsIds));

    if (!match) {
      match = { incidentId: mintId(), ids: new Set() };
      index.push(match);
    }
    // Accumulate membership so later records that share only the *new* ids
    // still collapse into the same Incident.
    for (const id of obsIds) match.ids.add(id);

    assigned.push({ observation, incidentId: match.incidentId });
    touched.add(match.incidentId);
  }

  return { assigned, touchedIds: [...touched] };
}

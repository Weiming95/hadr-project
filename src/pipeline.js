// Pipeline `tick` — the spine, and the primary test seam.
//
//   ingest → normalize → correlate → project → score → diff
//
// One tick polls the Source(s), folds the new Observations into the log,
// reprojects every touched Incident, and returns the change-diffs. It is PURE
// with respect to its injected edges: given the same observation log + the same
// fetch results + the same clock, it always produces the same Incidents and the
// same diffs. The Store is real (in tests, in-memory SQLite) — not mocked.

import { correlate } from './correlator.js';
import { project } from './projector.js';
import { pollUsgs } from './sources/usgs.js';

/**
 * Run one pipeline tick.
 *
 * @param {object} deps
 * @param {object} deps.store   - the Store (real; in tests, in-memory SQLite)
 * @param {Function} deps.httpGet - injected HTTP fetcher
 * @param {number} deps.now     - injected clock (epoch ms)
 * @returns {Promise<{diffs: object[], polledAt: number, observations: number}>}
 */
export async function tick({ store, httpGet, now }) {
  const sinceRaw = store.getMeta('usgs:lastPoll');
  const since = sinceRaw != null ? Number(sinceRaw) : null;

  // 1. Ingest + normalize.
  const { observations, polledAt } = await pollUsgs(httpGet, { now, since });

  // 2. Correlate — assign each observation to an Incident by `ids` membership.
  let counter = Number(store.getMeta('incident_seq') ?? 0);
  const mintId = () => `INC-${String(++counter).padStart(4, '0')}`;
  const { assigned, touchedIds } = correlate(
    observations,
    store.incidentIndex(),
    mintId,
  );

  // Snapshot the pre-tick projections of touched Incidents, so we can diff.
  const before = new Map();
  for (const id of touchedIds) before.set(id, store.getIncident(id));

  // 3. Append observations to the immutable log (with their assignment).
  for (const { observation, incidentId } of assigned) {
    observation.incidentId = incidentId;
    store.appendObservation(observation);
  }

  // 4. Reproject each touched Incident from its full log, 5. score, 6. diff.
  const diffs = [];
  for (const id of touchedIds) {
    const prior = before.get(id);
    const view = project(id, store.observationsForIncident(id), {
      priorTier: prior?.tier,
    });
    view.updatedAt = now;

    const op = prior == null ? 'add' : signature(view) !== signature(prior) ? 'update' : null;
    if (op) {
      store.upsertIncident(view);
      diffs.push({ op, incident: view });
    }
  }

  store.setMeta('incident_seq', String(counter));
  store.setMeta('usgs:lastPoll', String(polledAt));

  return { diffs, polledAt, observations: observations.length };
}

// Canonical signature of the fields that matter for display/ranking. Two views
// with the same signature are "no change" and emit no diff — so a quiet tick
// (nothing new from the feed) broadcasts nothing.
function signature(view) {
  if (!view) return '';
  return JSON.stringify({
    tier: view.tier,
    status: view.status,
    severity: view.severity,
    magnitude: view.magnitude,
    place: view.place,
    country: view.country,
    alert: view.alert,
    geometry: view.geometry,
    lastObserved: view.lastObserved,
    corrections: view.provenance?.corrections ?? [],
  });
}

// Projector — deterministic, replayable projection of an Incident's
// Observations into its current view (ADR-0002).
//
// Given the full, ordered observation log for one Incident, produce the
// Incident: its current fields, Tier, Status, Severity, and Provenance. Pure
// and total — the same log always yields the same Incident. Nothing here reads
// a clock or the network.
//
// Corrections are first-class (ADR-0004, user story 9): when a later
// observation revises a field, the prior value is *retained* in provenance
// rather than silently overwritten.

import { Status, Tier, maxTier } from './domain.js';
import { scoreSeverity } from './severity.js';

// Fields whose changes we surface as corrections.
const TRACKED_FIELDS = ['magnitude', 'place'];

/**
 * @param {string} incidentId
 * @param {object[]} observations - all observations for this incident
 * @param {object} [opts]
 * @param {string} [opts.priorTier] - existing incident tier (sticky floor)
 * @returns {object} the projected Incident
 */
export function project(incidentId, observations, { priorTier } = {}) {
  if (observations.length === 0) {
    throw new Error(`project: no observations for ${incidentId}`);
  }

  // Chronological by the source's own view of when it last spoke, then by
  // append order. Fall back to `ingestedAt` (not 0) so a deletion record with
  // stripped time fields still sorts to the end and is recognised as the latest
  // word — otherwise a withdrawal would sort to the front and be missed.
  // `ingestedAt` is part of the immutable log, so ordering stays deterministic.
  const orderKey = (o) => o.updated ?? o.eventTime ?? o.ingestedAt ?? 0;
  const ordered = [...observations].sort(
    (a, b) => orderKey(a) - orderKey(b) || (a.seq ?? 0) - (b.seq ?? 0),
  );
  const latest = ordered[ordered.length - 1];

  // Tier is sticky and never downgrades: Confirmed the moment any observation
  // is "reviewed" (a seismologist checked it), and it stays Confirmed.
  let tier = priorTier ?? Tier.PROVISIONAL;
  for (const o of ordered) tier = maxTier(tier, tierOf(o));

  // Status comes from the latest observation. A deletion retracts the Incident
  // but never removes it (user story 11).
  const status = latest.feedStatus === 'deleted' ? Status.RETRACTED : Status.ACTIVE;

  // Current display fields: latest known non-null value for each.
  const current = {};
  for (const field of ['magnitude', 'place', 'country', 'alert']) {
    current[field] = latestNonNull(ordered, field);
  }
  const geometry = latestNonNull(ordered, 'geometry', (g) => g && g.lat != null) ?? {
    lon: null, lat: null, depth: null,
  };

  const corrections = collectCorrections(ordered);

  const view = {
    incidentId,
    tier,
    status,
    hazard: latest.hazard,
    place: current.place,
    country: current.country,
    alert: current.alert,
    magnitude: current.magnitude,
    geometry,
    redirectTo: null,
    firstObserved: Math.min(...ordered.map((o) => o.eventTime ?? o.ingestedAt)),
    lastObserved: Math.max(...ordered.map((o) => o.updated ?? o.eventTime ?? o.ingestedAt)),
    sourceIds: unionSourceIds(ordered),
    provenance: {
      observations: ordered.map((o) => ({
        seq: o.seq ?? null,
        source: o.source,
        preferredId: o.preferredId,
        feedStatus: o.feedStatus,
        magnitude: o.magnitude,
        updated: o.updated ?? o.eventTime,
      })),
      corrections,
    },
  };

  const { severity, factors } = scoreSeverity(view);
  view.severity = severity;
  view.factors = factors;
  return view;
}

function tierOf(observation) {
  return observation.feedStatus === 'reviewed' ? Tier.CONFIRMED : Tier.PROVISIONAL;
}

function latestNonNull(ordered, field, isValid = (v) => v != null) {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const v = ordered[i][field];
    if (isValid(v)) return v;
  }
  return null;
}

// Walk the log; each time a tracked field's non-null value changes from the
// last one we saw, record the old→new transition with when it happened.
function collectCorrections(ordered) {
  const corrections = [];
  const seen = {};
  for (const o of ordered) {
    for (const field of TRACKED_FIELDS) {
      const value = o[field];
      if (value == null) continue;
      if (field in seen && !equal(seen[field], value)) {
        corrections.push({
          field,
          from: seen[field],
          to: value,
          at: o.updated ?? o.eventTime ?? null,
        });
      }
      seen[field] = value;
    }
  }
  return corrections;
}

function equal(a, b) {
  return a === b;
}

function unionSourceIds(ordered) {
  const set = new Set();
  for (const o of ordered) for (const id of o.sourceIds ?? []) set.add(id);
  return [...set].sort();
}

// USGS Source adapter.
//
// Turns raw USGS GeoJSON into normalized Observations. Two feeds are read:
//
//   1. summary/all_day.geojson  — the rolling window of current earthquakes.
//   2. FDSN event query with `includedeleted=true` — the reconciliation feed
//      that surfaces revisions AND silent deletions (feeds/usgs.md open
//      question 2). Deleted events arrive here with status="deleted"; they are
//      gone from the summary feed entirely, so this is the only way to learn a
//      published event was withdrawn.
//
// The adapter is pure given its injected `httpGet`. It does no correlation and
// no projection — it only normalizes. Correlation keys on `ids` membership, so
// every Observation carries the full parsed `ids` set, never just the mutable
// preferred `id`.

import { Hazard, parseIds } from '../domain.js';

const SUMMARY_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const FDSN_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

// USGS regenerates the summary feed every ~60s and honours conditional GETs.
export const USGS_POLL_MS = 60_000;

/**
 * Build the reconciliation URL. `updatedAfterMs` bounds the query to events
 * touched since our last poll; `includedeleted=true` folds in withdrawals.
 */
export function fdsnReconcileUrl(updatedAfterMs) {
  const params = new URLSearchParams({
    format: 'geojson',
    includedeleted: 'true',
    orderby: 'time',
  });
  if (updatedAfterMs != null) {
    params.set('updatedafter', new Date(updatedAfterMs).toISOString());
  }
  return `${FDSN_URL}?${params.toString()}`;
}

/**
 * Poll USGS and return normalized Observations.
 *
 * @param {(url:string, opts?:object)=>Promise<{status:number,headers:object,body:string}>} httpGet
 * @param {object} opts
 * @param {number} opts.now            - injected clock (epoch ms) → ingestedAt
 * @param {number} [opts.since]        - last successful poll (epoch ms); drives
 *                                       reconciliation + If-Modified-Since
 * @returns {Promise<{observations:object[], polledAt:number, summaryChanged:boolean}>}
 */
export async function pollUsgs(httpGet, { now, since } = {}) {
  const observations = [];

  // 1. Summary feed (conditional GET when we have a prior poll time).
  const headers = {};
  if (since != null) headers['If-Modified-Since'] = new Date(since).toUTCString();
  const summary = await httpGet(SUMMARY_URL, { headers });

  let summaryChanged = false;
  if (summary.status === 200) {
    summaryChanged = true;
    for (const feature of parseFeatures(summary.body)) {
      observations.push(normalizeFeature(feature, now));
    }
  } else if (summary.status !== 304) {
    throw new Error(`USGS summary feed: unexpected status ${summary.status}`);
  }

  // 2. Reconciliation feed — only after the first poll, so we have a bound.
  if (since != null) {
    const recon = await httpGet(fdsnReconcileUrl(since), { headers: {} });
    if (recon.status === 200) {
      for (const feature of parseFeatures(recon.body)) {
        observations.push(normalizeFeature(feature, now));
      }
    } else if (recon.status !== 304 && recon.status !== 204) {
      throw new Error(`USGS FDSN reconcile: unexpected status ${recon.status}`);
    }
  }

  return { observations, polledAt: now, summaryChanged };
}

function parseFeatures(body) {
  if (!body) return [];
  const json = typeof body === 'string' ? JSON.parse(body) : body;
  return Array.isArray(json.features) ? json.features : [];
}

/**
 * Normalize one GeoJSON feature into an Observation. Immutable snapshot of what
 * this feed said about this event at this moment.
 */
export function normalizeFeature(feature, ingestedAt) {
  const p = feature.properties ?? {};
  const [lon = null, lat = null, depth = null] = feature.geometry?.coordinates ?? [];
  return {
    source: 'usgs',
    sourceIds: parseIds(p.ids),
    preferredId: feature.id ?? null,
    hazard: Hazard.EARTHQUAKE,
    eventTime: p.time ?? null,
    updated: p.updated ?? null,
    geometry: { lon, lat, depth },
    magnitude: p.mag ?? null,
    place: p.place ?? null,
    country: countryFromPlace(p.place),
    // USGS `alert` is a PAGER colour (green/yellow/orange/red) or null.
    alert: p.alert ?? null,
    // status ∈ automatic | reviewed | deleted (feeds/usgs.md).
    feedStatus: p.status ?? null,
    tsunami: p.tsunami === 1,
    derived: false,
    raw: feature,
    ingestedAt,
  };
}

// USGS gives no ISO country code — only a free-text `place` like
// "140 km S of McCarthy, Alaska". Best-effort: take the text after the last
// comma as a location hint. GDACS supplies real ISO countries in slice 2.
function countryFromPlace(place) {
  if (!place) return null;
  const parts = place.split(',');
  return parts.length > 1 ? parts[parts.length - 1].trim() : null;
}

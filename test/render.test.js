// SECONDARY test seam (PRD #3): the renderer is a pure function from a set of
// Incidents to { dashboard HTML, JSON snapshot }. Lock both with golden files,
// including the quiet-morning (empty) variant. Regenerate goldens with:
//   UPDATE_GOLDEN=1 node --test test/render.test.js

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderDashboardHtml, renderSnapshot, STALE_MS } from '../src/render.js';
import { Status, Tier } from '../src/domain.js';

const NOW = 1783486200000;
const goldenPath = (name) => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));

function golden(name, actual) {
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(goldenPath(name), actual);
    return;
  }
  const expected = readFileSync(goldenPath(name), 'utf8');
  assert.equal(actual, expected, `golden mismatch: ${name} (UPDATE_GOLDEN=1 to refresh)`);
}

// A fixed, representative Incident set: one Confirmed active quake, one
// Provisional quake carrying a magnitude correction, one Retracted quake, and
// one deliberately stale quake (last observed well beyond the stale window).
function fixtureIncidents() {
  return [
    {
      incidentId: 'INC-0002', tier: Tier.CONFIRMED, status: Status.ACTIVE,
      severity: 4.6, factors: { basis: 'magnitude-placeholder', magnitude: 4.6, alert: 'green' },
      hazard: 'earthquake', place: '12 km NE of Ridgecrest, CA', country: 'CA', alert: 'green',
      geometry: { lon: -117.6, lat: 35.7, depth: 8 }, magnitude: 4.6, redirectTo: null,
      firstObserved: NOW - 120000, lastObserved: NOW - 60000,
      sourceIds: ['nc111'], provenance: { observations: [{}], corrections: [] }, updatedAt: NOW,
    },
    {
      incidentId: 'INC-0001', tier: Tier.PROVISIONAL, status: Status.ACTIVE,
      severity: 5.8, factors: { basis: 'magnitude-placeholder', magnitude: 5.8, alert: 'green' },
      hazard: 'earthquake', place: '70 km SW of Sand Point, Alaska', country: 'Alaska', alert: 'green',
      geometry: { lon: -160.6, lat: 54.85, depth: 24 }, magnitude: 5.8, redirectTo: null,
      firstObserved: NOW - 300000, lastObserved: NOW - 150000,
      sourceIds: ['ci9999', 'us2000xyz'],
      provenance: { observations: [{}, {}], corrections: [{ field: 'magnitude', from: 6.1, to: 5.8, at: NOW - 150000 }] },
      updatedAt: NOW,
    },
    {
      incidentId: 'INC-0003', tier: Tier.PROVISIONAL, status: Status.ACTIVE,
      severity: 3.0, factors: { basis: 'magnitude-placeholder', magnitude: 3.0, alert: null },
      hazard: 'earthquake', place: '9 km NNE of Avalon, CA', country: 'CA', alert: null,
      geometry: { lon: -118.3, lat: 33.4, depth: 12.1 }, magnitude: 3.0, redirectTo: null,
      firstObserved: NOW - STALE_MS - 200000, lastObserved: NOW - STALE_MS - 100000, // stale
      sourceIds: ['ci222'], provenance: { observations: [{}], corrections: [] }, updatedAt: NOW,
    },
    {
      incidentId: 'INC-0004', tier: Tier.PROVISIONAL, status: Status.RETRACTED,
      severity: 5.2, factors: { basis: 'magnitude-placeholder', magnitude: 5.2, alert: null },
      hazard: 'earthquake', place: 'off the coast of Example', country: 'Example', alert: null,
      geometry: { lon: 0, lat: 0, depth: 10 }, magnitude: 5.2, redirectTo: null,
      firstObserved: NOW - 400000, lastObserved: NOW - 200000,
      sourceIds: ['xx777'], provenance: { observations: [{}], corrections: [] }, updatedAt: NOW,
    },
  ];
}

test('dashboard HTML golden', () => {
  golden('dashboard.html', renderDashboardHtml(fixtureIncidents(), NOW));
});

test('JSON snapshot golden', () => {
  golden('snapshot.json', JSON.stringify(renderSnapshot(fixtureIncidents(), NOW), null, 2));
});

test('quiet morning: empty dashboard + snapshot goldens', () => {
  golden('dashboard.empty.html', renderDashboardHtml([], NOW));
  golden('snapshot.empty.json', JSON.stringify(renderSnapshot([], NOW), null, 2));
});

test('ranking: active-by-severity first, retracted last', () => {
  const snap = renderSnapshot(fixtureIncidents(), NOW);
  assert.deepEqual(
    snap.incidents.map((i) => i.id),
    ['INC-0001', 'INC-0002', 'INC-0003', 'INC-0004'],
    '5.8 > 4.6 > 3.0 active, then the retracted 5.2 sinks to the bottom',
  );
  assert.equal(snap.incidents.find((i) => i.id === 'INC-0003').stale, true);
});

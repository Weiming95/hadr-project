// PRIMARY test seam (issue #4, PRD #3): drive the pipeline `tick` at a real
// boundary — recorded raw USGS payloads + a fixed clock — and assert on the
// resulting Incident projections and change-diffs. The Store is a real
// in-memory SQLite; only the HTTP fetcher and clock are injected. No network.
// No LLM (not needed this slice).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

import { openStore } from '../src/store.js';
import { tick } from '../src/pipeline.js';
import { Status, Tier } from '../src/domain.js';

const scenario = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/usgs/scenario.json', import.meta.url)), 'utf8'),
);

// Replay the fixture: return the current tick's summary / fdsn payload based on
// which URL the adapter asks for. Mirrors a real conditional-GET fetcher's
// contract: { status, headers, body }.
function fixtureHttpGet(getTickIndex) {
  return async (url) => {
    const t = scenario.ticks[getTickIndex()];
    if (url.includes('summary/')) {
      return { status: 200, headers: {}, body: JSON.stringify(t.summary) };
    }
    if (url.includes('fdsnws/event')) {
      if (!t.fdsn) return { status: 204, headers: {}, body: '' };
      return { status: 200, headers: {}, body: JSON.stringify(t.fdsn) };
    }
    throw new Error(`unexpected URL in fixture: ${url}`);
  };
}

/** Run every tick in the scenario against a fresh in-memory store. */
async function runScenario() {
  const store = openStore({ path: ':memory:' });
  let i = 0;
  const httpGet = fixtureHttpGet(() => i);
  const perTick = [];
  for (i = 0; i < scenario.ticks.length; i++) {
    const { now } = scenario.ticks[i];
    const result = await tick({ store, httpGet, now });
    perTick.push(result);
  }
  return { store, perTick };
}

function byMagnitude(incidents, mag) {
  return incidents.find((x) => x.magnitude === mag);
}

test('tick 1: two quakes → two Incidents; review status drives Tier', async () => {
  const store = openStore({ path: ':memory:' });
  let i = 0;
  const { diffs } = await tick({ store, httpGet: fixtureHttpGet(() => i), now: scenario.ticks[0].now });

  assert.equal(diffs.length, 2, 'both new Incidents emit an add diff');
  assert.ok(diffs.every((d) => d.op === 'add'));

  const incidents = store.allIncidents();
  assert.equal(incidents.length, 2);

  const a = byMagnitude(incidents, 6.1);
  const b = byMagnitude(incidents, 4.6);
  assert.equal(a.tier, Tier.PROVISIONAL, 'automatic quake is Provisional');
  assert.equal(a.status, Status.ACTIVE);
  assert.equal(a.alert, 'orange');
  assert.equal(a.severity, 6.1, 'severity placeholder = magnitude');
  assert.equal(b.tier, Tier.CONFIRMED, 'reviewed quake is Confirmed');
  store.close();
});

test('shared ids collapse into ONE Incident even when the preferred id changes', async () => {
  const { store } = await runScenario();
  const incidents = store.allIncidents();

  // ci9999 (tick 1) and us2000xyz (tick 2) are the same physical quake.
  const withCi = incidents.filter((x) => x.sourceIds.includes('ci9999'));
  assert.equal(withCi.length, 1, 'exactly one Incident carries ci9999');
  assert.ok(withCi[0].sourceIds.includes('us2000xyz'), 'and it absorbed the new preferred id');

  // Across the whole run: A, B, C — no phantom Incident from the id change.
  assert.equal(incidents.length, 3);
  store.close();
});

test('magnitude revision reprojects and is retained as a correction', async () => {
  const { store, perTick } = await runScenario();
  const quakeA = store.allIncidents().find((x) => x.sourceIds.includes('ci9999'));

  assert.equal(quakeA.magnitude, 5.8, 'current magnitude is the revised value');
  const magCorrections = quakeA.provenance.corrections.filter((c) => c.field === 'magnitude');
  assert.equal(magCorrections.length, 1, 'exactly one magnitude correction recorded');
  assert.deepEqual(
    { from: magCorrections[0].from, to: magCorrections[0].to },
    { from: 6.1, to: 5.8 },
    'old value 6.1 retained, not silently overwritten',
  );

  // The revision surfaced as an update diff on tick 2 (not a new add).
  const tick2 = perTick[1];
  const aDiff = tick2.diffs.find((d) => d.incident.sourceIds.includes('ci9999'));
  assert.equal(aDiff.op, 'update');
  store.close();
});

test('deleted USGS event → Status = Retracted, and it stays visible', async () => {
  const { store, perTick } = await runScenario();
  const quakeA = store.allIncidents().find((x) => x.sourceIds.includes('ci9999'));

  assert.ok(quakeA, 'the deleted quake is NOT removed from the store');
  assert.equal(quakeA.status, Status.RETRACTED);

  // The retraction is an update diff on tick 3.
  const tick3 = perTick[2];
  const aDiff = tick3.diffs.find((d) => d.incident.sourceIds.includes('ci9999'));
  assert.equal(aDiff.op, 'update');
  assert.equal(aDiff.incident.status, Status.RETRACTED);
  store.close();
});

test('Tier is sticky: a reviewed Incident never downgrades', async () => {
  const { store } = await runScenario();
  const quakeB = store.allIncidents().find((x) => x.sourceIds.includes('nc111'));
  assert.equal(quakeB.tier, Tier.CONFIRMED, 'stays Confirmed across every later tick');
  store.close();
});

test('a quiet tick emits no change-diffs', async () => {
  const { perTick } = await runScenario();
  // Tick 2 changed A + added C; tick 3 retracted A; tick 4 changed nothing.
  assert.equal(perTick[1].diffs.length, 2, 'tick 2: A updated + C added');
  assert.equal(perTick[2].diffs.length, 1, 'tick 3: A retracted only');
  assert.equal(perTick[3].diffs.length, 0, 'tick 4: quiet → nothing broadcast');
});

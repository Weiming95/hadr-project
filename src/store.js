// Store — durable, event-sourced state (ADR-0002, ADR-0006).
//
//   observations : append-only, immutable log of everything a Source told us.
//   incidents    : the projected current view, rebuildable from the log.
//
// SQLite in WAL mode for a real single-node deployment; an in-memory database
// (path ":memory:") for tests. The DDL is kept Postgres-portable — plain SQL
// types, no SQLite-only column declarations — so the schema can move to
// Postgres later without a rewrite.

import { DatabaseSync } from 'node:sqlite';

const DDL = `
CREATE TABLE IF NOT EXISTS observations (
  seq          INTEGER PRIMARY KEY,   -- append order (BIGSERIAL on Postgres)
  incident_id  TEXT,                  -- assignment by the correlator
  source       TEXT NOT NULL,
  source_ids   TEXT NOT NULL,         -- JSON array of source-native ids
  preferred_id TEXT,
  hazard       TEXT NOT NULL,
  event_time   BIGINT NOT NULL,       -- epoch ms
  lon          DOUBLE PRECISION,
  lat          DOUBLE PRECISION,
  depth        DOUBLE PRECISION,
  magnitude    DOUBLE PRECISION,
  place        TEXT,
  alert        TEXT,
  feed_status  TEXT,                  -- automatic | reviewed | deleted
  tsunami      INTEGER,
  updated      BIGINT,                -- source's own last-updated (epoch ms)
  derived      BOOLEAN NOT NULL DEFAULT 0,
  raw          TEXT NOT NULL,         -- verbatim source payload for this record
  ingested_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_obs_incident ON observations (incident_id);

CREATE TABLE IF NOT EXISTS incidents (
  incident_id    TEXT PRIMARY KEY,
  tier           TEXT NOT NULL,
  status         TEXT NOT NULL,
  severity       DOUBLE PRECISION NOT NULL,
  factors        TEXT NOT NULL,       -- JSON: severity explainability
  hazard         TEXT NOT NULL,
  place          TEXT,
  country        TEXT,
  alert          TEXT,
  lon            DOUBLE PRECISION,
  lat            DOUBLE PRECISION,
  depth          DOUBLE PRECISION,
  magnitude      DOUBLE PRECISION,
  redirect_to    TEXT,                -- set when Superseded (slice 2)
  first_observed BIGINT,
  last_observed  BIGINT,
  source_ids     TEXT NOT NULL,       -- JSON array: accumulated id membership
  provenance     TEXT NOT NULL,       -- JSON: contributing obs + corrections
  updated_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openStore({ path = ':memory:' } = {}) {
  const db = new DatabaseSync(path);
  // WAL is meaningless (and unsupported) for :memory:; only set it on disk.
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  db.exec(DDL);

  const stmts = {
    insertObs: db.prepare(`
      INSERT INTO observations
        (incident_id, source, source_ids, preferred_id, hazard, event_time,
         lon, lat, depth, magnitude, place, alert, feed_status, tsunami,
         updated, derived, raw, ingested_at)
      VALUES
        (@incident_id, @source, @source_ids, @preferred_id, @hazard, @event_time,
         @lon, @lat, @depth, @magnitude, @place, @alert, @feed_status, @tsunami,
         @updated, @derived, @raw, @ingested_at)
    `),
    obsForIncident: db.prepare(`
      SELECT * FROM observations WHERE incident_id = ? ORDER BY event_time, seq
    `),
    incidentIndex: db.prepare(`SELECT incident_id, source_ids FROM incidents`),
    allIncidents: db.prepare(`SELECT * FROM incidents`),
    getIncident: db.prepare(`SELECT * FROM incidents WHERE incident_id = ?`),
    upsertIncident: db.prepare(`
      INSERT INTO incidents
        (incident_id, tier, status, severity, factors, hazard, place, country,
         alert, lon, lat, depth, magnitude, redirect_to, first_observed,
         last_observed, source_ids, provenance, updated_at)
      VALUES
        (@incident_id, @tier, @status, @severity, @factors, @hazard, @place,
         @country, @alert, @lon, @lat, @depth, @magnitude, @redirect_to,
         @first_observed, @last_observed, @source_ids, @provenance, @updated_at)
      ON CONFLICT(incident_id) DO UPDATE SET
        tier = excluded.tier, status = excluded.status,
        severity = excluded.severity, factors = excluded.factors,
        hazard = excluded.hazard, place = excluded.place,
        country = excluded.country, alert = excluded.alert,
        lon = excluded.lon, lat = excluded.lat,
        depth = excluded.depth, magnitude = excluded.magnitude,
        redirect_to = excluded.redirect_to,
        first_observed = excluded.first_observed,
        last_observed = excluded.last_observed,
        source_ids = excluded.source_ids, provenance = excluded.provenance,
        updated_at = excluded.updated_at
    `),
    getMeta: db.prepare(`SELECT value FROM meta WHERE key = ?`),
    setMeta: db.prepare(`
      INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
  };

  return {
    db,

    /** Append an immutable observation. `obs` uses domain field names. */
    appendObservation(obs) {
      stmts.insertObs.run({
        incident_id: obs.incidentId ?? null,
        source: obs.source,
        source_ids: JSON.stringify(obs.sourceIds ?? []),
        preferred_id: obs.preferredId ?? null,
        hazard: obs.hazard,
        event_time: obs.eventTime,
        lon: obs.geometry?.lon ?? null,
        lat: obs.geometry?.lat ?? null,
        depth: obs.geometry?.depth ?? null,
        magnitude: obs.magnitude ?? null,
        place: obs.place ?? null,
        alert: obs.alert ?? null,
        feed_status: obs.feedStatus ?? null,
        tsunami: obs.tsunami ? 1 : 0,
        updated: obs.updated ?? null,
        derived: obs.derived ? 1 : 0,
        raw: JSON.stringify(obs.raw ?? {}),
        ingested_at: obs.ingestedAt,
      });
    },

    /** All observations assigned to an incident, oldest event first. */
    observationsForIncident(incidentId) {
      return stmts.obsForIncident.all(incidentId).map(rowToObservation);
    },

    /** Lightweight index for correlation: [{ incidentId, sourceIds }]. */
    incidentIndex() {
      return stmts.incidentIndex.all().map((r) => ({
        incidentId: r.incident_id,
        sourceIds: JSON.parse(r.source_ids),
      }));
    },

    allIncidents() {
      return stmts.allIncidents.all().map(rowToIncident);
    },

    getIncident(id) {
      const row = stmts.getIncident.get(id);
      return row ? rowToIncident(row) : null;
    },

    upsertIncident(incident) {
      stmts.upsertIncident.run(incidentToRow(incident));
    },

    getMeta(key) {
      const row = stmts.getMeta.get(key);
      return row ? row.value : null;
    },

    setMeta(key, value) {
      stmts.setMeta.run(key, value);
    },

    close() {
      db.close();
    },
  };
}

function rowToObservation(r) {
  return {
    seq: r.seq,
    incidentId: r.incident_id,
    source: r.source,
    sourceIds: JSON.parse(r.source_ids),
    preferredId: r.preferred_id,
    hazard: r.hazard,
    eventTime: r.event_time,
    geometry: { lon: r.lon, lat: r.lat, depth: r.depth },
    magnitude: r.magnitude,
    place: r.place,
    alert: r.alert,
    feedStatus: r.feed_status,
    tsunami: !!r.tsunami,
    updated: r.updated,
    derived: !!r.derived,
    raw: JSON.parse(r.raw),
    ingestedAt: r.ingested_at,
  };
}

function rowToIncident(r) {
  return {
    incidentId: r.incident_id,
    tier: r.tier,
    status: r.status,
    severity: r.severity,
    factors: JSON.parse(r.factors),
    hazard: r.hazard,
    place: r.place,
    country: r.country,
    alert: r.alert,
    geometry: { lon: r.lon, lat: r.lat, depth: r.depth },
    magnitude: r.magnitude,
    redirectTo: r.redirect_to,
    firstObserved: r.first_observed,
    lastObserved: r.last_observed,
    sourceIds: JSON.parse(r.source_ids),
    provenance: JSON.parse(r.provenance),
    updatedAt: r.updated_at,
  };
}

function incidentToRow(i) {
  return {
    incident_id: i.incidentId,
    tier: i.tier,
    status: i.status,
    severity: i.severity,
    factors: JSON.stringify(i.factors ?? {}),
    hazard: i.hazard,
    place: i.place ?? null,
    country: i.country ?? null,
    alert: i.alert ?? null,
    lon: i.geometry?.lon ?? null,
    lat: i.geometry?.lat ?? null,
    depth: i.geometry?.depth ?? null,
    magnitude: i.magnitude ?? null,
    redirect_to: i.redirectTo ?? null,
    first_observed: i.firstObserved ?? null,
    last_observed: i.lastObserved ?? null,
    source_ids: JSON.stringify(i.sourceIds ?? []),
    provenance: JSON.stringify(i.provenance ?? {}),
    updated_at: i.updatedAt,
  };
}

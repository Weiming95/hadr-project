# CLAUDE.md

## Language & tooling

- **Node.js ≥ 22.5** (developed on v24), **ES modules** (`"type": "module"`).
- **Zero runtime dependencies.** Use the standard library only: `node:sqlite`
  (`DatabaseSync`) for storage, `node:http` for the server, global `fetch` for
  feed I/O, `node:test` + `node:assert` for tests. Do not add npm dependencies
  without recording the reason in `implementation-notes.md`.

## Test command

- `npm test` (runs `node --test`). Tests must pass **offline** — no network.

## Conventions

- **The pipeline is deterministic; the LLM is confined to prose/extraction.**
  Ingest → normalize → correlate → project → score → publish. No decision in the
  pipeline depends on an LLM (ADR-0005). Slice 1 uses no LLM at all.
- **Injected edges.** The HTTP fetcher and the clock are injected dependencies.
  The pipeline `tick` is pure with respect to them: same observation log + same
  inputs + same clock ⇒ same Incidents and same change-diffs.
- **Event-sourced.** `observations` is append-only and immutable; `incidents` is
  a projection rebuildable from the log (ADR-0002, ADR-0006). Never mutate an
  observation; record a new one.
- **Two orthogonal Incident fields** (ADR-0004): `Tier ∈ {Provisional,
  Confirmed}` is sticky and never downgrades; `Status ∈ {Active, Retracted,
  Superseded}`. Severity is a separate free-moving numeric; `stale` is
  display-derived, not stored.
- Schema kept **Postgres-portable** (no SQLite-only column types in the DDL).
- Prefer pure functions returning plain data; keep I/O at the edges (`main.js`,
  `server.js`, `scheduler.js`, `http.js`).

## Deviations policy

Anything that departs from the PRD (#3), the slice issue (#4), or this file is
recorded in `implementation-notes.md` under **Deviations**, with the reason. An
undocumented deviation is a bug.
